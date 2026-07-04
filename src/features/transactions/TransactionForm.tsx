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

type Props = { onClose: () => void; existing?: Transaction };
type EntryType = "expense" | "income" | "transfer";

export function TransactionForm({ onClose, existing }: Props) {
  const client = useQueryClient();
  const toast = useToast();
  const { data: accounts = [] } = useQuery({ queryKey: ["accounts"], queryFn: api.accounts });
  const { data: categories = [] } = useQuery({ queryKey: ["categories"], queryFn: api.categories });
  const editing = Boolean(existing);
  const [accountId, setAccountId] = useState(existing?.accountId ?? "");
  const [toAccountId, setToAccountId] = useState("");
  const [type, setType] = useState<EntryType>(existing && existing.amountInCents > 0 ? "income" : "expense");
  const [cents, setCents] = useState<number | null>(existing ? Math.abs(existing.amountInCents) : null);
  const [date, setDate] = useState(existing?.date ?? todayIso());
  const [description, setDescription] = useState(existing?.description ?? "");
  const [categoryId, setCategoryId] = useState(existing?.categoryId ?? "");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  const resolvedAccountId = accountId || accounts[0]?.id || "";
  const destinationAccounts = accounts.filter(a => a.id !== resolvedAccountId);
  const resolvedToAccountId = toAccountId && toAccountId !== resolvedAccountId ? toAccountId : destinationAccounts[0]?.id || "";

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
    if (!resolvedAccountId) { setError("Selecione uma conta."); return; }
    if (cents === null || cents <= 0) { setError("Informe um valor maior que zero."); return; }
    setSaving(true);
    try {
      if (type === "transfer") {
        if (!resolvedToAccountId) { setError("Selecione a conta de destino."); setSaving(false); return; }
        await api.createTransfer({
          fromAccountId: resolvedAccountId, toAccountId: resolvedToAccountId, date,
          amountInCents: cents, description: description.trim() || undefined,
        });
        await invalidate();
        toast("Transferência registrada");
        onClose();
        return;
      }
      if (description.trim().length < 1) { setError("Descreva a transação."); setSaving(false); return; }
      const amountInCents = type === "income" ? cents : -cents;
      const input = {
        id: existing?.id, accountId: resolvedAccountId, date,
        description: description.trim(), amountInCents, categoryId: categoryId || undefined,
      };
      if (editing) await api.updateTransaction(input); else await api.createTransaction(input);
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
          <button type="button" className={type === "expense" ? "active" : ""} onClick={() => setType("expense")}>Despesa</button>
          <button type="button" className={type === "income" ? "active" : ""} onClick={() => setType("income")}>Receita</button>
          {!editing && <button type="button" className={type === "transfer" ? "active" : ""} onClick={() => setType("transfer")}>Transferência</button>}
        </div>
        <label>Valor<MoneyInput defaultCents={existing ? Math.abs(existing.amountInCents) : 0} onChange={setCents} autoFocus /></label>
        {type === "transfer" ? (
          <>
            <div className="form-row transfer-row">
              <label>De<select value={resolvedAccountId} onChange={e => setAccountId(e.target.value)}>
                {accounts.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
              </select></label>
              <ArrowRight size={16} className="transfer-arrow" aria-hidden />
              <label>Para<select value={resolvedToAccountId} onChange={e => setToAccountId(e.target.value)}>
                {destinationAccounts.length === 0 && <option value="">Cadastre outra conta</option>}
                {destinationAccounts.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
              </select></label>
            </div>
            <div className="form-row">
              <label>Data<input type="date" value={date} onChange={e => setDate(e.target.value)} /></label>
              <label>Descrição (opcional)<input value={description} onChange={e => setDescription(e.target.value)} placeholder="Ex.: Reserva de emergência" /></label>
            </div>
            <p className="muted" style={{ fontSize: 13, margin: 0 }}>
              A transferência não conta como receita nem despesa — apenas move dinheiro entre suas contas.
            </p>
          </>
        ) : (
          <>
            <div className="form-row">
              <label>Data<input type="date" value={date} onChange={e => setDate(e.target.value)} /></label>
              <label>Conta<select value={resolvedAccountId} onChange={e => setAccountId(e.target.value)}>
                {accounts.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
              </select></label>
            </div>
            <label>Descrição<input value={description} onChange={e => setDescription(e.target.value)} placeholder="Ex.: Mercado, salário, farmácia" /></label>
            <CategorySelect
              value={categoryId}
              onChange={setCategoryId}
              categories={categories}
              movementType={type}
              allowEmpty
              emptyLabel="Sem categoria"
            />
          </>
        )}
        {error && <p className="form-error">{error}</p>}
        <div className="editor-actions">
          <button className="secondary" onClick={onClose} disabled={saving}>Cancelar</button>
          <button onClick={submit} disabled={saving || (type === "transfer" && destinationAccounts.length === 0)}>
            {saving ? "Salvando…" : type === "transfer" ? "Transferir" : editing ? "Salvar" : "Adicionar"}
          </button>
        </div>
      </div>
    </Modal>
  );
}
