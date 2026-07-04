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

  if (!summary) return <p>Carregando visão geral…</p>;
  const max = Math.max(...summary.byCategory.map(x => x.amountInCents), 1);
  const netIncomeInCents = summary.incomeInCents - summary.expensesInCents;
  const incomeProgress = profile?.monthlyIncomeInCents
    ? Math.round(summary.incomeInCents / profile.monthlyIncomeInCents * 100)
    : undefined;

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
    <div className="grid">
      <article className="panel"><div className="panel-title"><h2>Gastos por categoria</h2><span>Este mês</span></div>
        {summary.byCategory.length === 0 && <p className="muted">Nenhum gasto categorizado neste mês ainda.</p>}
        {summary.byCategory.map((x, i) => <div className="category" key={x.category}><span className={`dot d${i}`}/><label>{x.category}</label><div className="bar"><i style={{width:`${x.amountInCents/max*100}%`}}/></div><b>{money(x.amountInCents)}</b></div>)}
      </article>
      <article className="panel"><div className="panel-title"><h2>Últimas transações</h2><Link to="/transactions">Ver todas →</Link></div>
        {transactions.slice(0,4).map(t => <div className="transaction" key={t.id}><div className="tx-icon">{t.description[0]}</div><div><b>{t.description}</b><small>{shortDate(t.date)} · {t.category ?? "Sem categoria"}</small></div><strong className={t.amountInCents > 0 ? "positive" : ""}>{money(t.amountInCents)}</strong></div>)}
      </article>
    </div>
  </section>;
}
