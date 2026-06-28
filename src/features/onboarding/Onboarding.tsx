import { ArrowRight, CheckCircle2, Landmark, ShieldCheck, UserRound, WalletCards, X, Tags, Plus } from "lucide-react";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../../shared/api";
import { maskCurrency, parseMoneyToCents } from "../../shared/format";
import type { AccountType, AppBootstrap, Category, FinancialGoal } from "../../shared/types";

const goals:{value:FinancialGoal;label:string}[]=[
  {value:"organize",label:"Organizar minhas finanças"},
  {value:"emergency_fund",label:"Criar uma reserva de emergência"},
  {value:"pay_debt",label:"Quitar dívidas"},
  {value:"save",label:"Economizar para um objetivo"},
  {value:"invest",label:"Investir mais"}
];

export function Onboarding({bootstrap,onFinished}:{bootstrap:AppBootstrap;onFinished:(destination:string)=>Promise<void>}){
  const [step,setStep]=useState(1);
  const [name,setName]=useState("");
  const [income,setIncome]=useState("");
  const [incomeDay,setIncomeDay]=useState("");
  const [goal,setGoal]=useState<FinancialGoal>();
  const [accountName,setAccountName]=useState(bootstrap.account?.name??"Conta principal");
  const [accountKind,setAccountKind]=useState<Exclude<AccountType,"credit_card">>(
    bootstrap.account?.kind==="savings"||bootstrap.account?.kind==="cash"?bootstrap.account.kind:"checking"
  );
  const [openingBalance,setOpeningBalance]=useState("");
  const [error,setError]=useState("");
  const [saving,setSaving]=useState(false);
  const [completed,setCompleted]=useState(false);
  const queryClient = useQueryClient();
  const { data: categories = [] } = useQuery<Category[]>({ queryKey: ["categories"], queryFn: api.categories });
  const [newCategoryName, setNewCategoryName] = useState("");

  function nextProfile(){
    if(name.trim().length<2){setError("Informe um nome com pelo menos 2 caracteres.");return}
    setError("");setStep(3);
  }
  function nextAccount() {
    if(accountName.trim().length<2){setError("Informe um nome para a conta.");return}
    setError("");setStep(4);
  }
  async function finish(){
    setSaving(true);setError("");
    try{
      await api.completeOnboarding({
        displayName:name.trim(),
        monthlyIncomeInCents:income?parseMoneyToCents(income)??undefined:undefined,
        incomeDay:incomeDay?Number(incomeDay):undefined,
        financialGoal:goal,
        accountName:accountName.trim(),accountKind,
        openingBalanceInCents:!bootstrap.hasTransactions&&openingBalance?parseMoneyToCents(openingBalance)??undefined:undefined
      });
      setCompleted(true);
    }catch(e){setError(typeof e==="object"&&e&&"message" in e?String((e as {message:unknown}).message):String(e))}
    finally{setSaving(false)}
  }

  if(completed)return <div className="onboarding-shell"><div className="onboarding-card completion">
    <div className="success-icon"><CheckCircle2/></div><p className="eyebrow">TUDO PRONTO</p><h1>Seu espaço financeiro foi criado</h1>
    <p className="muted">Agora você pode importar seu primeiro extrato ou explorar a visão geral.</p>
    <div className="onboarding-actions"><button className="secondary" onClick={()=>onFinished("/")}>Ir para visão geral</button>
      <button onClick={()=>onFinished("/import")}>Importar primeiro extrato <ArrowRight size={17}/></button></div>
  </div></div>;

  return <div className="onboarding-shell"><div className="onboarding-card">
    <div className="onboarding-brand"><span>L</span><b>Lúmen</b></div>
    <div className="step-indicator"><i className={step>=1?"active":""}/><i className={step>=2?"active":""}/><i className={step>=3?"active":""}/><i className={step>=4?"active":""}/></div>
    {step===1&&<div className="onboarding-content welcome">
      <div className="onboarding-illustration"><Landmark/></div><p className="eyebrow">BEM-VINDO</p><h1>Seu dinheiro, mais claro</h1>
      <p className="muted">Organize extratos, categorias e objetivos em um só lugar, sem abrir mão da sua privacidade.</p>
      <div className="privacy-points"><div><ShieldCheck/><span><b>100% local</b><small>Seus dados ficam neste computador.</small></span></div>
        <div><WalletCards/><span><b>Feito para sua rotina</b><small>Importe extratos e acompanhe seu mês.</small></span></div></div>
      <button className="wide-button" onClick={()=>setStep(2)}>Começar <ArrowRight size={17}/></button>
    </div>}
    {step===2&&<div className="onboarding-content"><div className="step-icon"><UserRound/></div><p className="eyebrow">SEU PERFIL</p><h1>Vamos nos conhecer</h1>
      <p className="muted">Só o nome é obrigatório. Você pode completar o restante depois.</p>
      <label>Como devemos chamar você? <input autoFocus value={name} onChange={e=>setName(e.target.value)} placeholder="Seu nome"/></label>
      <div className="form-row"><label>Renda líquida mensal <div className="money-input"><span>R$</span><input inputMode="decimal" value={income} onChange={e=>setIncome(maskCurrency(e.target.value))} placeholder="0,00"/></div></label>
        <label>Dia de recebimento <input type="number" min="1" max="31" value={incomeDay} onChange={e=>setIncomeDay(e.target.value)} placeholder="Ex.: 5"/></label></div>
      <label>Objetivo principal <select value={goal??""} onChange={e=>setGoal((e.target.value||undefined) as FinancialGoal|undefined)}><option value="">Escolha depois</option>
        {goals.map(item=><option key={item.value} value={item.value}>{item.label}</option>)}</select></label>
      {error&&<p className="form-error">{error}</p>}<div className="onboarding-actions"><button className="secondary" onClick={()=>setStep(1)}>Voltar</button><button onClick={nextProfile}>Continuar <ArrowRight size={17}/></button></div>
    </div>}
    {step===3&&<div className="onboarding-content"><div className="step-icon"><WalletCards/></div><p className="eyebrow">PRIMEIRA CONTA</p><h1>Configure sua conta principal</h1>
      <p className="muted">{bootstrap.hasTransactions?"Encontramos movimentações existentes; seu saldo atual será preservado.":"O saldo inicial é opcional e não será contado como receita."}</p>
      <label>Nome da conta <input autoFocus value={accountName} onChange={e=>setAccountName(e.target.value)} placeholder="Conta principal"/></label>
      <label>Tipo de conta <select value={accountKind} onChange={e=>setAccountKind(e.target.value as Exclude<AccountType,"credit_card">)}>
        <option value="checking">Conta corrente</option><option value="savings">Poupança</option><option value="cash">Dinheiro</option></select></label>
      {!bootstrap.hasTransactions&&<label>Saldo inicial <div className="money-input"><span>R$</span><input inputMode="decimal" value={openingBalance} onChange={e=>setOpeningBalance(maskCurrency(e.target.value))} placeholder="0,00"/></div></label>}
      {error&&<p className="form-error">{error}</p>}<div className="onboarding-actions"><button className="secondary" onClick={()=>setStep(2)}>Voltar</button><button onClick={nextAccount}>Continuar <ArrowRight size={17}/></button></div>
    </div>}
    {step===4&&<div className="onboarding-content"><div className="step-icon"><Tags/></div><p className="eyebrow">PERSONALIZAÇÃO</p><h1>Ajuste suas categorias</h1>
      <p className="muted">Essas são as categorias padrão. Você pode remover as que não usa e adicionar novas para deixar com a sua cara.</p>
      <div style={{display:"flex",flexWrap:"wrap",gap:"8px",marginBottom:"20px"}}>
        {categories.map(c=><span key={c.id} className="badge" style={{display:"flex",alignItems:"center",gap:"4px"}}>
          {c.name}
          <X size={13} style={{cursor:"pointer",opacity:0.7}} onClick={async()=>{
            if(confirm(`Remover categoria ${c.name}?`)){
              await api.archiveCategory(c.id);
              queryClient.invalidateQueries({queryKey:["categories"]});
            }
          }}/>
        </span>)}
      </div>
      <div className="inline-create" style={{marginTop:0}}>
        <label>Nova categoria: <input style={{marginLeft: "8px"}} value={newCategoryName} onChange={e=>setNewCategoryName(e.target.value)} placeholder="Ex.: Lazer" onKeyDown={e=>{
          if(e.key==="Enter" && newCategoryName.trim()){
            api.saveCategory({ name: newCategoryName.trim(), kind: "expense" }).then(()=>{
              setNewCategoryName("");
              queryClient.invalidateQueries({queryKey:["categories"]});
            });
          }
        }}/></label>
        <button className="secondary" onClick={async()=>{
          if(!newCategoryName.trim())return;
          await api.saveCategory({ name: newCategoryName.trim(), kind: "expense" });
          setNewCategoryName("");
          queryClient.invalidateQueries({queryKey:["categories"]});
        }}><Plus size={16}/> Adicionar</button>
      </div>
      {error&&<p className="form-error">{error}</p>}
      <div className="onboarding-actions" style={{marginTop:"32px"}}>
        <button className="secondary" onClick={()=>setStep(3)}>Voltar</button>
        <button disabled={saving} onClick={finish}>{saving?"Salvando…":"Concluir cadastro"} <CheckCircle2 size={17}/></button>
      </div>
    </div>}
  </div></div>
}
