import { PageHeader } from "../../shared/ui/PageHeader";
import { lazy, Suspense, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import {
  ArrowDownRight,
  ArrowUpRight,
  CalendarClock,
  Gauge,
  Landmark,
  PiggyBank,
  Plus,
  TrendingUp,
  CreditCard,
  Repeat,
  Receipt,
} from "lucide-react";
import { api } from "../../shared/api";
import { money, shortDate } from "../../shared/format";
import { currentMonth, monthTitle, shiftMonth } from "../../shared/period";
import { MonthNavigator } from "../../shared/ui/MonthNavigator";
import { TransactionForm } from "../transactions/TransactionForm";
import { ErrorState, LoadingState } from "../../shared/ui/AsyncState";
import { LazyErrorBoundary } from "../../shared/ui/LazyErrorBoundary";
import type { DashboardSummary, FinancialGoal, FinancialReport, Transaction } from "../../shared/types";

const CategoryBarsChart = lazy(() =>
  import("../../shared/ui/Charts").then((module) => ({ default: module.CategoryBarsChart })),
);
const CashFlowChart = lazy(() => import("./CashFlowChart").then((module) => ({ default: module.CashFlowChart })));
const MonthlySurplusChart = lazy(() =>
  import("./MonthlySurplusChart").then((module) => ({ default: module.MonthlySurplusChart })),
);

/// Picks the single personalized highlight for the onboarding `financialGoal`, using whatever
/// data is already loaded on the dashboard. Returns undefined when the goal is unset or the
/// relevant data is empty, so the caller renders nothing in that case.
function buildGoalHighlight(
  goal: FinancialGoal | null | undefined,
  data: { summary: DashboardSummary; report?: FinancialReport; transactions: Transaction[] },
): { text: string; to: string } | undefined {
  const { summary, report, transactions } = data;
  if (!goal) return undefined;
  if (goal === "organize") {
    const count = transactions.filter((t) => !t.categoryId).length;
    if (count === 0) return undefined;
    return {
      text: `Organize seus gastos: ${count} transaç${count > 1 ? "ões" : "ão"} sem categoria`,
      to: "/transactions?uncategorized=1",
    };
  }
  if (goal === "emergency_fund" || goal === "save") {
    const savings = report?.latestMonthSummary.savingsInCents;
    const rate = report?.latestMonthSummary.savingsRatePercent;
    if (!savings || savings <= 0) return undefined;
    return {
      text: `Você guardou ${money(savings)} este mês${rate !== undefined ? ` (${rate.toFixed(0)}% da renda)` : ""}`,
      to: "/reports",
    };
  }
  if (goal === "pay_debt") {
    const open = report?.invoices.openTotalInCents;
    if (!open) return undefined;
    return { text: `Faturas em aberto: ${money(open)}`, to: "/accounts" };
  }
  if (goal === "invest") {
    if (!summary.investmentsInCents) return undefined;
    return { text: `Você investiu ${money(summary.investmentsInCents)} este mês`, to: "/reports" };
  }
  return undefined;
}

function upcomingKindPresentation(kind: "invoice" | "installment" | "recurring") {
  switch (kind) {
    case "invoice":
      return { label: "Fatura", icon: <CreditCard size={18} /> };
    case "installment":
      return { label: "Parcela", icon: <Receipt size={18} /> };
    case "recurring":
      return { label: "Recorrente", icon: <Repeat size={18} /> };
    default: {
      const exhaustive: never = kind;
      return exhaustive;
    }
  }
}

export function Dashboard() {
  const [month, setMonth] = useState(currentMonth());
  const [showForm, setShowForm] = useState(false);
  const {
    data: summary,
    isLoading: summaryLoading,
    isError: summaryError,
    refetch: refetchSummary,
  } = useQuery({ queryKey: ["summary", month], queryFn: () => api.summary(month) });
  const {
    data: transactions = [],
    isLoading: transactionsLoading,
    isError: transactionsError,
    refetch: refetchTransactions,
  } = useQuery({
    queryKey: ["transactions", month],
    queryFn: () => api.transactions(month),
  });
  const { data: profile } = useQuery({ queryKey: ["profile"], queryFn: api.profile });
  const cashFlowFilter = { startMonth: shiftMonth(month, -5), endMonth: month, source: "all" as const };
  const { data: report } = useQuery({
    queryKey: ["financial-report", cashFlowFilter],
    queryFn: () => api.financialReport(cashFlowFilter),
  });
  const {
    data: upcoming = [],
    isLoading: upcomingLoading,
    isError: upcomingError,
    refetch: refetchUpcoming,
  } = useQuery({
    queryKey: ["upcoming-items", 15],
    queryFn: () => api.upcomingItems(15),
  });
  const { data: budget } = useQuery({
    queryKey: ["budget-overview", month],
    queryFn: () => api.budgetOverview(month),
  });

  if (summaryLoading) return <LoadingState variant="page" label="Carregando visão geral…" />;
  if (summaryError || !summary)
    return (
      <ErrorState
        variant="page"
        message="Não foi possível carregar a visão geral."
        onRetry={() => void refetchSummary()}
      />
    );
  const categoryTotal = summary.byCategory.reduce((sum, category) => sum + category.amountInCents, 0);
  const categoryBars = summary.byCategory.map((category) => ({
    category: category.category,
    amountInCents: category.amountInCents,
    sharePercent: categoryTotal ? (category.amountInCents / categoryTotal) * 100 : 0,
  }));
  const netIncomeInCents = summary.incomeInCents - summary.expensesInCents;
  const incomeProgress =
    profile?.monthlyIncomeInCents != null && profile.monthlyIncomeInCents > 0
      ? Math.round((summary.incomeInCents / profile.monthlyIncomeInCents) * 100)
      : undefined;
  const goalHighlight = buildGoalHighlight(profile?.financialGoal, { summary, report, transactions });

  return (
    <section data-tutorial="overview">
      <PageHeader>
        <div>
          <div className="dashboard-period-header">
            <span className="eyebrow">PERÍODO</span>
            <MonthNavigator month={month} onChange={setMonth} />
          </div>
          <h1>Olá, {profile?.displayName.split(" ")[0] ?? "você"} 👋</h1>
          <p className="muted">Aqui está o retrato do seu mês.</p>
        </div>
        <button className="primary-action" onClick={() => setShowForm(true)}>
          <Plus size={17} /> Nova transação
        </button>
      </PageHeader>
      {goalHighlight && (
        <div className="notice notice-action">
          <span>{goalHighlight.text}</span>
          <Link className="text-button" to={goalHighlight.to}>
            Ver mais →
          </Link>
        </div>
      )}
      {showForm && <TransactionForm onClose={() => setShowForm(false)} />}
      <div className="cards" data-quick-guide="overview">
        <article>
          <div className="metric-icon green">
            <ArrowUpRight />
          </div>
          <p>Receitas</p>
          <strong>{money(summary.incomeInCents)}</strong>
          <small className="positive">
            {incomeProgress !== undefined
              ? `${incomeProgress}% da renda mensal de ${money(profile!.monthlyIncomeInCents!)}`
              : "↑ entradas no mês"}
          </small>
        </article>
        <article>
          <div className="metric-icon red">
            <ArrowDownRight />
          </div>
          <p>Despesas</p>
          <strong>{money(summary.expensesInCents)}</strong>
          <small>gastos confirmados</small>
        </article>
        <article>
          <div className="metric-icon status-info">
            <TrendingUp />
          </div>
          <p>Investimentos</p>
          <strong>{money(summary.investmentsInCents)}</strong>
          <small>dinheiro guardado</small>
        </article>
        <article className="dark">
          <div className="metric-icon">
            <Landmark />
          </div>
          <p>Saldo do mês</p>
          <strong>{money(netIncomeInCents)}</strong>
          <small>receitas menos despesas</small>
        </article>
      </div>
      {report && (
        <div className="cards pace-strip">
          <article>
            <div className="metric-icon status-success">
              <PiggyBank />
            </div>
            <p>Taxa de poupança</p>
            <strong>{report.latestMonthSummary.savingsRatePercent?.toFixed(0) ?? "—"}%</strong>
            <small>da renda ficou guardada em {monthTitle(month).toLowerCase()}</small>
          </article>
          <article>
            <div className="metric-icon metric-icon-purple">
              <Gauge />
            </div>
            <p>Ritmo diário de gastos</p>
            <strong>{money(report.latestMonthSummary.dailyAverageInCents)}</strong>
            <small>média por dia neste mês</small>
          </article>
          <article>
            <div className="metric-icon status-warning">
              <CalendarClock />
            </div>
            <p>Projeção do mês</p>
            <strong>{money(report.latestMonthSummary.projectedExpensesInCents)}</strong>
            <small>se o ritmo de gastos se mantiver</small>
          </article>
        </div>
      )}
      {report && report.monthly.length > 1 && (
        <article className="panel chart-panel">
          <div className="panel-title">
            <h2>Fluxo de caixa</h2>
            <span>Últimos 6 meses</span>
          </div>
          <LazyErrorBoundary variant="panel" message="Não foi possível carregar o gráfico de fluxo de caixa.">
            <Suspense fallback={<LoadingState variant="panel" label="Carregando gráfico de fluxo de caixa…" />}>
              <CashFlowChart monthly={report.monthly} />
            </Suspense>
          </LazyErrorBoundary>
        </article>
      )}
      {budget && budget.categories.length > 0 && (
        <article className="panel dashboard-budget-panel">
          <div className="panel-title">
            <h2>Orçamento do mês</h2>
            <Link to="/budget">Ver orçamento →</Link>
          </div>
          <div className="dashboard-budget-list">
            {budget.categories.slice(0, 4).map((category) => (
              <div className={`dashboard-budget-item ${category.status}`} key={category.targetId}>
                <div className="dashboard-budget-item-heading">
                  <span>
                    <i style={{ background: category.categoryColor ?? "var(--data-3)" }} />
                    {category.categoryName}
                  </span>
                  <small>
                    {money(category.spentInCents)} de {money(category.limitInCents)}
                  </small>
                </div>
                <div className="dashboard-budget-bar">
                  <i style={{ width: `${Math.min(Math.max(category.progressPercent, 0), 100)}%` }} />
                </div>
              </div>
            ))}
          </div>
        </article>
      )}
      {report && report.monthly.length > 1 && (
        <article className="panel chart-panel">
          <div className="panel-title">
            <h2>Sobra mensal</h2>
            <span>Receitas menos gastos e investimentos</span>
          </div>
          <LazyErrorBoundary variant="panel" message="Não foi possível carregar o gráfico de sobra mensal.">
            <Suspense fallback={<LoadingState variant="panel" label="Carregando gráfico de sobra mensal…" />}>
              <MonthlySurplusChart monthly={report.monthly} />
            </Suspense>
          </LazyErrorBoundary>
        </article>
      )}
      <div className="grid">
        <article className="panel">
          <div className="panel-title">
            <h2>Gastos por categoria</h2>
            <span>Este mês</span>
          </div>
          {summary.byCategory.length === 0 ? (
            <p className="muted">Nenhum gasto categorizado neste mês ainda.</p>
          ) : (
            <LazyErrorBoundary variant="panel" message="Não foi possível carregar o gráfico por categoria.">
              <Suspense fallback={<LoadingState variant="panel" label="Carregando gráfico por categoria…" />}>
                <CategoryBarsChart categories={categoryBars} onSelect={() => {}} />
              </Suspense>
            </LazyErrorBoundary>
          )}
        </article>
        <article className="panel">
          <div className="panel-title">
            <h2>Últimas transações</h2>
            <Link to="/transactions">Ver todas →</Link>
          </div>
          {transactionsLoading ? (
            <LoadingState variant="panel" label="Carregando últimas transações…" />
          ) : transactionsError ? (
            <ErrorState
              variant="panel"
              message="Não foi possível carregar as últimas transações."
              onRetry={() => void refetchTransactions()}
            />
          ) : transactions.length === 0 ? (
            <p className="muted">Nenhuma transação neste mês ainda.</p>
          ) : (
            transactions.slice(0, 4).map((t) => (
              <div className="transaction" key={t.id}>
                <div className="tx-icon">{t.description[0]}</div>
                <div>
                  <b>{t.description}</b>
                  <small>
                    {shortDate(t.date)} · {t.category ?? "Sem categoria"}
                  </small>
                </div>
                <strong className={t.amountInCents > 0 ? "positive" : ""}>{money(t.amountInCents)}</strong>
              </div>
            ))
          )}
        </article>
        <article className="panel">
          <div className="panel-title">
            <h2>Próximos vencimentos</h2>
            <span>Próximos 15 dias</span>
          </div>
          {upcomingLoading ? (
            <LoadingState variant="panel" label="Carregando próximos vencimentos…" />
          ) : upcomingError ? (
            <ErrorState
              variant="panel"
              message="Não foi possível carregar os próximos vencimentos."
              onRetry={() => void refetchUpcoming()}
            />
          ) : upcoming.length === 0 ? (
            <p className="muted">Nada vence nos próximos 15 dias.</p>
          ) : (
            upcoming.slice(0, 6).map((item, i) => {
              const presentation = upcomingKindPresentation(item.kind);
              return (
                <div className="transaction" key={`${item.kind}-${item.date}-${i}`}>
                  <div className="tx-icon" aria-hidden="true">
                    {presentation.icon}
                  </div>
                  <div>
                    <b>{item.label}</b>
                    <small>
                      {shortDate(item.date)} · {presentation.label}
                    </small>
                  </div>
                  <strong>{money(item.amountInCents)}</strong>
                </div>
              );
            })
          )}
        </article>
      </div>
    </section>
  );
}
