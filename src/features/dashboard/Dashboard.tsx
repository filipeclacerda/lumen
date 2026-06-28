import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ArrowDownRight, ArrowUpRight, Landmark, Plus } from "lucide-react";
import { api } from "../../shared/api";
import { money, shortDate } from "../../shared/format";

export function Dashboard() {
  const [month, setMonth] = useState(new Date().toISOString().slice(0, 7));
  const { data: summary } = useQuery({ queryKey: ["summary", month], queryFn: () => api.summary(month) });
  const { data: transactions = [] } = useQuery({ queryKey: ["transactions", month], queryFn: () => api.transactions(month) });
  const { data: profile } = useQuery({ queryKey: ["profile"], queryFn: api.profile });
  
  if (!summary) return <p>Carregando visão geral…</p>;
  const max = Math.max(...summary.byCategory.map(x => x.amountInCents), 1);
  const [y, m] = month.split('-');
  const currentMonthName = new Date(parseInt(y), parseInt(m) - 1).toLocaleString('pt-BR', { month: 'long', year: 'numeric' }).toUpperCase();
  const netIncomeInCents = summary.incomeInCents - summary.expensesInCents;
  const incomeProgress = profile?.monthlyIncomeInCents
    ? Math.round(summary.incomeInCents / profile.monthlyIncomeInCents * 100)
    : undefined;
  
  return <section>
    <header>
      <div>
        <p className="eyebrow" style={{display: "flex", alignItems: "center", gap: "10px"}}>
          {currentMonthName} 
          <input type="month" value={month} onChange={e => setMonth(e.target.value)} style={{fontSize: "12px", padding: "4px", borderRadius: "5px", border: "1px solid #dce2de", color: "#52605b", cursor: "pointer"}} />
        </p>
        <h1>Olá, {profile?.displayName.split(" ")[0] ?? "você"} 👋</h1>
        <p className="muted">Aqui está o retrato do seu mês.</p>
      </div>
      <button onClick={() => console.log("Em breve")}><Plus size={17}/> Nova transação</button>
    </header>
    <div className="cards">
      <article><div className="metric-icon green"><ArrowUpRight/></div><p>Receitas</p><strong>{money(summary.incomeInCents)}</strong>
        <small className="positive">{incomeProgress!==undefined?`${incomeProgress}% da renda mensal de ${money(profile!.monthlyIncomeInCents!)}`:"↑ entradas no mês"}</small></article>
      <article><div className="metric-icon red"><ArrowDownRight/></div><p>Despesas</p><strong>{money(summary.expensesInCents)}</strong><small>gastos confirmados</small></article>
      <article><div className="metric-icon" style={{background: '#e9f0f5', color: '#1a5b82'}}><ArrowUpRight style={{transform: "rotate(45deg)"}}/></div><p>Investimentos</p><strong>{money(summary.investmentsInCents)}</strong><small>dinheiro guardado</small></article>
      <article className="dark"><div className="metric-icon"><Landmark/></div><p>Saldo do mês</p><strong>{money(netIncomeInCents)}</strong><small>receitas menos despesas</small></article>
    </div>
    <div className="grid">
      <article className="panel"><div className="panel-title"><h2>Gastos por categoria</h2><span>Este mês</span></div>
        {summary.byCategory.map((x, i) => <div className="category" key={x.category}><span className={`dot d${i}`}/><label>{x.category}</label><div className="bar"><i style={{width:`${x.amountInCents/max*100}%`}}/></div><b>{money(x.amountInCents)}</b></div>)}
      </article>
      <article className="panel"><div className="panel-title"><h2>Últimas transações</h2><Nav/></div>
        {transactions.slice(0,4).map(t => <div className="transaction" key={t.id}><div className="tx-icon">{t.description[0]}</div><div><b>{t.description}</b><small>{shortDate(t.date)} · {t.category ?? "Sem categoria"}</small></div><strong className={t.amountInCents > 0 ? "positive" : ""}>{money(t.amountInCents)}</strong></div>)}
      </article>
    </div>
  </section>;
}
function Nav(){return <a href="/transactions">Ver todas →</a>}
