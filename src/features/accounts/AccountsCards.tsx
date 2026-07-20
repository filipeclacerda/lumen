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
import { useEffect, useState } from "react";
import { api } from "../../shared/api";
import { money, shortDate } from "../../shared/format";
import { Modal } from "../../shared/ui/Modal";
import { useToast } from "../../shared/ui/toast";
import { EmptyState, ErrorState, LoadingState } from "../../shared/ui/AsyncState";
import { Pagination, type PaginationSize } from "../../shared/ui/Pagination";
import { Select } from "../../shared/ui/Select";
import type { Account, AccountType, CreditCardInvoice, PaymentMatchCandidate } from "../../shared/types";

export function AccountsCards() {
  const client = useQueryClient();
  const toast = useToast();
  const [accountModal, setAccountModal] = useState<{ mode: "new" | "edit"; account?: Account }>();
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
  const {
    data: accounts = [],
    isLoading: accountsLoading,
    isError: accountsError,
    refetch: refetchAccounts,
  } = useQuery({ queryKey: ["accounts"], queryFn: api.accounts });
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
      client.invalidateQueries({ queryKey: ["transactions"] }),
      client.invalidateQueries({ queryKey: ["summary"] }),
      client.invalidateQueries({ queryKey: ["accounts"] }),
    ]);
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
    <section>
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
          {accounts.map((account) => (
            <article className="account-card" key={account.id}>
              <div className={`metric-icon ${account.kind === "credit_card" ? "red" : "green"}`}>
                {account.kind === "credit_card" ? <CreditCard /> : <Landmark />}
              </div>
              <div>
                <small>{account.kind === "credit_card" ? "Cartão de crédito" : "Conta"}</small>
                <h3>{account.name}</h3>
              </div>
              <div className="account-card-right">
                <strong>{money(account.balanceInCents)}</strong>
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
          ))}
        </div>
      )}
      {invoicesLoading && <LoadingState variant="panel" label="Carregando faturas…" />}
      {invoicesError && (
        <ErrorState message="Não foi possível carregar as faturas." onRetry={() => void refetchInvoices()} />
      )}
      {!invoicesLoading && !invoicesError && (
        <article className="panel">
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
                      <small>Créditos e pagamentos</small>
                      <b>{money(invoice.creditsInCents)}</b>
                    </div>
                    <div className="invoice-metric invoice-total-value">
                      <small>Total</small>
                      <strong>{money(invoice.totalInCents)}</strong>
                    </div>
                    <div className="invoice-status">
                      <span className={`badge ${invoice.status === "paid" ? "success-badge" : ""}`}>
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
    </section>
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
