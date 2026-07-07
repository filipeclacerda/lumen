import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, ArrowDownRight, ArrowUpRight, CalendarRange, CreditCard, Landmark, Pencil, Plus, Target, Trash2, TrendingUp, X } from "lucide-react";
import { api } from "../../shared/api";
import { money, maskCurrency, shortDate, parseMoneyToCents, centsToInput } from "../../shared/format";
import { currentMonth as curMonth, monthLabel, shiftMonth } from "../../shared/period";
import type { FinancialReport, FinancialTarget, ReportSource } from "../../shared/types";
import { CategoryDonut } from "./CategoryDonut";
import { CategoryTrendChart } from "./CategoryTrendChart";
import { CategorySelect } from "../../shared/ui/CategorySelect";

const currentMonth=curMonth();
function changeLabel(value?:number|null, inverse=false){
  if(value===undefined||value===null)return "Sem base anterior";
  const improved=inverse?value<=0:value>=0;
  return `${value>=0?"+":""}${value.toFixed(1)}% vs. mês anterior|${improved?"good":"bad"}`;
}
function centsInput(value:number){return (value/100).toFixed(2).replace(".",",")}
function parseMoney(value:string){const n=Number(value.replace(/\./g,"").replace(",","."));return Number.isFinite(n)?Math.round(n*100):0}

export function Reports(){
  const [preset,setPreset]=useState("1");
  const [startMonth,setStartMonth]=useState(shiftMonth(currentMonth,-5));
  const [endMonth,setEndMonth]=useState(currentMonth);
  const [source,setSource]=useState<ReportSource>("all");
  const [accountId,setAccountId]=useState("");
  const [editing,setEditing]=useState<FinancialTarget>();
  const client=useQueryClient();
  const {data:accounts=[]}=useQuery({queryKey:["accounts"],queryFn:api.accounts});
  const {data:categories=[]}=useQuery({queryKey:["categories"],queryFn:api.categories});
  const {data:profile}=useQuery({queryKey:["profile"],queryFn:api.profile});
  const filter={startMonth,endMonth,source,accountId:accountId||undefined};
  const {data:report,isLoading,error}=useQuery({
    queryKey:["financial-report",filter],
    queryFn:()=>api.financialReport(filter)
  });
  const {data:targets=[]}=useQuery({queryKey:["financial-targets"],queryFn:api.financialTargets});
  const filteredAccounts=accounts.filter(a=>source==="all"||(source==="credit_card"?a.kind==="credit_card":a.kind!=="credit_card"));
  useEffect(()=>{if(accountId&&!filteredAccounts.some(a=>a.id===accountId))setAccountId("")},[source,accountId,filteredAccounts]);
  function selectPreset(value:string){
    setPreset(value);
    if(value!=="custom"){const count=Number(value);setEndMonth(currentMonth);setStartMonth(shiftMonth(currentMonth,-count+1))}
  }
  async function refresh(){
    await Promise.all([
      client.invalidateQueries({queryKey:["financial-report"]}),
      client.invalidateQueries({queryKey:["financial-targets"]})
    ]);
  }
  async function removeTarget(id:string){await api.deleteFinancialTarget(id);await refresh()}

  return <section className="reports-page">
    <header><div><p className="eyebrow">ANÁLISE FINANCEIRA</p><h1>Relatórios</h1>
      <p className="muted">Entenda seus hábitos, compare períodos e acompanhe suas metas.</p></div>
      <button onClick={()=>setEditing({id:"",kind:"category",amountInCents:0,enabled:true,overrides:[]})}><Plus size={16}/> Nova meta</button>
    </header>
    <article className="report-filters">
      <div className="filter-presets">{[["1","Mês"],["3","3 meses"],["6","6 meses"],["12","12 meses"],["custom","Personalizado"]].map(([value,label])=>
        <button key={value} className={preset===value?"active":""} onClick={()=>selectPreset(value)}>{label}</button>)}</div>
      <div className="report-filter-fields">
        <label><CalendarRange size={15}/> De<input type="month" value={startMonth} onChange={e=>{setPreset("custom");setStartMonth(e.target.value)}}/></label>
        <label>Até<input type="month" value={endMonth} onChange={e=>{setPreset("custom");setEndMonth(e.target.value)}}/></label>
        <label>Origem<select value={source} onChange={e=>setSource(e.target.value as ReportSource)}>
          <option value="all">Todas</option><option value="bank">Conta bancária</option><option value="credit_card">Cartão de crédito</option>
        </select></label>
        <label>Conta<select value={accountId} onChange={e=>setAccountId(e.target.value)}>
          <option value="">Todas as contas</option>{filteredAccounts.map(a=><option key={a.id} value={a.id}>{a.name}</option>)}
        </select></label>
      </div>
    </article>
    {isLoading&&<article className="panel report-loading">Calculando seus relatórios…</article>}
    {error&&<p className="form-error">Não foi possível gerar o relatório: {String(error)}</p>}
    {report&&<ReportContent report={report} profileIncome={profile?.monthlyIncomeInCents} targets={targets}
      onEdit={setEditing} onDelete={removeTarget} onMerchantRenamed={refresh}/>}
    {editing&&<TargetEditor target={editing} month={endMonth} categories={categories.filter(c=>c.kind==="expense")}
      onClose={()=>setEditing(undefined)} onSaved={async()=>{setEditing(undefined);await refresh()}}/>}
  </section>
}

function ReportContent({report,profileIncome,targets,onEdit,onDelete,onMerchantRenamed}:{
  report:FinancialReport;profileIncome?:number;targets:FinancialTarget[];
  onEdit:(target:FinancialTarget)=>void;onDelete:(id:string)=>void;onMerchantRenamed:()=>void;
}){
  const [selectedCategoryId,setSelectedCategoryId]=useState<string>();
  const [renamingMerchant,setRenamingMerchant]=useState<{key:string;name:string}>();
  const summary=report.summary;
  const latest=report.latestMonthSummary;
  const topCategory=report.categories[0];
  const cards=[
    {label:"Ganhos no período",value:summary.incomeInCents,detail:`Entradas em ${report.monthly.length} ${report.monthly.length===1?"mês":"meses"}`,icon:<ArrowUpRight/>,tone:"emerald"},
    {label:"Gastos no período",value:summary.expensesInCents,detail:`Total em ${report.monthly.length} ${report.monthly.length===1?"mês":"meses"}`,icon:<ArrowDownRight/>,tone:"red"},
    {label:"Maior categoria",value:topCategory?.amountInCents??0,detail:topCategory?`${topCategory.category} · ${topCategory.sharePercent.toFixed(1)}% dos gastos`:"Sem gastos no período",icon:<Target/>,tone:"blue"},
    {label:"Média mensal",value:report.monthlyAverageInCents,detail:"Média do período filtrado",icon:<CalendarRange/>,tone:"green"},
    {label:"Total investido atual",value:report.currentInvestedInCents,detail:"Patrimônio investido acumulado",icon:<TrendingUp/>,tone:"purple"}
  ];
  return <>
    <div className="report-kpis">{cards.map(card=><article key={card.label}>
      <div className={`report-kpi-icon ${card.tone}`}>{card.icon}</div><span>{card.label}</span><strong>{money(card.value)}</strong>
      <small>{card.detail}</small></article>)}</div>
    <div className="report-grid main-charts">
      <article className="panel wide-panel"><div className="panel-title"><div><h2>Onde você mais gastou</h2><small>Categorias somadas no período selecionado · clique para ver a tendência</small></div></div>
        <div className="category-breakdown">
          <CategoryDonut categories={report.categories} selectedCategoryId={selectedCategoryId} onSelect={setSelectedCategoryId}/>
          <CategoryBars report={report} selectedCategoryId={selectedCategoryId} onSelect={setSelectedCategoryId}/>
        </div>
        {selectedCategoryId!==undefined&&<CategoryTrendPanel categoryId={selectedCategoryId}
          categoryName={report.categories.find(c=>c.categoryId===selectedCategoryId)?.category??"Sem categoria"}
          onClose={()=>setSelectedCategoryId(undefined)}/>}
      </article>
      <article className="panel"><div className="panel-title"><div><h2>Resumo do período</h2><small>Entradas e destino do dinheiro</small></div></div>
        <div className="period-summary">
          <div><span>Receitas</span><b>{money(summary.incomeInCents)}</b></div>
          <div><span>Despesas</span><b>{money(summary.expensesInCents)}</b></div>
          <div><span>Economizado</span><b className={summary.savingsInCents>=0?"positive":""}>{money(summary.savingsInCents)}</b></div>
          <div><span>Aportes no período</span><b>{money(summary.investmentsInCents)}</b></div>
          <div><span>Taxa de economia</span><b>{summary.savingsRatePercent?.toFixed(1)??"—"}%</b></div>
        </div>
        <div className="month-comparison"><b>Último mês x anterior</b>
          <ComparisonLine label="Despesas" value={latest.expenseChangePercent} inverse/>
          <ComparisonLine label="Receitas" value={latest.incomeChangePercent}/>
          <ComparisonLine label="Economia" value={latest.savingsChangePercent}/>
        </div></article>
    </div>
    <div className="report-grid">
      <article className="panel"><div className="panel-title"><div><h2>Evolução dos gastos</h2><small>Total gasto em cada mês filtrado</small></div></div>
        <SpendingBars data={report.monthly}/></article>
      <article className="panel"><div className="panel-title"><div><h2>Cartão x conta bancária</h2><small>Participação nas despesas</small></div></div>
        <SourceComparison report={report}/></article>
    </div>
    <div className="report-grid">
      <article className="panel"><div className="panel-title"><div><h2>Gasto acumulado</h2><small>Evolução dentro do mês</small></div></div>
        <CumulativeChart report={report}/></article>
      <article className="panel"><div className="panel-title"><div><h2>Principais estabelecimentos</h2><small>Somados no período selecionado</small></div></div>
        <div className="ranking-list">{report.merchants.length?report.merchants.slice(0,5).map((m,i)=><div key={m.merchant}><span className="rank">{i+1}</span>
          <span><b>{m.merchant}</b><small>{m.transactionCount} lançamento{m.transactionCount===1?"":"s"}</small></span><strong>{money(m.amountInCents)}</strong>
          {m.merchantKey&&<button className="icon-button" aria-label={`Renomear ${m.merchant}`}
            onClick={()=>setRenamingMerchant({key:m.merchantKey!,name:m.merchant})}><Pencil size={13}/></button>}</div>):
          <p className="muted">Nenhum gasto no período.</p>}</div></article>
    </div>
    {renamingMerchant&&<RenameMerchantModal merchant={renamingMerchant} onClose={()=>setRenamingMerchant(undefined)}
      onSaved={()=>{setRenamingMerchant(undefined);onMerchantRenamed()}}/>}
    <article className="panel goals-panel"><div className="panel-title"><div><h2><Target size={17}/> Metas do mês</h2>
      <small>Metas recorrentes com ajustes mensais</small></div></div>
      {report.goals.length===0?<div className="report-empty"><Target/><div><b>Nenhuma meta configurada</b>
        <p>{profileIncome?`Sua renda de referência é ${money(profileIncome)}. Crie limites para transformar isso em um plano.`:"Cadastre sua renda e crie uma meta de economia ou gasto por categoria."}</p></div></div>:
      <div className="goal-grid">{report.goals.map(goal=><div className={`goal-card ${goal.projectedToExceed?"goal-warning":""}`} key={goal.targetId}>
        <div><b>{goal.label}</b><small>{goal.kind==="savings"?"Objetivo de economia":"Limite de gastos"}</small></div>
        <strong>{money(goal.actualInCents)} <small>de {money(goal.targetInCents)}</small></strong>
        <div className="goal-progress"><i style={{width:`${Math.min(Math.max(goal.progressPercent,0),100)}%`}}/></div>
        <p>{goal.remainingInCents>=0?`${money(goal.remainingInCents)} restantes`:`Meta excedida em ${money(-goal.remainingInCents)}`}
          <span>Projeção: {money(goal.projectedInCents)}</span></p>
        <div className="goal-actions">{targets.find(t=>t.id===goal.targetId)&&<button className="secondary" onClick={()=>onEdit(targets.find(t=>t.id===goal.targetId)!)}>Editar</button>}
          <button className="icon-button danger" onClick={()=>onDelete(goal.targetId)}><Trash2 size={14}/></button></div>
      </div>)}</div>}
    </article>
    <div className="report-grid insights-grid">
      <article className="panel"><div className="panel-title"><h2>Concentração dos gastos</h2></div>
        <div className="insight-list">
          {report.categories.slice(0,3).map(category=><div key={category.category}><span>{category.category}</span><b>{category.sharePercent.toFixed(1)}%</b></div>)}
          <div><span>Compras no cartão</span><b>{report.cardSharePercent.toFixed(1)}%</b></div>
          <div><span>Total sem categoria</span><b>{money(report.uncategorizedInCents)}</b></div>
        </div></article>
      <article className="panel"><div className="panel-title"><h2>Indicadores úteis</h2></div>
        <div className="insight-list">
          <div><span>Média mensal</span><b>{money(report.monthlyAverageInCents)}</b></div>
          <div><span>Média diária do último mês</span><b>{money(latest.dailyAverageInCents)}</b></div>
          <div><span>Projeção do último mês</span><b>{money(latest.projectedExpensesInCents)}</b></div>
          <div><span>Maior dia de gasto</span><b>{report.highestSpendingDay?`${shortDate(report.highestSpendingDay.date)} · ${money(report.highestSpendingDay.amountInCents)}`:"—"}</b></div>
          <div><span>Sem categoria</span><b>{report.uncategorizedCount} · {money(report.uncategorizedInCents)}</b></div>
        </div></article>
      <article className="panel"><div className="panel-title"><h2>Faturas e crédito</h2></div>
        <div className="invoice-report"><CreditCard/><strong>{money(report.invoices.openTotalInCents)}</strong><span>em faturas abertas</span>
          <div><b>{report.invoices.openCount}</b> abertas <b>{report.invoices.paidCount}</b> pagas</div>
          <p>{report.cardSharePercent.toFixed(1)}% das despesas foram feitas no cartão.</p></div></article>
    </div>
    {report.alerts.length>0&&<article className="panel alerts-panel"><div className="panel-title"><h2><AlertTriangle size={17}/> Pontos de atenção</h2></div>
      <div>{report.alerts.map(alert=><p key={alert}><AlertTriangle size={15}/>{alert}</p>)}</div></article>}
  </>
}

function ComparisonLine({label,value,inverse=false}:{label:string;value?:number|null;inverse?:boolean}){
  const [text,status]=changeLabel(value??undefined,inverse).split("|");
  return <div><span>{label}</span><b className={status}>{text}</b></div>
}

function SpendingBars({data}:{data:FinancialReport["monthly"]}){
  if(!data.length)return <EmptyChart/>;
  const max=Math.max(...data.map(item=>item.expensesInCents),1);
  return <div className="monthly-spending-bars" role="img" aria-label="Comparação dos gastos mensais">
    {data.map(item=><div key={item.month}><span title={money(item.expensesInCents)} style={{height:`${Math.max(item.expensesInCents/max*100,3)}%`}}/>
      <b>{money(item.expensesInCents)}</b><small>{monthLabel(item.month)}</small></div>)}</div>
}
function CategoryBars({report,selectedCategoryId,onSelect}:{
  report:FinancialReport;selectedCategoryId?:string;onSelect:(categoryId:string|undefined)=>void;
}){
  const visible=report.categories.filter(item=>item.amountInCents>0).slice(0,8);
  if(!visible.length)return <EmptyChart/>;
  const max=Math.max(...visible.map(item=>item.amountInCents),1);
  return <div className="category-bars">{visible.map((item,index)=>{
    const clickable=Boolean(item.categoryId);
    const selected=clickable&&item.categoryId===selectedCategoryId;
    return <div key={item.category} className={`${clickable?"category-bar-clickable":""} ${selected?"category-bar-selected":""}`}
      role={clickable?"button":undefined} tabIndex={clickable?0:undefined}
      onClick={clickable?()=>onSelect(item.categoryId===selectedCategoryId?undefined:item.categoryId):undefined}>
      <div className="category-bar-heading"><span><i style={{background:item.color??palette[index%palette.length]}}/>{item.category}</span>
        <b>{money(item.amountInCents)} <small>{item.sharePercent.toFixed(1)}%</small></b></div>
      <div className="category-bar-track"><i style={{width:`${item.amountInCents/max*100}%`,background:item.color??palette[index%palette.length]}}/></div>
    </div>;
  })}</div>
}

function CategoryTrendPanel({categoryId,categoryName,onClose}:{categoryId:string;categoryName:string;onClose:()=>void}){
  const {data=[],isLoading}=useQuery({
    queryKey:["category-trend",categoryId],
    queryFn:()=>api.categoryTrend(categoryId,12)
  });
  const total=data.reduce((sum,p)=>sum+p.amountInCents,0);
  const average=data.length?Math.round(total/data.length):0;
  return <div className="category-trend-panel">
    <div className="panel-title"><div><h2>Tendência · {categoryName}</h2><small>Últimos 12 meses · média de {money(average)}/mês</small></div>
      <div className="category-trend-actions">
        <Link to={`/transactions?category=${categoryId}`}>Ver transações →</Link>
        <button className="icon-button" aria-label="Fechar tendência" onClick={onClose}><X size={14}/></button>
      </div>
    </div>
    {isLoading?<p className="muted">Carregando tendência…</p>:<CategoryTrendChart data={data}/>}
  </div>
}
const palette=["#247258","#e5a142","#728bba","#a778ba","#d66d68","#4c94a8"];
function SourceComparison({report}:{report:FinancialReport}){
  return <div className="source-chart">{report.sources.map(source=><div key={source.source}>
    <div className={`source-icon ${source.source==="credit_card"?"card":"bank"}`}>{source.source==="credit_card"?<CreditCard/>:<Landmark/>}</div>
    <span><b>{source.source==="credit_card"?"Cartão de crédito":"Conta bancária"}</b><small>{source.sharePercent.toFixed(1)}% dos gastos</small></span>
    <strong>{money(source.amountInCents)}</strong><div className="source-bar"><i style={{width:`${source.sharePercent}%`}}/></div>
  </div>)}</div>
}
function CumulativeChart({report}:{report:FinancialReport}){
  const data=report.daily;if(!data.length)return <EmptyChart/>;
  const width=650,height=180,pad=25,max=Math.max(...data.map(x=>x.cumulativeInCents),1);
  const points=data.map((d,i)=>`${pad+i*(width-pad*2)/Math.max(data.length-1,1)},${height-pad-d.cumulativeInCents/max*(height-pad*2)}`).join(" ");
  return <div className="svg-chart small-chart"><svg role="img" aria-label="Gastos acumulados durante o mês" viewBox={`0 0 ${width} ${height}`}>
    <defs><linearGradient id="area" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#2b8466" stopOpacity=".28"/><stop offset="1" stopColor="#2b8466" stopOpacity="0"/></linearGradient></defs>
    <polygon points={`${pad},${height-pad} ${points} ${width-pad},${height-pad}`} fill="url(#area)"/><polyline points={points} className="chart-line income-line"/>
    <text x={pad} y={height-3}>{shortDate(data[0].date)}</text><text x={width-pad} y={height-3} textAnchor="end">{shortDate(data[data.length-1].date)}</text>
  </svg></div>
}
function EmptyChart(){return <div className="chart-empty"><TrendingUp/><span>Sem dados suficientes para este gráfico.</span></div>}

function RenameMerchantModal({merchant,onClose,onSaved}:{merchant:{key:string;name:string};onClose:()=>void;onSaved:()=>void}){
  const [name,setName]=useState(merchant.name);
  const [error,setError]=useState("");
  const [saving,setSaving]=useState(false);
  async function save(){
    if(!name.trim()){setError("Informe um nome.");return}
    setSaving(true);
    try{await api.saveMerchantAlias(merchant.key,name.trim());onSaved()}
    catch(e:any){setError(e?.message||String(e));setSaving(false)}
  }
  return <div className="modal-backdrop"><article className="modal">
    <h2>Renomear estabelecimento</h2>
    <p className="muted">Esse apelido será usado sempre que este estabelecimento aparecer nos relatórios.</p>
    <label>Nome<input value={name} onChange={e=>setName(e.target.value)} autoFocus/></label>
    {error&&<p className="form-error">{error}</p>}
    <div className="editor-actions"><button className="secondary" onClick={onClose}>Cancelar</button>
      <button disabled={saving} onClick={save}>Salvar</button></div>
  </article></div>
}

function TargetEditor({target,month,categories,onClose,onSaved}:{
  target:FinancialTarget;month:string;categories:Awaited<ReturnType<typeof api.categories>>;onClose:()=>void;onSaved:()=>void
}){
  const [kind,setKind]=useState<"savings"|"category">(target.kind);
  const [categoryId,setCategoryId]=useState(target.categoryId??"");
  const [amount,setAmount]=useState(centsToInput(target.amountInCents));
  const [monthlyOnly,setMonthlyOnly]=useState(false);
  const [error,setError]=useState("");
  async function save(){
    try{
      const amountInCents=parseMoneyToCents(amount);if(!amountInCents || amountInCents<=0){setError("Informe um valor positivo.");return}
      if(target.id&&monthlyOnly){await api.saveFinancialTargetOverride(target.id,month,amountInCents)}
      else await api.saveFinancialTarget({id:target.id||undefined,kind,categoryId:kind==="category"?categoryId:undefined,amountInCents,enabled:true});
      onSaved();
    }catch(e:any){setError(e?.message||String(e))}
  }
  return <div className="modal-backdrop"><article className="modal target-modal"><h2>{target.id?"Editar meta":"Nova meta financeira"}</h2>
    <p className="muted">Defina um objetivo recorrente e acompanhe a projeção ao longo do mês.</p>
    <label>Tipo<select value={kind} onChange={e=>setKind(e.target.value as typeof kind)}>
      <option value="category">Limite por categoria</option><option value="savings">Economia mensal</option></select></label>
    {kind==="category"&&<CategorySelect
        value={categoryId}
        onChange={id => setCategoryId(id ?? "")}
        categories={categories}
        kind="expense"
        allowEmpty
        emptyLabel="Selecione"
      />}
        <label>Valor mensal<div className="money-input"><span>R$</span><input inputMode="decimal" value={amount} onChange={e=>setAmount(maskCurrency(e.target.value))}/></div></label>
    {target.id&&<label className="check-label"><input type="checkbox" checked={monthlyOnly} onChange={e=>setMonthlyOnly(e.target.checked)}/>
      Alterar somente para {monthLabel(month)}</label>}
    {error&&<p className="form-error">{error}</p>}
    <div className="editor-actions"><button className="secondary" onClick={onClose}>Cancelar</button><button disabled={kind==="category"&&!categoryId} onClick={save}>Salvar meta</button></div>
  </article></div>
}
