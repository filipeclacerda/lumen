import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Archive, Pencil, Play, Repeat, Save } from "lucide-react";
import { api } from "../../shared/api";
import { money } from "../../shared/format";
import { currentMonth } from "../../shared/period";
import { useToast } from "../../shared/ui/toast";
import { CategorySelect } from "../../shared/ui/CategorySelect";
import { MoneyInput } from "../../shared/ui/MoneyInput";
import type { RecurringTransaction, RecurringTransactionInput } from "../../shared/types";

const emptyDraft: RecurringTransactionInput = {
  accountId: "", categoryId: undefined, description: "", amountInCents: 0,
  dayOfMonth: 5, startMonth: currentMonth(), endMonth: undefined,
};

const dayOptions = Array.from({ length: 30 }, (_, index) => index + 1);
const dayLabel = (day: number) => day === 31 ? "último dia do mês" : `${day}`;

export function RecurringTransactions() {
  const client = useQueryClient();
  const toast = useToast();
  const { data: recurring = [] } = useQuery({ queryKey: ["recurring"], queryFn: api.recurringTransactions });
  const { data: accounts = [] } = useQuery({ queryKey: ["accounts"], queryFn: api.accounts });
  const { data: categories = [] } = useQuery({ queryKey: ["categories"], queryFn: api.categories });
  const [draft, setDraft] = useState<RecurringTransactionInput>(emptyDraft);
  const [type, setType] = useState<"expense" | "income">("expense");
  const [amountInCents, setAmountInCents] = useState<number | null>(null);
  const [amountInputVersion, setAmountInputVersion] = useState(0);
  const [error, setError] = useState("");
  const editing = Boolean(draft.id);

  async function refresh() {
    await Promise.all([
      client.invalidateQueries({ queryKey: ["recurring"] }),
      client.invalidateQueries({ queryKey: ["transactions"] }),
      client.invalidateQueries({ queryKey: ["summary"] }),
      client.invalidateQueries({ queryKey: ["financial-report"] }),
    ]);
  }

  function edit(item: RecurringTransaction) {
    setType(item.amountInCents > 0 ? "income" : "expense");
    setAmountInCents(Math.abs(item.amountInCents));
    setAmountInputVersion(version => version + 1);
    setDraft({
      id: item.id, accountId: item.accountId, categoryId: item.categoryId, description: item.description,
      amountInCents: item.amountInCents, dayOfMonth: item.dayOfMonth, startMonth: item.startMonth, endMonth: item.endMonth,
    });
    setError("");
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function resetDraft() {
    setDraft({ ...emptyDraft, accountId: accounts[0]?.id ?? "" });
    setAmountInputVersion(version => version + 1);
    setAmountInCents(null); setType("expense"); setError("");
  }

  async function save() {
    setError("");
    const resolvedAccountId = draft.accountId || accounts[0]?.id || "";
    const cents = amountInCents;
    if (!resolvedAccountId) { setError("Selecione uma conta."); return; }
    if (!cents || cents <= 0) { setError("Informe um valor maior que zero."); return; }
    if (draft.description.trim().length < 1) { setError("Descreva a recorrência."); return; }
    try {
      await api.saveRecurringTransaction({
        ...draft, accountId: resolvedAccountId,
        amountInCents: type === "income" ? cents : -cents,
        description: draft.description.trim(),
      });
      toast(editing ? "Recorrência atualizada" : "Recorrência criada");
      resetDraft();
      await refresh();
    } catch (e) {
      setError((e as { message?: string })?.message ?? "Não foi possível salvar.");
    }
  }

  async function toggleActive(item: RecurringTransaction) {
    await api.setRecurringTransactionActive(item.id, !item.active);
    await refresh();
  }
  async function archive(id: string) {
    await api.archiveRecurringTransaction(id);
    if (draft.id === id) resetDraft();
    await refresh();
  }
  async function syncNow() {
    const count = await api.syncRecurringTransactions();
    toast(count > 0 ? `${count} lançamento${count > 1 ? "s" : ""} gerado${count > 1 ? "s" : ""}` : "Nada pendente para gerar");
    await refresh();
  }

  return <section>
    <header><div><p className="eyebrow">LANÇAMENTOS AUTOMÁTICOS</p><h1>Recorrências</h1>
      <p className="muted">Aluguel, salário, assinaturas — cadastre uma vez e o Lumen lança todo mês.</p></div>
      <button className="secondary" onClick={syncNow}><Play size={16} /> Gerar pendentes agora</button>
    </header>
    <div className="rules-layout">
      <article className="panel rule-editor">
        <div className="panel-title"><h2>{editing ? "Editar recorrência" : "Nova recorrência"}</h2>
          {editing && <button className="text-button" onClick={resetDraft}>Cancelar</button>}</div>
        <div className="segmented" role="group" aria-label="Tipo de recorrência">
          <button type="button" className={type === "expense" ? "active" : ""} onClick={() => setType("expense")}>Despesa</button>
          <button type="button" className={type === "income" ? "active" : ""} onClick={() => setType("income")}>Receita</button>
        </div>
        <label>Descrição<input value={draft.description} onChange={e => setDraft({ ...draft, description: e.target.value })} placeholder="Ex.: Aluguel, Netflix, Salário" /></label>
        <div className="form-row">
          <label>Valor mensal
            <MoneyInput
              key={`${draft.id ?? "new-recurring"}-${amountInputVersion}`}
              defaultCents={amountInCents ?? 0}
              onChange={setAmountInCents}
            />
          </label>
          <label>Dia do mês<select value={draft.dayOfMonth} onChange={e => setDraft({ ...draft, dayOfMonth: Number(e.target.value) })}>
            {dayOptions.map(day => <option key={day} value={day}>{day}</option>)}
            <option value={31}>Último dia do mês</option>
          </select></label>
        </div>
        <div className="form-row">
          <label>Conta<select value={draft.accountId || accounts[0]?.id || ""} onChange={e => setDraft({ ...draft, accountId: e.target.value })}>
            {accounts.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select></label>
          <CategorySelect
            value={draft.categoryId}
            onChange={id => setDraft({ ...draft, categoryId: id })}
            categories={categories}
            movementType={type}
            allowEmpty
            emptyLabel="Sem categoria"
          />
        </div>
        <div className="form-row">
          <label>Começa em<input type="month" value={draft.startMonth} onChange={e => setDraft({ ...draft, startMonth: e.target.value })} /></label>
          <label>Termina em (opcional)<input type="month" value={draft.endMonth ?? ""} onChange={e => setDraft({ ...draft, endMonth: e.target.value || undefined })} /></label>
        </div>
        {error && <p className="form-error">{error}</p>}
        <div className="editor-actions"><button onClick={save}><Save size={16} /> {editing ? "Salvar" : "Criar recorrência"}</button></div>
      </article>
      <article className="panel">
        <div className="panel-title"><h2>Recorrências cadastradas</h2><span>{recurring.length}</span></div>
        {recurring.length === 0 && <div className="report-empty"><Repeat /><div><b>Nenhuma recorrência cadastrada</b>
          <p>Cadastre despesas e receitas fixas para não esquecer de lançá-las todo mês.</p></div></div>}
        <div className="recurring-list">{recurring.map(item => <div key={item.id} className={`recurring-row ${item.active ? "" : "inactive"}`}>
          <div><b>{item.description}</b>
            <small>{item.accountName}{item.categoryName ? ` · ${item.categoryName}` : ""} · todo {dayLabel(item.dayOfMonth)}</small></div>
          <strong className={`recurring-amount ${item.amountInCents > 0 ? "positive" : "negative"}`}>{money(item.amountInCents)}</strong>
          <button className="secondary" onClick={() => toggleActive(item)}>{item.active ? "Pausar" : "Reativar"}</button>
          <div className="row-actions">
            <button className="icon-button" title="Editar" aria-label={`Editar ${item.description}`} onClick={() => edit(item)}><Pencil size={14} /></button>
            <button className="danger icon-button" title="Excluir" aria-label={`Excluir ${item.description}`} onClick={() => archive(item.id)}><Archive size={14} /></button>
          </div>
        </div>)}</div>
      </article>
    </div>
  </section>;
}
