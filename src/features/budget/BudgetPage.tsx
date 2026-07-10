import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Trash2, Wallet } from "lucide-react";
import { api } from "../../shared/api";
import { money } from "../../shared/format";
import { currentMonth as curMonth, monthLabel } from "../../shared/period";
import { MonthNavigator } from "../../shared/ui/MonthNavigator";
import { CategorySelect } from "../../shared/ui/CategorySelect";
import { MoneyInput } from "../../shared/ui/MoneyInput";
import type { BudgetCategory, Category, FinancialTarget } from "../../shared/types";

const currentMonth = curMonth();

const statusLabel: Record<BudgetCategory["status"], string> = {
  ok: "Dentro do orçamento",
  warning: "Perto do limite",
  over: "Limite excedido",
};

export function BudgetPage() {
  const [month, setMonth] = useState(currentMonth);
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<BudgetCategory>();
  const client = useQueryClient();

  const { data: categories = [] } = useQuery({ queryKey: ["categories"], queryFn: api.categories });
  const { data: targets = [] } = useQuery({ queryKey: ["financial-targets"], queryFn: api.financialTargets });
  const { data: overview, isLoading } = useQuery({
    queryKey: ["budget-overview", month],
    queryFn: () => api.budgetOverview(month),
  });

  async function refresh() {
    await Promise.all([
      client.invalidateQueries({ queryKey: ["budget-overview"] }),
      client.invalidateQueries({ queryKey: ["financial-targets"] }),
    ]);
  }

  async function removeBudget(targetId: string) {
    await api.deleteFinancialTarget(targetId);
    await refresh();
  }

  const budgetedCategoryIds = new Set(
    targets
      .filter((t) => t.kind === "category" && t.enabled)
      .map((t) => t.categoryId)
      .filter(Boolean) as string[],
  );
  const availableCategories = categories.filter((c) => c.kind === "expense" && !budgetedCategoryIds.has(c.id));
  const isCurrentMonth = month === currentMonth;

  return (
    <section className="budget-page">
      <header>
        <div>
          <p className="eyebrow">PLANEJAMENTO</p>
          <h1>Orçamento</h1>
          <p className="muted">Defina limites mensais por categoria e acompanhe o consumo em tempo real.</p>
        </div>
        <button onClick={() => setAdding(true)}>
          <Plus size={16} /> Adicionar categoria ao orçamento
        </button>
      </header>

      <div className="budget-month-row">
        <MonthNavigator month={month} onChange={setMonth} />
      </div>

      {overview && (
        <div className="budget-totals">
          <article>
            <span>Orçado</span>
            <strong>{money(overview.totals.limitInCents)}</strong>
          </article>
          <article>
            <span>Gasto</span>
            <strong>{money(overview.totals.spentInCents)}</strong>
          </article>
          <article>
            <span>Disponível</span>
            <strong
              className={
                overview.totals.limitInCents - overview.totals.spentInCents >= 0 ? "positive" : "budget-negative"
              }
            >
              {money(overview.totals.limitInCents - overview.totals.spentInCents)}
            </strong>
          </article>
        </div>
      )}

      {isLoading && <article className="panel report-loading">Calculando seu orçamento…</article>}

      {overview && overview.categories.length === 0 && (
        <article className="panel">
          <div className="report-empty">
            <Wallet />
            <div>
              <b>Nenhuma categoria orçada ainda</b>
              <p>
                Adicione uma categoria de despesa e defina um limite mensal para começar a acompanhar seu orçamento.
              </p>
            </div>
          </div>
        </article>
      )}

      {overview && overview.categories.length > 0 && (
        <article className="panel budget-list">
          {overview.categories.map((category) => (
            <div className={`budget-row budget-${category.status}`} key={category.targetId}>
              <div className="budget-row-heading">
                <span className="budget-dot" style={{ background: category.categoryColor ?? "#728bba" }} />
                <div>
                  <b>{category.categoryName}</b>
                  <small>{statusLabel[category.status]}</small>
                </div>
                <div className="budget-row-actions">
                  <button className="secondary" onClick={() => setEditing(category)}>
                    Editar limite
                  </button>
                  <button
                    className="icon-button danger"
                    aria-label={`Remover ${category.categoryName} do orçamento`}
                    onClick={() => removeBudget(category.targetId)}
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              </div>
              <div className="budget-bar">
                <i style={{ width: `${Math.min(Math.max(category.progressPercent, 0), 100)}%` }} />
              </div>
              <div className="budget-row-detail">
                <span>
                  {money(category.spentInCents)} de {money(category.limitInCents)}
                </span>
                <span>
                  {category.remainingInCents >= 0
                    ? `${money(category.remainingInCents)} restantes`
                    : `Excedido em ${money(-category.remainingInCents)}`}
                </span>
              </div>
              {isCurrentMonth && <p className="budget-projection">Projeção: {money(category.projectedInCents)}</p>}
            </div>
          ))}
        </article>
      )}

      {adding && (
        <AddBudgetModal
          categories={availableCategories}
          onClose={() => setAdding(false)}
          onSaved={async () => {
            setAdding(false);
            await refresh();
          }}
        />
      )}
      {editing && (
        <EditBudgetModal
          category={editing}
          month={month}
          target={targets.find((t) => t.id === editing.targetId)}
          onClose={() => setEditing(undefined)}
          onSaved={async () => {
            setEditing(undefined);
            await refresh();
          }}
        />
      )}
    </section>
  );
}

function AddBudgetModal({
  categories,
  onClose,
  onSaved,
}: {
  categories: Category[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [categoryId, setCategoryId] = useState<string>();
  const [amountInCents, setAmountInCents] = useState<number | null>(null);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  async function save() {
    if (!categoryId) {
      setError("Selecione uma categoria.");
      return;
    }
    if (!amountInCents || amountInCents <= 0) {
      setError("Informe um limite mensal positivo.");
      return;
    }
    setSaving(true);
    try {
      await api.saveFinancialTarget({ kind: "category", categoryId, amountInCents, enabled: true });
      onSaved();
    } catch (e: any) {
      setError(e?.message || String(e));
      setSaving(false);
    }
  }

  return (
    <div className="modal-backdrop">
      <article className="modal target-modal">
        <h2>Adicionar categoria ao orçamento</h2>
        <p className="muted">Escolha uma categoria de despesa e defina um limite mensal.</p>
        {categories.length === 0 ? (
          <p className="muted">Todas as categorias de despesa já têm um orçamento definido.</p>
        ) : (
          <>
            <label>
              Categoria
              <CategorySelect
                value={categoryId}
                onChange={setCategoryId}
                categories={categories}
                kind="expense"
                allowEmpty
                emptyLabel="Selecione"
              />
            </label>
            <label>
              Limite mensal
              <MoneyInput onChange={setAmountInCents} autoFocus />
            </label>
          </>
        )}
        {error && <p className="form-error">{error}</p>}
        <div className="editor-actions">
          <button className="secondary" onClick={onClose}>
            Cancelar
          </button>
          <button disabled={saving || categories.length === 0} onClick={save}>
            Salvar
          </button>
        </div>
      </article>
    </div>
  );
}

function EditBudgetModal({
  category,
  month,
  target,
  onClose,
  onSaved,
}: {
  category: BudgetCategory;
  month: string;
  target?: FinancialTarget;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [amountInCents, setAmountInCents] = useState<number | null>(category.limitInCents);
  const [monthlyOnly, setMonthlyOnly] = useState(false);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  async function save() {
    if (!amountInCents || amountInCents <= 0) {
      setError("Informe um limite mensal positivo.");
      return;
    }
    setSaving(true);
    try {
      if (monthlyOnly) {
        await api.saveFinancialTargetOverride(category.targetId, month, amountInCents);
      } else {
        await api.saveFinancialTarget({
          id: category.targetId,
          kind: "category",
          categoryId: category.categoryId,
          amountInCents,
          enabled: target?.enabled ?? true,
        });
      }
      onSaved();
    } catch (e: any) {
      setError(e?.message || String(e));
      setSaving(false);
    }
  }

  return (
    <div className="modal-backdrop">
      <article className="modal target-modal">
        <h2>Editar limite · {category.categoryName}</h2>
        <p className="muted">Ajuste o limite mensal para esta categoria.</p>
        <label>
          Limite mensal
          <MoneyInput defaultCents={category.limitInCents} onChange={setAmountInCents} autoFocus />
        </label>
        <label className="check-label">
          <input type="checkbox" checked={monthlyOnly} onChange={(e) => setMonthlyOnly(e.target.checked)} />
          Alterar somente este mês ({monthLabel(month)})
        </label>
        {error && <p className="form-error">{error}</p>}
        <div className="editor-actions">
          <button className="secondary" onClick={onClose}>
            Cancelar
          </button>
          <button disabled={saving} onClick={save}>
            Salvar
          </button>
        </div>
      </article>
    </div>
  );
}
