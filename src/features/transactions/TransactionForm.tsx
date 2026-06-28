import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../../shared/api";
import { Modal } from "../../shared/ui/Modal";
import { MoneyInput } from "../../shared/ui/MoneyInput";
import { useToast } from "../../shared/ui/toast";
import { todayIso } from "../../shared/format";
import type { Transaction } from "../../shared/types";

type Props = { onClose: () => void; existing?: Transaction };

export function TransactionForm({ onClose, existing }: Props) {
  const client = useQueryClient();
  const toast = useToast();
  const { data: accounts = [] } = useQuery({ queryKey: ["accounts"], queryFn: api.accounts });
  const { data: categories = [] } = useQuery({ queryKey: ["categories"], queryFn: api.categories });
  const editing = Boolean(existing);
  const [accountId, setAccountId] = useState(existing?.accountId ?? "");
  const [type, setType] = useState<"expense" | "income">(existing && existing.amountInCents > 0 ? "income" : "expense");
  const [cents, setCents] = useState<number | null>(existing ? Math.abs(existing.amountInCents) : null);
  const [date, setDate] = useState(existing?.date ?? todayIso());
  const [description, setDescription] = useState(existing?.description ?? "");
  const [categoryId, setCategoryId] = useState(existing?.categoryId ?? "");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  const resolvedAccountId = accountId || accounts[0]?.id || "";
  const relevantCategories = categories.filter(c => (type === "income" ? c.kind === "income" : c.kind !== "income"));

  async function submit() {
    setError("");
    if (!resolvedAccountId) { setError("Selecione uma conta."); return; }
    if (cents === null || cents <= 0) { setError("Informe um valor maior que zero."); return; }
    if (description.trim().length < 1) { setError("Descreva a transação."); return; }
    const amountInCents = type === "income" ? cents : -cents;
    setSaving(true);
    try {
      const input = {
        id: existing?.id, accountId: resolvedAccountId, date,
        description: description.trim(), amountInCents, categoryId: categoryId || undefined,
      };
      if (editing) await api.updateTransaction(input); else await api.createTransaction(input);
      await Promise.all([
        client.invalidateQueries({ queryKey: ["transactions"] }),
        client.invalidateQueries({ queryKey: ["summary"] }),
        client.invalidateQueries({ queryKey: ["accounts"] }),
        client.invalidateQueries({ queryKey: ["financial-report"] }),
      ]);
      toast(editing ? "Transação atualizada" : "Transação adicionada");
      onClose();
    } catch (e) {
      setError((e as { message?: string })?.message ?? "Não foi possível salvar a transação.");
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
        </div>
        <label>Valor<MoneyInput defaultCents={existing ? Math.abs(existing.amountInCents) : 0} onChange={setCents} autoFocus /></label>
        <div className="form-row">
          <label>Data<input type="date" value={date} onChange={e => setDate(e.target.value)} /></label>
          <label>Conta<select value={resolvedAccountId} onChange={e => setAccountId(e.target.value)}>
            {accounts.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select></label>
        </div>
        <label>Descrição<input value={description} onChange={e => setDescription(e.target.value)} placeholder="Ex.: Mercado, salário, farmácia" /></label>
        <label>Categoria<select value={categoryId} onChange={e => setCategoryId(e.target.value)}>
          <option value="">Sem categoria</option>
          {relevantCategories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select></label>
        {error && <p className="form-error">{error}</p>}
        <div className="editor-actions">
          <button className="secondary" onClick={onClose} disabled={saving}>Cancelar</button>
          <button onClick={submit} disabled={saving}>{saving ? "Salvando…" : editing ? "Salvar" : "Adicionar"}</button>
        </div>
      </div>
    </Modal>
  );
}
