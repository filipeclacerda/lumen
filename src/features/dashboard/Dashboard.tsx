import { useQuery } from "@tanstack/react-query";
import { ArrowDownRight, ArrowUpRight, Landmark, Plus } from "lucide-react";
import { api } from "../../shared/api";
import { money, shortDate } from "../../shared/format";

export function Dashboard() {
  const { data: summary } = useQuery({ queryKey: ["summary"], queryFn: api.summary });
  const { data: transactions = [] } = useQuery({ queryKey: ["transactions"], queryFn: api.transactions });
  if (!summary) return <p>Carregando visão geral…</p>;
  const max = Math.max(...summary.byCategory.map(x => x.amountInCents), 1);
  return <section>
    <header><div><p className="eyebrow">JUNHO DE 2026</p><h1>Olá, Filip 👋</h1><p className="muted">Aqui está o retrato do seu mês.</p></div><button><Plus size={17}/> Nova transação</button></header>
    <div className="cards">
      <article><div className="metric-icon green"><ArrowUpRight/></div><p>Receitas</p><strong>{money(summary.incomeInCents)}</strong><small className="positive">↑ entradas no mês</small></article>
      <article><div className="metric-icon red"><ArrowDownRight/></div><p>Despesas</p><strong>{money(summary.expensesInCents)}</strong><small>gastos confirmados</small></article>
      <article className="dark"><div className="metric-icon"><Landmark/></div><p>Saldo do mês</p><strong>{money(summary.balanceInCents)}</strong><small>receitas menos despesas</small></article>
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
