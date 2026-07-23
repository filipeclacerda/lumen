import { PageHeader } from "../../shared/ui/PageHeader";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Archive, Pencil, Play, Repeat, Save } from "lucide-react";
import { api } from "../../shared/api";
import { money } from "../../shared/format";
import { currentMonth } from "../../shared/period";
import { useToast } from "../../shared/ui/toast";
import { CategorySelect } from "../../shared/ui/CategorySelect";
import { MonthPicker } from "../../shared/ui/CalendarPicker";
import { MoneyInput } from "../../shared/ui/MoneyInput";
import type { RecurringTransaction, RecurringTransactionInput } from "../../shared/types";
import { ErrorState, LoadingState } from "../../shared/ui/AsyncState";
import { Select } from "../../shared/ui/Select";

const emptyDraft: RecurringTransactionInput = {
  accountId: "",
  categoryId: undefined,
  description: "",
  amountInCents: 0,
  dayOfMonth: 5,
  startMonth: currentMonth(),
  endMonth: undefined,
};

const dayOptions = Array.from({ length: 30 }, (_, index) => index + 1);
const dayLabel = (day: number) => (day === 31 ? "último dia do mês" : `${day}`);

export function RecurringTransactions() {
  const client = useQueryClient();
  const toast = useToast();
  const {
    data: recurring = [],
    isLoading: recurringLoading,
    isError: recurringError,
    refetch: refetchRecurring,
  } = useQuery({ queryKey: ["recurring"], queryFn: api.recurringTransactions });
  const {
    data: accounts = [],
    isLoading: accountsLoading,
    isError: accountsError,
    refetch: refetchAccounts,
  } = useQuery({ queryKey: ["accounts"], queryFn: api.accounts });
  const {
    data: categories = [],
    isLoading: categoriesLoading,
    isError: categoriesError,
    refetch: refetchCategories,
  } = useQuery({ queryKey: ["categories"], queryFn: api.categories });
  const [draft, setDraft] = useState<RecurringTransactionInput>(emptyDraft);
  const [type, setType] = useState<"expense" | "income">("expense");
  const [amountInCents, setAmountInCents] = useState<number | null>(null);
  const [amountInputVersion, setAmountInputVersion] = useState(0);
  const [error, setError] = useState("");
  const editing = Boolean(draft.id);
  const contentReady =
    !recurringLoading &&
    !accountsLoading &&
    !categoriesLoading &&
    !recurringError &&
    !accountsError &&
    !categoriesError;

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
    setAmountInputVersion((version) => version + 1);
    setDraft({
      id: item.id,
      accountId: item.accountId,
      categoryId: item.categoryId,
      description: item.description,
      amountInCents: item.amountInCents,
      dayOfMonth: item.dayOfMonth,
      startMonth: item.startMonth,
      endMonth: item.endMonth,
    });
    setError("");
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function resetDraft() {
    setDraft({ ...emptyDraft, accountId: accounts[0]?.id ?? "" });
    setAmountInputVersion((version) => version + 1);
    setAmountInCents(null);
    setType("expense");
    setError("");
  }

  async function save() {
    setError("");
    const resolvedAccountId = draft.accountId || accounts[0]?.id || "";
    const cents = amountInCents;
    if (!resolvedAccountId) {
      setError("Selecione uma conta.");
      return;
    }
    if (!cents || cents <= 0) {
      setError("Informe um valor maior que zero.");
      return;
    }
    if (draft.description.trim().length < 1) {
      setError("Descreva a recorrência.");
      return;
    }
    try {
      await api.saveRecurringTransaction({
        ...draft,
        accountId: resolvedAccountId,
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
    toast(
      count > 0
        ? `${count} lançamento${count > 1 ? "s" : ""} gerado${count > 1 ? "s" : ""}`
        : "Nada pendente para gerar",
    );
    await refresh();
  }

  return (
    <section data-tutorial="recurring">
      <PageHeader>
        <div>
          <p className="eyebrow">LANÇAMENTOS AUTOMÁTICOS</p>
          <h1>Recorrências</h1>
          <p className="muted">Aluguel, salário, assinaturas — cadastre uma vez e o Lumen lança todo mês.</p>
        </div>
        <button className="secondary" onClick={syncNow} disabled={!contentReady}>
          <Play size={16} /> Gerar pendentes agora
        </button>
      </PageHeader>
      {(recurringLoading || accountsLoading || categoriesLoading) && (
        <LoadingState variant="panel" label="Carregando recorrências…" />
      )}
      {(recurringError || accountsError || categoriesError) && (
        <ErrorState
          message="Não foi possível carregar as recorrências."
          onRetry={() => void Promise.all([refetchRecurring(), refetchAccounts(), refetchCategories()])}
        />
      )}
      {contentReady && (
        <div className="rules-layout">
          <article className="panel rule-editor recurring-editor">
            <div className="panel-title">
              <h2>{editing ? "Editar recorrência" : "Nova recorrência"}</h2>
              {editing && (
                <button className="text-button" onClick={resetDraft}>
                  Cancelar
                </button>
              )}
            </div>
            <div className="segmented" role="group" aria-label="Tipo de recorrência">
              <button type="button" className={type === "expense" ? "active" : ""} onClick={() => setType("expense")}>
                Despesa
              </button>
              <button type="button" className={type === "income" ? "active" : ""} onClick={() => setType("income")}>
                Receita
              </button>
            </div>
            <label>
              Descrição
              <input
                value={draft.description}
                onChange={(e) => setDraft({ ...draft, description: e.target.value })}
                placeholder="Ex.: Aluguel, Netflix, Salário"
              />
            </label>
            <div className="form-row">
              <label>
                Valor mensal
                <MoneyInput
                  key={`${draft.id ?? "new-recurring"}-${amountInputVersion}`}
                  defaultCents={amountInCents ?? 0}
                  onChange={setAmountInCents}
                />
              </label>
              <label>
                Dia do mês
                <Select
                  value={draft.dayOfMonth}
                  onChange={(value) => setDraft({ ...draft, dayOfMonth: Number(value) })}
                  options={[
                    ...dayOptions.map((day) => ({ value: String(day), label: String(day) })),
                    { value: "31", label: "Último dia do mês" },
                  ]}
                />
              </label>
            </div>
            <div className="form-row">
              <label>
                Conta
                <Select
                  value={draft.accountId || accounts[0]?.id || ""}
                  onChange={(value) => setDraft({ ...draft, accountId: value })}
                  options={accounts.map((account) => ({ value: account.id, label: account.name }))}
                />
              </label>
              <label>
                Categoria
                <CategorySelect
                  value={draft.categoryId}
                  onChange={(id) => setDraft({ ...draft, categoryId: id })}
                  categories={categories}
                  movementType={type}
                  allowEmpty
                  emptyLabel="Sem categoria"
                />
              </label>
            </div>
            <div className="form-row">
              <label>
                Começa em
                <MonthPicker
                  ariaLabel="Mês de início da recorrência"
                  value={draft.startMonth}
                  onChange={(value) => setDraft({ ...draft, startMonth: value })}
                  allowClear={false}
                />
              </label>
              <label>
                Termina em (opcional)
                <MonthPicker
                  ariaLabel="Mês de término da recorrência"
                  value={draft.endMonth ?? ""}
                  onChange={(value) => setDraft({ ...draft, endMonth: value || undefined })}
                />
              </label>
            </div>
            {error && <p className="form-error">{error}</p>}
            <div className="editor-actions">
              <button onClick={save}>
                <Save size={16} /> {editing ? "Salvar" : "Criar recorrência"}
              </button>
            </div>
          </article>
          <article className="panel">
            <div className="panel-title">
              <h2>Recorrências cadastradas</h2>
              <span>{recurring.length}</span>
            </div>
            {recurring.length === 0 && (
              <div className="report-empty">
                <Repeat />
                <div>
                  <b>Nenhuma recorrência cadastrada</b>
                  <p>Cadastre despesas e receitas fixas para não esquecer de lançá-las todo mês.</p>
                </div>
              </div>
            )}
            <div className="recurring-list">
              {recurring.map((item) => (
                <div key={item.id} className={`recurring-row ${item.active ? "" : "inactive"}`}>
                  <div>
                    <b>{item.description}</b>
                    <small>
                      {item.accountName}
                      {item.categoryName ? ` · ${item.categoryName}` : ""} · todo {dayLabel(item.dayOfMonth)}
                    </small>
                  </div>
                  <strong className={`recurring-amount ${item.amountInCents > 0 ? "positive" : "negative"}`}>
                    {money(item.amountInCents)}
                  </strong>
                  <button className="secondary" onClick={() => toggleActive(item)}>
                    {item.active ? "Pausar" : "Reativar"}
                  </button>
                  <div className="row-actions">
                    <button
                      className="icon-button"
                      title="Editar"
                      aria-label={`Editar ${item.description}`}
                      onClick={() => edit(item)}
                    >
                      <Pencil size={14} />
                    </button>
                    <button
                      className="danger icon-button"
                      title="Excluir"
                      aria-label={`Excluir ${item.description}`}
                      onClick={() => archive(item.id)}
                    >
                      <Archive size={14} />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </article>
        </div>
      )}
    </section>
  );
}
