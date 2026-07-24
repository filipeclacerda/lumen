import { PageHeader } from "../../shared/ui/PageHeader";
import { keepPreviousData, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Archive,
  CheckCircle2,
  ChevronDown,
  CreditCard,
  Landmark,
  Link2,
  Pencil,
  Plus,
  Trash2,
  Undo2,
  Unlink,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { api } from "../../shared/api";
import { money, shortDate, todayIso } from "../../shared/format";
import { Modal } from "../../shared/ui/Modal";
import { MoneyInput } from "../../shared/ui/MoneyInput";
import { useToast } from "../../shared/ui/toast";
import { invalidateCheckpointQueries, invalidateTransactionDerivedQueries } from "../../shared/queryInvalidation";
import { EmptyState, ErrorState, LoadingState } from "../../shared/ui/AsyncState";
import { Pagination, type PaginationSize } from "../../shared/ui/Pagination";
import { Select } from "../../shared/ui/Select";
import type {
  Account,
  AccountBalanceSummary,
  AccountType,
  BalanceCheckpointInput,
  CardPaymentReconciliation,
  CreditCardInvoice,
  PaymentMatchCandidate,
  ReconciliationPreview,
} from "../../shared/types";

export function AccountsCards() {
  const [searchParams, setSearchParams] = useSearchParams();
  const client = useQueryClient();
  const toast = useToast();
  const [accountModal, setAccountModal] = useState<{ mode: "new" | "edit"; account?: Account }>();
  const [balanceReconciliationAccount, setBalanceReconciliationAccount] = useState<Account>();
  const [archiving, setArchiving] = useState<Account>();
  const [expanded, setExpanded] = useState<string>();
  const [deletingTransaction, setDeletingTransaction] = useState<string>();
  const [matching, setMatching] = useState<{
    invoice?: CreditCardInvoice;
    creditTransactionId?: string;
    amountInCents: number;
    candidates: PaymentMatchCandidate[];
  }>();
  const [undoId, setUndoId] = useState<string>();
  const [notice, setNotice] = useState("");
  const [invoicePage, setInvoicePage] = useState(0);
  const [invoicePageSize, setInvoicePageSize] = useState<PaginationSize>(10);
  const [activeReconciliationId, setActiveReconciliationId] = useState<string>();
  const [selectedInvoiceId, setSelectedInvoiceId] = useState("");
  const [selectedBankTransactionId, setSelectedBankTransactionId] = useState("");
  const [reconciling, setReconciling] = useState(false);
  const accountQuery = searchParams.get("q") ?? "";
  const {
    data: accounts = [],
    isLoading: accountsLoading,
    isError: accountsError,
    refetch: refetchAccounts,
  } = useQuery({ queryKey: ["accounts"], queryFn: api.accounts });
  const {
    data: accountBalanceSummaries = [],
    isLoading: balanceSummariesLoading,
    isError: balanceSummariesError,
  } = useQuery({
    queryKey: ["account-balance-summaries"],
    queryFn: api.accountBalanceSummaries,
  });
  const balanceSummaryByAccount = new Map(accountBalanceSummaries.map((summary) => [summary.accountId, summary]));
  const {
    data: invoicePageData,
    isLoading: invoicesLoading,
    isError: invoicesError,
    refetch: refetchInvoices,
  } = useQuery({
    queryKey: ["credit-card-invoices", invoicePage, invoicePageSize],
    queryFn: () => api.creditCardInvoicesPage({ limit: invoicePageSize, offset: invoicePage * invoicePageSize }),
    placeholderData: keepPreviousData,
  });
  const invoices = invoicePageData?.items ?? [];
  const {
    data: reconciliations = [],
    isLoading: reconciliationsLoading,
    isError: reconciliationsError,
    refetch: refetchReconciliations,
  } = useQuery({
    queryKey: ["card-payment-reconciliations"],
    queryFn: api.cardPaymentReconciliations,
  });
  const pendingReconciliations = reconciliations.filter((item) => item.state !== "reconciled");

  function openReconciliation(reconciliation: CardPaymentReconciliation) {
    setActiveReconciliationId(reconciliation.paymentTransactionId);
    setSelectedInvoiceId(
      reconciliation.invoiceId ??
        (reconciliation.invoiceCandidates.length === 1 ? reconciliation.invoiceCandidates[0].id : ""),
    );
    setSelectedBankTransactionId(
      reconciliation.bankTransactionId ??
        (reconciliation.bankCandidates.length === 1 ? reconciliation.bankCandidates[0].transactionId : ""),
    );
  }

  useEffect(() => {
    if (searchParams.get("action") !== "new") return;
    setAccountModal({ mode: "new" });
    setSearchParams(
      (params) => {
        const next = new URLSearchParams(params);
        next.delete("action");
        return next;
      },
      { replace: true },
    );
  }, [searchParams, setSearchParams]);

  useEffect(() => {
    if (!accountQuery || accounts.length === 0) return;
    const match = accounts.find(
      (account) => account.name.toLocaleLowerCase("pt-BR") === accountQuery.toLocaleLowerCase("pt-BR"),
    );
    document.getElementById(match ? `account-${match.id}` : "")?.scrollIntoView?.({ block: "center" });
  }, [accountQuery, accounts]);
  useEffect(() => {
    const requestedAccountId = searchParams.get("balance");
    if (requestedAccountId === null || accountsLoading || accountsError) return;
    const account = accounts.find(
      (candidate) => candidate.id === requestedAccountId && candidate.kind !== "credit_card",
    );
    if (account) setBalanceReconciliationAccount(account);
    setSearchParams(
      (params) => {
        const next = new URLSearchParams(params);
        next.delete("balance");
        return next;
      },
      { replace: true },
    );
  }, [accounts, accountsError, accountsLoading, searchParams, setSearchParams]);
  useEffect(() => {
    const requestedReconciliation = searchParams.get("reconcile");
    if (requestedReconciliation === null || reconciliationsLoading || reconciliationsError) return;
    const reconciliation =
      pendingReconciliations.find((item) => item.paymentTransactionId === requestedReconciliation) ??
      (["", "1", "true"].includes(requestedReconciliation) ? pendingReconciliations[0] : undefined);
    if (reconciliation) {
      openReconciliation(reconciliation);
      requestAnimationFrame(() =>
        document
          .getElementById(`reconciliation-${reconciliation.paymentTransactionId}`)
          ?.scrollIntoView?.({ block: "center" }),
      );
    }
    setSearchParams(
      (params) => {
        const next = new URLSearchParams(params);
        next.delete("reconcile");
        return next;
      },
      { replace: true },
    );
  }, [pendingReconciliations, reconciliationsError, reconciliationsLoading, searchParams, setSearchParams]);
  useEffect(() => {
    if (!invoicePageData) return;
    setInvoicePage((page) => Math.min(page, Math.max(0, Math.ceil(invoicePageData.totalCount / invoicePageSize) - 1)));
  }, [invoicePageData, invoicePageSize]);
  const { data: items = [] } = useQuery({
    queryKey: ["credit-card-invoice-items", expanded],
    queryFn: () => api.creditCardInvoiceItems(expanded!),
    enabled: Boolean(expanded),
  });

  async function refresh() {
    await Promise.all([
      client.invalidateQueries({ queryKey: ["credit-card-invoices"] }),
      client.invalidateQueries({ queryKey: ["credit-card-invoice-items"] }),
      client.invalidateQueries({ queryKey: ["card-payment-reconciliations"] }),
      invalidateTransactionDerivedQueries(client),
    ]);
  }
  async function confirmReconciliation(reconciliation: CardPaymentReconciliation) {
    if (!selectedInvoiceId && !selectedBankTransactionId) return;
    setReconciling(true);
    try {
      await api.reconcileCardPayment(
        reconciliation.paymentTransactionId,
        selectedInvoiceId || undefined,
        selectedBankTransactionId || undefined,
      );
      setNotice("Conciliação confirmada.");
      setActiveReconciliationId(undefined);
      await refresh();
    } catch (e) {
      toast((e as { message?: string })?.message ?? "Não foi possível confirmar a conciliação.", "error");
    } finally {
      setReconciling(false);
    }
  }
  async function findPayment(invoice: CreditCardInvoice) {
    setMatching({
      invoice,
      amountInCents: invoice.totalInCents,
      candidates: await api.invoicePaymentMatches(invoice.id),
    });
  }
  async function findImportedPayment(transactionId: string, amountInCents: number) {
    setMatching({
      creditTransactionId: transactionId,
      amountInCents,
      candidates: await api.cardPaymentMatches(transactionId),
    });
  }
  async function link(transactionId: string) {
    if (!matching) return;
    if (matching.invoice) await api.linkInvoicePayment(matching.invoice.id, transactionId);
    else await api.linkCardPayment(matching.creditTransactionId!, transactionId);
    setNotice("Pagamento vinculado. Ele agora é tratado como transferência.");
    setMatching(undefined);
    await refresh();
  }
  async function unlink(invoiceId: string) {
    await api.unlinkInvoicePayment(invoiceId);
    setNotice("Vínculo removido; a fatura voltou a ficar aberta.");
    await refresh();
  }
  async function unlinkImportedPayment(transactionId: string) {
    await api.unlinkCardPayment(transactionId);
    setNotice("Conciliação do pagamento removida.");
    await refresh();
  }
  async function remove(invoiceId: string) {
    await api.setCreditCardInvoiceDeleted(invoiceId, true);
    setUndoId(invoiceId);
    setNotice("Fatura e lançamentos removidos.");
    await refresh();
  }
  async function restore() {
    if (!undoId) return;
    await api.setCreditCardInvoiceDeleted(undoId, false);
    setUndoId(undefined);
    setNotice("Fatura restaurada.");
    await refresh();
  }
  async function removeTransaction() {
    if (!deletingTransaction) return;
    await api.deleteTransactions([deletingTransaction]);
    setNotice("Lançamento excluído.");
    setDeletingTransaction(undefined);
    await refresh();
  }
  async function toggleStatus(invoice: CreditCardInvoice) {
    await api.setInvoiceStatus(invoice.id, invoice.status === "paid" ? "open" : "paid");
    await refresh();
  }
  async function confirmArchive() {
    if (!archiving) return;
    try {
      await api.archiveAccount(archiving.id);
      toast("Conta arquivada.");
      setArchiving(undefined);
      await client.invalidateQueries({ queryKey: ["accounts"] });
    } catch (e) {
      toast((e as { message?: string })?.message ?? "Não foi possível arquivar a conta.", "error");
      setArchiving(undefined);
    }
  }

  return (
    <section className="accounts-page" data-tutorial="accounts">
      <PageHeader>
        <div>
          <p className="eyebrow">PATRIMÔNIO E CRÉDITO</p>
          <h1>Contas e cartões</h1>
          <p className="muted">Saldos, faturas e pagamentos conciliados em um só lugar.</p>
        </div>
        <button onClick={() => setAccountModal({ mode: "new" })}>
          <Plus size={17} /> Adicionar conta
        </button>
      </PageHeader>
      {notice && (
        <div className="notice notice-action">
          <span>{notice}</span>
          {undoId && (
            <button className="text-button" onClick={restore}>
              <Undo2 size={15} /> Desfazer
            </button>
          )}
        </div>
      )}
      {accountsLoading && <LoadingState variant="panel" label="Carregando contas…" />}
      {accountsError && (
        <ErrorState message="Não foi possível carregar as contas." onRetry={() => void refetchAccounts()} />
      )}
      {!accountsLoading && !accountsError && accounts.length === 0 && (
        <EmptyState title="Nenhuma conta cadastrada" description="Adicione uma conta para acompanhar seu patrimônio." />
      )}
      {!accountsLoading && !accountsError && accounts.length > 0 && (
        <div className="account-grid">
          {accounts.map((account) => {
            const balanceSummary = balanceSummaryByAccount.get(account.id);
            return (
              <article
                id={`account-${account.id}`}
                aria-labelledby={`account-${account.id}-name`}
                className={`account-card${accountQuery && account.name.toLocaleLowerCase("pt-BR") === accountQuery.toLocaleLowerCase("pt-BR") ? " command-target" : ""}`}
                key={account.id}
              >
                <div className="account-card-header">
                  <div className={`metric-icon ${account.kind === "credit_card" ? "red" : "green"}`}>
                    {account.kind === "credit_card" ? <CreditCard /> : <Landmark />}
                  </div>
                  <div className="account-card-identity">
                    <small>{account.kind === "credit_card" ? "Cartão de crédito" : "Conta"}</small>
                    <h3 id={`account-${account.id}-name`}>{account.name}</h3>
                    {account.kind !== "credit_card" && (
                      <small className="account-card-status">
                        {balanceSummariesLoading
                          ? "Carregando resumo…"
                          : balanceSummariesError
                            ? "Resumo indisponível"
                            : balanceSummary && !balanceSummary.needsReconciliation && balanceSummary.lastReconciledAt
                              ? `Conferido em ${dayMonth(balanceSummary.lastReconciledAt)}`
                              : "Precisa conferir"}
                      </small>
                    )}
                  </div>
                  <div className="account-card-balance">
                    <small>Saldo atual</small>
                    <strong>{money(balanceSummary?.realizedBalanceInCents ?? account.balanceInCents)}</strong>
                  </div>
                </div>
                {account.kind !== "credit_card" && (
                  <div className="account-card-support">
                    <div className="account-card-forecast">
                      {balanceSummariesLoading ? (
                        <small>Carregando projeção…</small>
                      ) : balanceSummariesError ? (
                        <small>Projeção indisponível no momento.</small>
                      ) : balanceSummary ? (
                        <>
                          <small>Em 30 dias</small>
                          <strong>{money(balanceSummary.forecastBalanceInCents)}</strong>
                          {balanceSummary.scheduledCount > 0 && (
                            <small>
                              {balanceSummary.scheduledCount}{" "}
                              {balanceSummary.scheduledCount === 1 ? "lançamento previsto" : "lançamentos previstos"}
                            </small>
                          )}
                        </>
                      ) : (
                        <small>Projeção indisponível</small>
                      )}
                    </div>
                    {balanceSummary && balanceSummary.minimumBalanceInCents < 0 && (
                      <small className="negative account-card-warning">
                        Atenção: saldo pode ficar negativo
                        {balanceSummary.minimumBalanceDate ? ` em ${dayMonth(balanceSummary.minimumBalanceDate)}` : ""}.
                      </small>
                    )}
                  </div>
                )}
                <div className="account-card-footer">
                  {account.kind !== "credit_card" && (
                    <button
                      className="secondary account-balance-button"
                      aria-label={`Conferir saldo de ${account.name}`}
                      onClick={() => setBalanceReconciliationAccount(account)}
                    >
                      <CheckCircle2 size={16} aria-hidden="true" />
                      Conferir saldo
                    </button>
                  )}
                  <div className="account-actions">
                    <button
                      className="icon-button"
                      title="Renomear conta"
                      aria-label={`Renomear ${account.name}`}
                      onClick={() => setAccountModal({ mode: "edit", account })}
                    >
                      <Pencil size={13} />
                    </button>
                    <button
                      className="icon-button"
                      title="Arquivar conta"
                      aria-label={`Arquivar ${account.name}`}
                      onClick={() => setArchiving(account)}
                    >
                      <Archive size={13} />
                    </button>
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      )}
      {reconciliationsLoading && <LoadingState variant="panel" label="Carregando conciliações…" />}
      {reconciliationsError && (
        <ErrorState
          message="Não foi possível carregar as conciliações pendentes."
          onRetry={() => void refetchReconciliations()}
        />
      )}
      {!reconciliationsLoading && !reconciliationsError && (
        <article className="panel">
          <div className="panel-title">
            <div>
              <h2>Conciliações pendentes</h2>
              <p className="muted">Confirme a fatura anterior e o débito bancário correspondentes a cada pagamento.</p>
            </div>
            <span>
              {pendingReconciliations.length} pendência{pendingReconciliations.length === 1 ? "" : "s"}
            </span>
          </div>
          {pendingReconciliations.length === 0 ? (
            <p className="muted">Nenhum pagamento de cartão aguarda conciliação.</p>
          ) : (
            <div className="match-list">
              {pendingReconciliations.map((reconciliation) => {
                const isActive = activeReconciliationId === reconciliation.paymentTransactionId;
                const stateLabel = {
                  pending: "Pendente",
                  invoice_confirmed: "Fatura confirmada",
                  bank_confirmed: "Débito confirmado",
                  reconciled: "Conciliada",
                }[reconciliation.state];
                const invoiceOptions = reconciliation.invoiceCandidates.map((candidate) => ({
                  value: candidate.id,
                  label: `${candidate.accountName} · vence em ${shortDate(candidate.dueDate)} · ${money(candidate.totalInCents)}`,
                }));
                const bankOptions = reconciliation.bankCandidates.map((candidate) => ({
                  value: candidate.transactionId,
                  label: `${candidate.accountName} · ${shortDate(candidate.date)} · ${candidate.description}`,
                }));
                if (
                  reconciliation.invoiceId &&
                  !invoiceOptions.some((option) => option.value === reconciliation.invoiceId)
                ) {
                  invoiceOptions.unshift({
                    value: reconciliation.invoiceId,
                    label: "Fatura já confirmada",
                  });
                }
                if (
                  reconciliation.bankTransactionId &&
                  !bankOptions.some((option) => option.value === reconciliation.bankTransactionId)
                ) {
                  bankOptions.unshift({
                    value: reconciliation.bankTransactionId,
                    label: "Débito já confirmado",
                  });
                }
                return (
                  <div
                    id={`reconciliation-${reconciliation.paymentTransactionId}`}
                    className="invoice-row-wrap"
                    key={reconciliation.paymentTransactionId}
                  >
                    <button
                      className="match-row"
                      aria-expanded={isActive}
                      aria-controls={`reconciliation-details-${reconciliation.paymentTransactionId}`}
                      onClick={() =>
                        isActive ? setActiveReconciliationId(undefined) : openReconciliation(reconciliation)
                      }
                    >
                      <span>
                        <b>{reconciliation.description}</b>
                        <small>
                          {reconciliation.cardAccountName} · {shortDate(reconciliation.date)} · {stateLabel}
                        </small>
                      </span>
                      <strong>{money(reconciliation.amountInCents)}</strong>
                      <ChevronDown size={17} />
                    </button>
                    {isActive && (
                      <div id={`reconciliation-details-${reconciliation.paymentTransactionId}`} className="impact">
                        <p className="muted">
                          As sugestões usam o mesmo valor e até 10 dias de distância. Nenhum vínculo será criado sem sua
                          confirmação.
                        </p>
                        <div className="modal-form">
                          <label>
                            Fatura anterior
                            <Select
                              value={selectedInvoiceId}
                              onChange={setSelectedInvoiceId}
                              ariaLabel={`Fatura anterior para ${reconciliation.description}`}
                              options={[
                                ...(reconciliation.invoiceId
                                  ? []
                                  : [{ value: "", label: "Não vincular uma fatura agora" }]),
                                ...invoiceOptions,
                              ]}
                            />
                          </label>
                          {reconciliation.invoiceCandidates.length === 0 && !reconciliation.invoiceId && (
                            <small className="muted">Nenhuma fatura compatível encontrada.</small>
                          )}
                          <label>
                            Débito na conta
                            <Select
                              value={selectedBankTransactionId}
                              onChange={setSelectedBankTransactionId}
                              ariaLabel={`Débito bancário para ${reconciliation.description}`}
                              options={[
                                ...(reconciliation.bankTransactionId
                                  ? []
                                  : [{ value: "", label: "Não vincular um débito agora" }]),
                                ...bankOptions,
                              ]}
                            />
                          </label>
                          {reconciliation.bankCandidates.length === 0 && !reconciliation.bankTransactionId && (
                            <small className="muted">Nenhum débito bancário compatível encontrado.</small>
                          )}
                        </div>
                        <div className="editor-actions">
                          <button className="secondary" onClick={() => setActiveReconciliationId(undefined)}>
                            Fechar
                          </button>
                          <button
                            onClick={() => void confirmReconciliation(reconciliation)}
                            disabled={
                              reconciling ||
                              (!selectedInvoiceId && !selectedBankTransactionId) ||
                              (selectedInvoiceId === (reconciliation.invoiceId ?? "") &&
                                selectedBankTransactionId === (reconciliation.bankTransactionId ?? ""))
                            }
                          >
                            {reconciling ? "Confirmando…" : "Confirmar conciliação"}
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </article>
      )}
      {invoicesLoading && <LoadingState variant="panel" label="Carregando faturas…" />}
      {invoicesError && (
        <ErrorState message="Não foi possível carregar as faturas." onRetry={() => void refetchInvoices()} />
      )}
      {!invoicesLoading && !invoicesError && (
        <article className="panel invoice-panel">
          <div className="panel-title">
            <h2>Faturas importadas</h2>
            <span>
              {invoices.length} fatura{invoices.length === 1 ? "" : "s"}
            </span>
          </div>
          {(invoicePageData?.totalCount ?? 0) === 0 ? (
            <div className="empty-state">
              <CreditCard size={34} />
              <h3>Nenhuma fatura importada</h3>
              <p className="muted">Use a área Importar para adicionar o CSV do cartão.</p>
            </div>
          ) : (
            <div className="invoice-list">
              {invoices.map((invoice) => (
                <div className="invoice-row-wrap" key={invoice.id}>
                  <div className="invoice-row">
                    <button
                      className={`invoice-expand-toggle ${expanded === invoice.id ? "expanded" : ""}`}
                      title={expanded === invoice.id ? "Recolher fatura" : "Expandir fatura"}
                      aria-label={
                        expanded === invoice.id
                          ? `Recolher fatura ${invoice.accountName}`
                          : `Expandir fatura ${invoice.accountName}`
                      }
                      aria-expanded={expanded === invoice.id}
                      onClick={() => setExpanded(expanded === invoice.id ? undefined : invoice.id)}
                    >
                      <ChevronDown size={17} />
                    </button>
                    <button
                      className="invoice-identity"
                      aria-label={`${expanded === invoice.id ? "Recolher" : "Expandir"} fatura ${invoice.accountName}`}
                      aria-expanded={expanded === invoice.id}
                      onClick={() => setExpanded(expanded === invoice.id ? undefined : invoice.id)}
                    >
                      <b>{invoice.accountName}</b>
                      <small>Vence em {shortDate(invoice.dueDate)}</small>
                      <span className={`invoice-payment-slot ${invoice.paymentTransactionId ? "" : "empty"}`}>
                        <Link2 size={12} />
                        {invoice.paymentTransactionId
                          ? `${invoice.paymentDescription} em ${shortDate(invoice.paymentDate!)}`
                          : "Vincule um pagamento"}
                      </span>
                    </button>
                    <div className="invoice-metric">
                      <small>Compras</small>
                      <b>{money(invoice.purchasesInCents)}</b>
                    </div>
                    <div className="invoice-metric">
                      <small>Créditos e estornos</small>
                      <b>{money(invoice.creditsInCents)}</b>
                      {invoice.paymentsInCents > 0 && (
                        <small>Pagamentos anteriores: {money(invoice.paymentsInCents)}</small>
                      )}
                    </div>
                    <div className="invoice-metric invoice-total-value">
                      <small>Total</small>
                      <strong>{money(invoice.totalInCents)}</strong>
                    </div>
                    <div className="invoice-status">
                      <span
                        className={`badge invoice-status-badge ${invoice.status === "paid" ? "success-badge" : ""}`}
                      >
                        {invoice.status === "paid" ? "Paga" : "Aberta"}
                      </span>
                    </div>
                    <div className="invoice-actions">
                      {invoice.paymentTransactionId ? (
                        <button
                          className="secondary icon-button"
                          title="Desvincular pagamento"
                          aria-label={`Desvincular pagamento da fatura ${invoice.accountName}`}
                          onClick={() => unlink(invoice.id)}
                        >
                          <Unlink size={16} />
                        </button>
                      ) : (
                        <>
                          <button
                            className="secondary icon-button"
                            title={invoice.status === "paid" ? "Reabrir fatura" : "Marcar fatura como paga"}
                            aria-label={`${invoice.status === "paid" ? "Reabrir" : "Marcar como paga"} a fatura ${invoice.accountName}`}
                            onClick={() => toggleStatus(invoice)}
                          >
                            {invoice.status === "paid" ? <Undo2 size={16} /> : <CheckCircle2 size={16} />}
                          </button>
                          <button
                            className="secondary icon-button"
                            title="Vincular pagamento"
                            aria-label={`Vincular pagamento à fatura ${invoice.accountName}`}
                            onClick={() => findPayment(invoice)}
                          >
                            <Link2 size={16} />
                          </button>
                        </>
                      )}
                      <button
                        className="danger icon-button"
                        title="Excluir fatura"
                        aria-label={`Excluir fatura ${invoice.accountName}`}
                        onClick={() => remove(invoice.id)}
                      >
                        <Trash2 size={16} />
                      </button>
                    </div>
                  </div>
                  {expanded === invoice.id && (
                    <div className="invoice-items table-scroll">
                      <table>
                        <caption>Itens da fatura {invoice.accountName}</caption>
                        <thead>
                          <tr>
                            <th scope="col">Data</th>
                            <th scope="col">Descrição</th>
                            <th scope="col">Portador</th>
                            <th scope="col">Parcela</th>
                            <th scope="col">Categoria</th>
                            <th scope="col">Valor</th>
                            <th scope="col">
                              <span className="sr-only">Ações</span>
                            </th>
                          </tr>
                        </thead>
                        <tbody>
                          {items.map((item) => (
                            <tr key={item.transactionId}>
                              <td>{shortDate(item.date)}</td>
                              <td>{item.description}</td>
                              <td>{item.holder ?? "—"}</td>
                              <td>{item.installment ?? "—"}</td>
                              <td>{item.categoryName ?? "Sem categoria"}</td>
                              <td className={item.amountInCents > 0 ? "positive amount" : "amount"}>
                                {money(item.amountInCents)}
                              </td>
                              <td>
                                <div style={{ display: "flex", gap: "8px", justifyContent: "flex-end" }}>
                                  {item.lineKind === "payment" &&
                                    (item.isLinked ? (
                                      <button
                                        className="secondary"
                                        onClick={() => unlinkImportedPayment(item.transactionId)}
                                      >
                                        <Unlink size={14} /> Desvincular
                                      </button>
                                    ) : (
                                      <button
                                        className="secondary"
                                        onClick={() => findImportedPayment(item.transactionId, item.amountInCents)}
                                      >
                                        <Link2 size={14} /> Conciliar
                                      </button>
                                    ))}
                                  <button
                                    className="danger icon-button"
                                    title="Excluir lançamento"
                                    aria-label={`Excluir lançamento ${item.description}`}
                                    onClick={() => setDeletingTransaction(item.transactionId)}
                                  >
                                    <Trash2 size={16} />
                                  </button>
                                </div>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
          <Pagination
            page={invoicePage}
            pageSize={invoicePageSize}
            totalCount={invoicePageData?.totalCount ?? 0}
            onPageChange={(page) => {
              setExpanded(undefined);
              setInvoicePage(page);
            }}
            onPageSizeChange={(size) => {
              setExpanded(undefined);
              setInvoicePageSize(size);
              setInvoicePage(0);
            }}
            itemLabel="faturas"
          />
        </article>
      )}
      {matching && (
        <Modal title="Vincular pagamento" onClose={() => setMatching(undefined)}>
          <article className="modal wide-modal">
            <h2>Vincular pagamento de {money(matching.amountInCents)}</h2>
            <p className="muted">
              Sugestões com o mesmo valor e até 10 dias de distância. O vínculo só será criado após sua confirmação.
            </p>
            {matching.candidates.length === 0 ? (
              <p className="notice">Nenhum débito bancário compatível foi encontrado.</p>
            ) : (
              <div className="match-list">
                {matching.candidates.map((candidate) => (
                  <button
                    className="match-row"
                    key={candidate.transactionId}
                    onClick={() => link(candidate.transactionId)}
                  >
                    <span>
                      <b>{candidate.description}</b>
                      <small>
                        {candidate.accountName} · {shortDate(candidate.date)} · {candidate.distanceInDays} dia(s) do
                        vencimento
                      </small>
                    </span>
                    <strong>{money(candidate.amountInCents)}</strong>
                    <Link2 size={17} />
                  </button>
                ))}
              </div>
            )}
            <div className="editor-actions">
              <button className="secondary" onClick={() => setMatching(undefined)}>
                Fechar
              </button>
            </div>
          </article>
        </Modal>
      )}
      {deletingTransaction && (
        <Modal title="Excluir lançamento" onClose={() => setDeletingTransaction(undefined)}>
          <article className="modal">
            <h2>Excluir lançamento</h2>
            <p className="muted">Deseja realmente excluir este lançamento?</p>
            <div className="editor-actions">
              <button className="secondary" onClick={() => setDeletingTransaction(undefined)}>
                Cancelar
              </button>
              <button className="danger" onClick={removeTransaction}>
                Excluir
              </button>
            </div>
          </article>
        </Modal>
      )}
      {accountModal && (
        <AccountModal
          mode={accountModal.mode}
          account={accountModal.account}
          onClose={() => setAccountModal(undefined)}
          onSaved={async () => {
            setAccountModal(undefined);
            await client.invalidateQueries({ queryKey: ["accounts"] });
            toast(accountModal.mode === "new" ? "Conta criada." : "Conta atualizada.");
          }}
        />
      )}
      {archiving && (
        <Modal title="Arquivar conta" onClose={() => setArchiving(undefined)}>
          <p className="muted">
            Arquivar <b>{archiving.name}</b>? Ela deixará de aparecer nas listas. Contas com transações ativas não podem
            ser arquivadas.
          </p>
          <div className="editor-actions">
            <button className="secondary" onClick={() => setArchiving(undefined)}>
              Cancelar
            </button>
            <button className="danger" onClick={confirmArchive}>
              <Archive size={15} /> Arquivar
            </button>
          </div>
        </Modal>
      )}
      {balanceReconciliationAccount && (
        <BalanceReconciliationModal
          account={balanceReconciliationAccount}
          summary={balanceSummaryByAccount.get(balanceReconciliationAccount.id)}
          onClose={() => setBalanceReconciliationAccount(undefined)}
          onSaved={async () => {
            setBalanceReconciliationAccount(undefined);
            await invalidateCheckpointQueries(client);
            toast("Saldo conferido com sucesso.");
          }}
        />
      )}
    </section>
  );
}

function dayMonth(value: string) {
  const [, month, day] = value.split("-");
  return `${day}/${month}`;
}

function BalanceReconciliationModal({
  account,
  summary,
  onClose,
  onSaved,
}: {
  account: Account;
  summary?: AccountBalanceSummary;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const toast = useToast();
  const [asOfDate, setAsOfDate] = useState(todayIso);
  const [balanceInCents, setBalanceInCents] = useState<number | null>(null);
  const [preview, setPreview] = useState<{ data: ReconciliationPreview; input: BalanceCheckpointInput }>();
  const [loadingPreview, setLoadingPreview] = useState(false);
  const previewToken = useRef(0);
  const savingLock = useRef(false);
  const [saving, setSaving] = useState(false);

  function checkpointInput(): BalanceCheckpointInput | undefined {
    if (!asOfDate || balanceInCents === null) return undefined;
    return {
      accountId: account.id,
      asOfDate,
      balanceInCents,
      source: "reconciliation",
    };
  }

  function invalidatePreview() {
    previewToken.current += 1;
    setPreview(undefined);
    setLoadingPreview(false);
  }

  async function loadPreview() {
    const input = checkpointInput();
    if (!input) return;
    const token = ++previewToken.current;
    setPreview(undefined);
    setLoadingPreview(true);
    try {
      const data = await api.reconciliationPreview(input);
      if (token !== previewToken.current) return;
      setPreview({ data, input });
    } catch (error) {
      if (token !== previewToken.current) return;
      toast((error as { message?: string })?.message ?? "Não foi possível calcular a diferença.", "error");
    } finally {
      if (token === previewToken.current) setLoadingPreview(false);
    }
  }

  async function confirmCheckpoint() {
    if (!preview || savingLock.current) return;
    savingLock.current = true;
    const input = preview.input;
    setSaving(true);
    try {
      await api.recordBalanceCheckpoint(input);
      await onSaved();
    } catch (error) {
      toast((error as { message?: string })?.message ?? "Não foi possível conferir o saldo.", "error");
    } finally {
      savingLock.current = false;
      setSaving(false);
    }
  }

  return (
    <Modal
      title={`Conferir saldo de ${account.name}`}
      onClose={() => {
        invalidatePreview();
        onClose();
      }}
    >
      <div className="modal-form">
        <p className="muted">
          Compare o saldo informado com os lançamentos confirmados. A diferença é apenas informativa e não cria receita,
          despesa ou ajuste.
        </p>
        {summary?.lastReconciledAt && (
          <p className="muted">Última conferência em {shortDate(summary.lastReconciledAt)}.</p>
        )}
        <label>
          Data do saldo
          <input
            type="date"
            value={asOfDate}
            onChange={(event) => {
              setAsOfDate(event.target.value);
              invalidatePreview();
            }}
          />
        </label>
        <label htmlFor="reconciliation-balance">
          Saldo informado
          <MoneyInput
            id="reconciliation-balance"
            aria-label="Saldo informado"
            onChange={(value) => {
              setBalanceInCents(value);
              invalidatePreview();
            }}
          />
        </label>
        {preview && (
          <div className="cards" aria-label="Prévia da conferência">
            <div>
              <small>Saldo informado</small>
              <strong>{money(preview.data.reportedBalanceInCents)}</strong>
            </div>
            <div>
              <small>Saldo calculado</small>
              <strong>{money(preview.data.calculatedBalanceInCents)}</strong>
            </div>
            <div>
              <small>Diferença</small>
              <strong>{money(preview.data.differenceInCents)}</strong>
            </div>
          </div>
        )}
        <div className="editor-actions">
          <button
            className="secondary"
            onClick={() => {
              invalidatePreview();
              onClose();
            }}
            disabled={saving}
          >
            Cancelar
          </button>
          {!preview ? (
            <button
              onClick={() => void loadPreview()}
              disabled={!asOfDate || balanceInCents === null || loadingPreview}
            >
              {loadingPreview ? "Calculando…" : "Ver diferença"}
            </button>
          ) : (
            <button onClick={() => void confirmCheckpoint()} disabled={saving}>
              {saving ? "Confirmando…" : "Confirmar conferência"}
            </button>
          )}
        </div>
      </div>
    </Modal>
  );
}

function AccountModal({
  mode,
  account,
  onClose,
  onSaved,
}: {
  mode: "new" | "edit";
  account?: Account;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState(account?.name ?? "");
  const [kind, setKind] = useState<AccountType>(account?.kind ?? "checking");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const kinds: { value: AccountType; label: string }[] = [
    { value: "checking", label: "Conta corrente" },
    { value: "savings", label: "Poupança" },
    { value: "cash", label: "Dinheiro" },
    { value: "credit_card", label: "Cartão de crédito" },
  ];
  async function submit() {
    setError("");
    if (name.trim().length < 2) {
      setError("Informe um nome com pelo menos 2 caracteres.");
      return;
    }
    setSaving(true);
    try {
      if (mode === "edit" && account) await api.renameAccount(account.id, name.trim());
      else await api.createAccount(name.trim(), kind);
      onSaved();
    } catch (e) {
      setError((e as { message?: string })?.message ?? "Não foi possível salvar a conta.");
    } finally {
      setSaving(false);
    }
  }
  return (
    <Modal title={mode === "new" ? "Nova conta" : "Renomear conta"} onClose={onClose}>
      <div className="modal-form">
        <label>
          Nome
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Ex.: Conta corrente, Carteira" />
        </label>
        {mode === "new" && (
          <label>
            Tipo
            <Select
              value={kind}
              onChange={(value) => setKind(value as AccountType)}
              options={kinds.map((item) => ({ value: item.value, label: item.label }))}
            />
          </label>
        )}
        {error && <p className="form-error">{error}</p>}
        <div className="editor-actions">
          <button className="secondary" onClick={onClose} disabled={saving}>
            Cancelar
          </button>
          <button onClick={submit} disabled={saving}>
            {saving ? "Salvando…" : "Salvar"}
          </button>
        </div>
      </div>
    </Modal>
  );
}
