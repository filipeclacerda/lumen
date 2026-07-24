import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowRight } from "lucide-react";
import { api } from "../../shared/api";
import { Modal } from "../../shared/ui/Modal";
import { MoneyInput } from "../../shared/ui/MoneyInput";
import { CategorySelect } from "../../shared/ui/CategorySelect";
import { DatePicker } from "../../shared/ui/CalendarPicker";
import { useToast } from "../../shared/ui/toast";
import { invalidateTransactionDerivedQueries } from "../../shared/queryInvalidation";
import { money, shortDate, todayIso } from "../../shared/format";
import { addMonthsClamped, splitInstallmentCents } from "../../shared/installments";
import type { Transaction } from "../../shared/types";
import { Select } from "../../shared/ui/Select";
import { ErrorState, LoadingState } from "../../shared/ui/AsyncState";

export type TransactionEntryType = "expense" | "income" | "transfer";
type Props = { onClose: () => void; existing?: Transaction; initialType?: TransactionEntryType };

export function TransactionForm({ onClose, existing, initialType = "expense" }: Props) {
  const client = useQueryClient();
  const toast = useToast();
  const { data: accounts = [] } = useQuery({ queryKey: ["accounts"], queryFn: api.accounts });
  const { data: categories = [] } = useQuery({ queryKey: ["categories"], queryFn: api.categories });
  const editing = Boolean(existing);
  const isTransferLeg = Boolean(existing?.isTransferLeg);
  const isAccountTransfer = existing?.linkedKind === "transfer";
  const {
    data: transferDetails,
    isLoading: transferLoading,
    isError: transferError,
    refetch: refetchTransfer,
  } = useQuery({
    queryKey: ["transfer-details", existing?.id],
    queryFn: () => api.getTransferDetails(existing!.id),
    enabled: Boolean(existing?.id && isAccountTransfer),
  });
  const [accountId, setAccountId] = useState(existing?.accountId ?? "");
  const [toAccountId, setToAccountId] = useState("");
  const [type, setType] = useState<TransactionEntryType>(
    isAccountTransfer ? "transfer" : existing ? (existing.amountInCents > 0 ? "income" : "expense") : initialType,
  );
  const [cents, setCents] = useState<number | null>(existing ? Math.abs(existing.amountInCents) : null);
  const [date, setDate] = useState(existing?.date ?? todayIso());
  const [description, setDescription] = useState(existing?.description ?? "");
  const [categoryId, setCategoryId] = useState(existing?.categoryId ?? "");
  const [installmentsEnabled, setInstallmentsEnabled] = useState(false);
  const [installmentCount, setInstallmentCount] = useState(2);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const submitLock = useRef(false);

  useEffect(() => {
    if (!transferDetails) return;
    setAccountId(transferDetails.fromAccountId);
    setToAccountId(transferDetails.toAccountId);
    setCents(transferDetails.amountInCents);
    setDate(transferDetails.date);
    setDescription(transferDetails.description ?? "");
  }, [transferDetails]);

  const resolvedAccountId = accountId || accounts[0]?.id || "";
  const selectedAccount = accounts.find((account) => account.id === resolvedAccountId);
  const canCreateInstallments = !editing && type === "expense" && selectedAccount?.kind === "credit_card";
  const installmentParts =
    canCreateInstallments && installmentsEnabled && cents ? splitInstallmentCents(cents, installmentCount) : [];
  const finalInstallmentDate =
    installmentParts.length > 0 ? addMonthsClamped(date, installmentParts.length - 1) : undefined;
  const destinationAccounts = accounts.filter((a) => a.id !== resolvedAccountId);
  const resolvedToAccountId =
    toAccountId && toAccountId !== resolvedAccountId ? toAccountId : destinationAccounts[0]?.id || "";

  async function invalidate() {
    await invalidateTransactionDerivedQueries(client);
  }

  async function submit() {
    if (submitLock.current) return;
    setError("");
    if (!resolvedAccountId) {
      setError("Selecione uma conta.");
      return;
    }
    if (cents === null || cents <= 0) {
      setError("Informe um valor maior que zero.");
      return;
    }
    submitLock.current = true;
    setSaving(true);
    try {
      if (type === "transfer" && (!editing || isAccountTransfer)) {
        if (!resolvedToAccountId) {
          setError("Selecione a conta de destino.");
          submitLock.current = false;
          setSaving(false);
          return;
        }
        const transferInput = {
          fromAccountId: resolvedAccountId,
          toAccountId: resolvedToAccountId,
          date,
          amountInCents: cents,
          description: description.trim() || undefined,
        };
        if (isAccountTransfer && existing) await api.updateTransfer(existing.id, transferInput);
        else await api.createTransfer(transferInput);
        await invalidate();
        toast(isAccountTransfer ? "Transferência atualizada" : "Transferência registrada");
        onClose();
        return;
      }
      if (description.trim().length < 1) {
        setError("Descreva a transação.");
        submitLock.current = false;
        setSaving(false);
        return;
      }
      const amountInCents = isTransferLeg && existing ? existing.amountInCents : type === "income" ? cents : -cents;
      if (canCreateInstallments && installmentsEnabled) {
        await api.createCreditCardInstallments({
          accountId: resolvedAccountId,
          firstDate: date,
          description: description.trim(),
          totalAmountInCents: cents,
          installmentCount,
          categoryId: categoryId || undefined,
        });
        await invalidate();
        toast(`${installmentCount} parcelas adicionadas`);
        onClose();
        return;
      }
      const input = {
        id: existing?.id,
        accountId: isTransferLeg && existing ? existing.accountId : resolvedAccountId,
        date: isTransferLeg && existing ? existing.date : date,
        description: description.trim(),
        amountInCents,
        categoryId: categoryId || undefined,
      };
      if (editing) await api.updateTransaction(input);
      else await api.createTransaction(input);
      await invalidate();
      toast(editing ? "Transação atualizada" : "Transação adicionada");
      onClose();
    } catch (e) {
      setError((e as { message?: string })?.message ?? "Não foi possível salvar.");
    } finally {
      submitLock.current = false;
      setSaving(false);
    }
  }

  if (isAccountTransfer && transferLoading) {
    return (
      <Modal title="Editar transferência" onClose={onClose}>
        <LoadingState variant="panel" label="Carregando transferência…" />
      </Modal>
    );
  }
  if (isAccountTransfer && transferError) {
    return (
      <Modal title="Editar transferência" onClose={onClose}>
        <ErrorState message="Não foi possível carregar a transferência." onRetry={() => void refetchTransfer()} />
      </Modal>
    );
  }

  return (
    <Modal
      title={isAccountTransfer ? "Editar transferência" : editing ? "Editar transação" : "Nova transação"}
      onClose={onClose}
    >
      <div className="modal-form">
        <div className="segmented" role="group" aria-label="Tipo de transação">
          <button
            type="button"
            className={type === "expense" ? "active" : ""}
            onClick={() => setType("expense")}
            disabled={isAccountTransfer}
          >
            Despesa
          </button>
          <button
            type="button"
            className={type === "income" ? "active" : ""}
            onClick={() => setType("income")}
            disabled={isAccountTransfer}
          >
            Receita
          </button>
          <button
            type="button"
            className={type === "transfer" ? "active" : ""}
            onClick={() => setType("transfer")}
            disabled={editing && !isAccountTransfer}
          >
            Transferência
          </button>
        </div>
        {isTransferLeg && !isAccountTransfer && (
          <p className="muted" style={{ fontSize: 13, margin: 0 }}>
            Esta transação está vinculada; valor, data, conta e categoria ficam travados para manter o vínculo.
          </p>
        )}
        <label>
          Valor
          <MoneyInput
            defaultCents={existing ? Math.abs(existing.amountInCents) : 0}
            onChange={setCents}
            autoFocus
            disabled={isTransferLeg && !isAccountTransfer}
          />
        </label>
        {type === "transfer" && (!editing || isAccountTransfer) ? (
          <>
            <div className="form-row transfer-row">
              <label>
                De
                <Select
                  value={resolvedAccountId}
                  onChange={setAccountId}
                  options={accounts.map((account) => ({ value: account.id, label: account.name }))}
                />
              </label>
              <ArrowRight size={16} className="transfer-arrow" aria-hidden />
              <label>
                Para
                <Select
                  value={resolvedToAccountId}
                  onChange={setToAccountId}
                  options={[
                    ...(destinationAccounts.length === 0 ? [{ value: "", label: "Cadastre outra conta" }] : []),
                    ...destinationAccounts.map((account) => ({ value: account.id, label: account.name })),
                  ]}
                />
              </label>
            </div>
            <div className="form-row">
              <label>
                Data
                <DatePicker ariaLabel="Data da transferência" value={date} onChange={setDate} />
              </label>
              <label>
                Descrição (opcional)
                <input
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Ex.: Reserva de emergência"
                />
              </label>
            </div>
            <p className="muted" style={{ fontSize: 13, margin: 0 }}>
              A transferência não conta como receita nem despesa — apenas move dinheiro entre suas contas.
            </p>
          </>
        ) : (
          <>
            <div className="form-row">
              <label>
                Data
                <DatePicker ariaLabel="Data da transação" value={date} onChange={setDate} disabled={isTransferLeg} />
              </label>
              <label>
                Conta
                <Select
                  value={resolvedAccountId}
                  onChange={setAccountId}
                  disabled={isTransferLeg}
                  options={accounts.map((account) => ({ value: account.id, label: account.name }))}
                />
              </label>
            </div>
            <label>
              {existing?.isImported ? "Nome exibido" : "Descrição"}
              <input
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Ex.: Mercado, salário, farmácia"
              />
            </label>
            {existing?.isImported && (
              <p className="muted imported-original-description">
                Texto original do banco: <strong>{existing.originalDescription ?? existing.description}</strong>
              </p>
            )}
            <CategorySelect
              value={categoryId}
              onChange={(id) => setCategoryId(id ?? "")}
              categories={categories}
              movementType={type}
              allowEmpty
              emptyLabel="Sem categoria"
              disabled={isTransferLeg}
              aria-label="Categoria da transação"
            />
            {canCreateInstallments && (
              <section className="installment-editor" aria-label="Parcelamento da compra">
                <label className="installment-toggle">
                  <input
                    type="checkbox"
                    checked={installmentsEnabled}
                    onChange={(event) => setInstallmentsEnabled(event.target.checked)}
                  />
                  <span>
                    <strong>Parcelar esta compra</strong>
                    <small>O Lumen cria um lançamento por mês, sem perder centavos.</small>
                  </span>
                </label>
                {installmentsEnabled && (
                  <div className="installment-details">
                    <label htmlFor="installment-count">
                      Número de parcelas
                      <input
                        id="installment-count"
                        type="number"
                        inputMode="numeric"
                        min={2}
                        max={48}
                        step={1}
                        value={installmentCount}
                        onChange={(event) => {
                          const value = Number(event.target.value);
                          setInstallmentCount(Math.max(2, Math.min(48, Math.trunc(value) || 2)));
                        }}
                      />
                    </label>
                    {installmentParts.length > 0 && (
                      <div className="installment-preview" role="status" aria-live="polite">
                        <strong>Total {money(cents ?? 0)}</strong>
                        <span>
                          {installmentParts.every((part) => part === installmentParts[0])
                            ? `${installmentCount} × ${money(installmentParts[0])}`
                            : `${installmentParts.filter((part) => part === installmentParts[0]).length} × ${money(
                                installmentParts[0],
                              )} + ${
                                installmentParts.length -
                                installmentParts.filter((part) => part === installmentParts[0]).length
                              } × ${money(installmentParts.at(-1) ?? 0)}`}
                        </span>
                        {finalInstallmentDate && (
                          <small>
                            Primeira em {shortDate(date)} · última em {shortDate(finalInstallmentDate)}
                          </small>
                        )}
                        <small>Depois de criado, cada lançamento pode ser editado individualmente.</small>
                      </div>
                    )}
                  </div>
                )}
              </section>
            )}
          </>
        )}
        {error && <p className="form-error">{error}</p>}
        <div className="editor-actions">
          <button className="secondary" onClick={onClose} disabled={saving}>
            Cancelar
          </button>
          <button
            onClick={submit}
            disabled={
              saving ||
              transferLoading ||
              (type === "transfer" && (!editing || isAccountTransfer) && destinationAccounts.length === 0)
            }
          >
            {saving
              ? "Salvando…"
              : isAccountTransfer
                ? "Salvar transferência"
                : editing
                  ? "Salvar"
                  : type === "transfer"
                    ? "Transferir"
                    : "Adicionar"}
          </button>
        </div>
      </div>
    </Modal>
  );
}
