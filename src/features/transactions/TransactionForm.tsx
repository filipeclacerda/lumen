import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowRight } from "lucide-react";
import { api } from "../../shared/api";
import { Modal } from "../../shared/ui/Modal";
import { MoneyInput } from "../../shared/ui/MoneyInput";
import { CategorySelect } from "../../shared/ui/CategorySelect";
import { useToast } from "../../shared/ui/toast";
import { todayIso } from "../../shared/format";
import type { Transaction } from "../../shared/types";
import { Select } from "../../shared/ui/Select";

export type TransactionEntryType = "expense" | "income" | "transfer";
type Props = { onClose: () => void; existing?: Transaction; initialType?: TransactionEntryType };

export function TransactionForm({ onClose, existing, initialType = "expense" }: Props) {
  const client = useQueryClient();
  const toast = useToast();
  const { data: accounts = [] } = useQuery({ queryKey: ["accounts"], queryFn: api.accounts });
  const { data: categories = [] } = useQuery({ queryKey: ["categories"], queryFn: api.categories });
  const editing = Boolean(existing);
  const isTransferLeg = Boolean(existing?.isTransferLeg);
  const [accountId, setAccountId] = useState(existing?.accountId ?? "");
  const [toAccountId, setToAccountId] = useState("");
  const [type, setType] = useState<TransactionEntryType>(
    existing ? (existing.amountInCents > 0 ? "income" : "expense") : initialType,
  );
  const [cents, setCents] = useState<number | null>(existing ? Math.abs(existing.amountInCents) : null);
  const [date, setDate] = useState(existing?.date ?? todayIso());
  const [description, setDescription] = useState(existing?.description ?? "");
  const [categoryId, setCategoryId] = useState(existing?.categoryId ?? "");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  const resolvedAccountId = accountId || accounts[0]?.id || "";
  const destinationAccounts = accounts.filter((a) => a.id !== resolvedAccountId);
  const resolvedToAccountId =
    toAccountId && toAccountId !== resolvedAccountId ? toAccountId : destinationAccounts[0]?.id || "";

  async function invalidate() {
    await Promise.all([
      client.invalidateQueries({ queryKey: ["transactions"] }),
      client.invalidateQueries({ queryKey: ["summary"] }),
      client.invalidateQueries({ queryKey: ["accounts"] }),
      client.invalidateQueries({ queryKey: ["financial-report"] }),
    ]);
  }

  async function submit() {
    setError("");
    if (!resolvedAccountId) {
      setError("Selecione uma conta.");
      return;
    }
    if (cents === null || cents <= 0) {
      setError("Informe um valor maior que zero.");
      return;
    }
    setSaving(true);
    try {
      if (type === "transfer" && !editing) {
        if (!resolvedToAccountId) {
          setError("Selecione a conta de destino.");
          setSaving(false);
          return;
        }
        await api.createTransfer({
          fromAccountId: resolvedAccountId,
          toAccountId: resolvedToAccountId,
          date,
          amountInCents: cents,
          description: description.trim() || undefined,
        });
        await invalidate();
        toast("Transferência registrada");
        onClose();
        return;
      }
      if (description.trim().length < 1) {
        setError("Descreva a transação.");
        setSaving(false);
        return;
      }
      const amountInCents = isTransferLeg && existing ? existing.amountInCents : type === "income" ? cents : -cents;
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
      setSaving(false);
    }
  }

  return (
    <Modal title={editing ? "Editar transação" : "Nova transação"} onClose={onClose}>
      <div className="modal-form">
        <div className="segmented" role="group" aria-label="Tipo de transação">
          <button type="button" className={type === "expense" ? "active" : ""} onClick={() => setType("expense")}>
            Despesa
          </button>
          <button type="button" className={type === "income" ? "active" : ""} onClick={() => setType("income")}>
            Receita
          </button>
          <button
            type="button"
            className={type === "transfer" ? "active" : ""}
            onClick={() => setType("transfer")}
            disabled={editing}
          >
            Transferência
          </button>
        </div>
        {isTransferLeg && (
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
            disabled={isTransferLeg}
          />
        </label>
        {type === "transfer" && !editing ? (
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
                <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
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
                <input type="date" value={date} onChange={(e) => setDate(e.target.value)} disabled={isTransferLeg} />
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
              Descrição
              <input
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Ex.: Mercado, salário, farmácia"
              />
            </label>
            <CategorySelect
              value={categoryId}
              onChange={(id) => setCategoryId(id ?? "")}
              categories={categories}
              movementType={type}
              allowEmpty
              emptyLabel="Sem categoria"
              disabled={isTransferLeg}
            />
          </>
        )}
        {error && <p className="form-error">{error}</p>}
        <div className="editor-actions">
          <button className="secondary" onClick={onClose} disabled={saving}>
            Cancelar
          </button>
          <button
            onClick={submit}
            disabled={saving || (type === "transfer" && !editing && destinationAccounts.length === 0)}
          >
            {saving ? "Salvando…" : editing ? "Salvar" : type === "transfer" ? "Transferir" : "Adicionar"}
          </button>
        </div>
      </div>
    </Modal>
  );
}
