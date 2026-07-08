import { useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { ArrowDownRight, ArrowUpRight, Gauge, Landmark, PiggyBank, Plus, TrendingUp } from "lucide-react";
import { api } from "../../shared/api";
import { money, shortDate } from "../../shared/format";
import { currentMonth, monthTitle, shiftMonth } from "../../shared/period";
import { MonthNavigator } from "../../shared/ui/MonthNavigator";
import { TransactionForm } from "../transactions/TransactionForm";
import { CashFlowChart } from "./CashFlowChart";
import { NetWorthChart } from "./NetWorthChart";
import type { DashboardSummary, FinancialGoal, FinancialReport, Transaction } from "../../shared/types";

/// Picks the single personalized highlight for the onboarding `financialGoal`, using whatever
/// data is already loaded on the dashboard. Returns undefined when the goal is unset or the
/// relevant data is empty, so the caller renders nothing in that case.
function buildGoalHighlight(
  goal: FinancialGoal | undefined,
  data: { summary: DashboardSummary; report?: FinancialReport; transactions: Transaction[] },
): { text: string; to: string } | undefined {
  const { summary, report, transactions } = data;
  if (!goal) return undefined;
  if (goal === "organize") {
    const count = transactions.filter(t => !t.categoryId).length;
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

export function Dashboard() {
  const [month, setMonth] = useState(currentMonth());
  const [showForm, setShowForm] = useState(false);
  const { data: summary } = useQuery({ queryKey: ["summary", month], queryFn: () => api.summary(month) });
  const { data: transactions = [] } = useQuery({ queryKey: ["transactions", month], queryFn: () => api.transactions(month) });
  const { data: profile } = useQuery({ queryKey: ["profile"], queryFn: api.profile });
  const cashFlowFilter = { startMonth: shiftMonth(month, -5), endMonth: month, source: "all" as const };
  const { data: report } = useQuery({
    queryKey: ["financial-report", cashFlowFilter],
    queryFn: () => api.financialReport(cashFlowFilter),
  });
  const { data: netWorth = [] } = useQuery({
    queryKey: ["net-worth-history", 12],
    queryFn: () => api.netWorthHistory(12),
  });
  const { data: upcoming = [] } = useQuery({
    queryKey: ["upcoming-items", 15],
    queryFn: () => api.upcomingItems(15),
  });
  const { data: budget } = useQuery({
    queryKey: ["budget-overview", month],
    queryFn: () => api.budgetOverview(month),
  });

  if (!summary) return <p>Carregando visão geral…</p>;
  const max = Math.max(...summary.byCategory.map(x => x.amountInCents), 1);
  const netIncomeInCents = summary.incomeInCents - summary.expensesInCents;
  const incomeProgress = profile?.monthlyIncomeInCents
    ? Math.round(summary.incomeInCents / profile.monthlyIncomeInCents * 100)
    : undefined;
  const goalHighlight = buildGoalHighlight(profile?.financialGoal, { summary, report, transactions });

  return <section>
    <header>
      <div>
        <div className="eyebrow" style={{display:"flex", alignItems:"center", gap: "10px", marginBottom: "8px"}}>
          {monthTitle(month)}
          <MonthNavigator month={month} onChange={setMonth} />
        </div>
        <h1>Olá, {profile?.displayName.split(" ")[0] ?? "você"} 👋</h1>
        <p className="muted">Aqui está o retrato do seu mês.</p>
      </div>
      <button onClick={() => setShowForm(true)}><Plus size={17}/> Nova transação</button>
    </header>
    {goalHighlight && <div className="notice notice-action"><span>{goalHighlight.text}</span><Link className="text-button" to={goalHighlight.to}>Ver mais →</Link></div>}
    {showForm && <TransactionForm onClose={() => setShowForm(false)} />}
    <div className="cards">
      <article><div className="metric-icon green"><ArrowUpRight/></div><p>Receitas</p><strong>{money(summary.incomeInCents)}</strong>
        <small className="positive">{incomeProgress!==undefined?`${incomeProgress}% da renda mensal de ${money(profile!.monthlyIncomeInCents!)}`:"↑ entradas no mês"}</small></article>
      <article><div className="metric-icon red"><ArrowDownRight/></div><p>Despesas</p><strong>{money(summary.expensesInCents)}</strong><small>gastos confirmados</small></article>
      <article><div className="metric-icon" style={{background: '#e9f0f5', color: '#1a5b82'}}><ArrowUpRight style={{transform: "rotate(45deg)"}}/></div><p>Investimentos</p><strong>{money(summary.investmentsInCents)}</strong><small>dinheiro guardado</small></article>
      <article className="dark"><div className="metric-icon"><Landmark/></div><p>Saldo do mês</p><strong>{money(netIncomeInCents)}</strong><small>receitas menos despesas</small></article>
    </div>
    {report && (
      <div className="cards pace-strip">
        <article><div className="metric-icon" style={{background:"#eaf3ef", color:"#176148"}}><PiggyBank/></div><p>Taxa de poupança</p>
          <strong>{report.latestMonthSummary.savingsRatePercent?.toFixed(0) ?? "—"}%</strong>
          <small>da renda ficou guardada em {monthTitle(month).toLowerCase()}</small></article>
        <article><div className="metric-icon" style={{background:"#f1ebf5", color:"#835c96"}}><Gauge/></div><p>Ritmo diário de gastos</p>
          <strong>{money(report.latestMonthSummary.dailyAverageInCents)}</strong>
          <small>média por dia neste mês</small></article>
        <article><div className="metric-icon" style={{background:"#fff7e9", color:"#9b6a1f"}}><TrendingUp/></div><p>Projeção do mês</p>
          <strong>{money(report.latestMonthSummary.projectedExpensesInCents)}</strong>
          <small>se o ritmo de gastos se mantiver</small></article>
      </div>
    )}
    {report && report.monthly.length > 1 && (
      <article className="panel chart-panel">
        <div className="panel-title"><h2>Fluxo de caixa</h2><span>Últimos 6 meses</span></div>
        <CashFlowChart monthly={report.monthly} />
      </article>
    )}
    {budget && budget.categories.length > 0 && (
      <article className="panel dashboard-budget-panel">
        <div className="panel-title"><h2>Orçamento do mês</h2><Link to="/budget">Ver orçamento →</Link></div>
        <div className="dashboard-budget-list">
          {budget.categories.slice(0, 4).map(category => (
            <div className={`dashboard-budget-item ${category.status}`} key={category.targetId}>
              <div className="dashboard-budget-item-heading">
                <span><i style={{ background: category.categoryColor ?? "#728bba" }} />{category.categoryName}</span>
                <small>{money(category.spentInCents)} de {money(category.limitInCents)}</small>
              </div>
              <div className="dashboard-budget-bar"><i style={{ width: `${Math.min(Math.max(category.progressPercent, 0), 100)}%` }} /></div>
            </div>
          ))}
        </div>
      </article>
    )}
    {netWorth.length > 1 && (
      <article className="panel chart-panel">
        <div className="panel-title"><h2>Patrimônio</h2><span>Últimos 12 meses</span></div>
        <NetWorthChart points={netWorth} />
      </article>
    )}
    <div className="grid">
      <article className="panel"><div className="panel-title"><h2>Gastos por categoria</h2><span>Este mês</span></div>
        {summary.byCategory.length === 0 && <p className="muted">Nenhum gasto categorizado neste mês ainda.</p>}
        {summary.byCategory.map((x, i) => <div className="category" key={x.category}><span className={`dot d${i}`}/><label>{x.category}</label><div className="bar"><i style={{width:`${x.amountInCents/max*100}%`}}/></div><b>{money(x.amountInCents)}</b></div>)}
      </article>
      <article className="panel"><div className="panel-title"><h2>Últimas transações</h2><Link to="/transactions">Ver todas →</Link></div>
        {transactions.slice(0,4).map(t => <div className="transaction" key={t.id}><div className="tx-icon">{t.description[0]}</div><div><b>{t.description}</b><small>{shortDate(t.date)} · {t.category ?? "Sem categoria"}</small></div><strong className={t.amountInCents > 0 ? "positive" : ""}>{money(t.amountInCents)}</strong></div>)}
      </article>
      <article className="panel"><div className="panel-title"><h2>Próximos vencimentos</h2><span>Próximos 15 dias</span></div>
        {upcoming.length === 0 && <p className="muted">Nada vence nos próximos 15 dias.</p>}
        {upcoming.slice(0,6).map((item, i) => (
          <div className="transaction" key={`${item.kind}-${item.date}-${i}`}>
            <div className="tx-icon">{item.kind === "invoice" ? "F" : "R"}</div>
            <div><b>{item.label}</b><small>{shortDate(item.date)} · {item.kind === "invoice" ? "Fatura" : "Recorrente"}</small></div>
            <strong>{money(item.amountInCents)}</strong>
          </div>
        ))}
      </article>
    </div>
  </section>;
}
