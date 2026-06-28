import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Save, ShieldCheck, UserRound } from "lucide-react";
import { api } from "../../shared/api";
import type { FinancialGoal } from "../../shared/types";

const goalLabels:Record<FinancialGoal,string>={
  organize:"Organizar minhas finanças",emergency_fund:"Criar reserva de emergência",
  pay_debt:"Quitar dívidas",save:"Economizar para um objetivo",invest:"Investir mais"
};

export function SettingsPage(){
  const client=useQueryClient();
  const {data:profile}=useQuery({queryKey:["profile"],queryFn:api.profile});
  const [name,setName]=useState("");const [income,setIncome]=useState("");const [day,setDay]=useState("");
  const [goal,setGoal]=useState<FinancialGoal>();const [message,setMessage]=useState("");
  useEffect(()=>{if(profile){setName(profile.displayName);setIncome(profile.monthlyIncomeInCents?String(profile.monthlyIncomeInCents/100):"");
    setDay(profile.incomeDay?String(profile.incomeDay):"");setGoal(profile.financialGoal)}},[profile]);
  async function save(){
    await api.saveProfile({displayName:name.trim(),monthlyIncomeInCents:income?Math.round(Number(income)*100):undefined,
      incomeDay:day?Number(day):undefined,financialGoal:goal});
    await Promise.all([client.invalidateQueries({queryKey:["profile"]}),client.invalidateQueries({queryKey:["bootstrap"]})]);
    setMessage("Perfil atualizado.");
  }
  return <section><header><div><p className="eyebrow">PREFERÊNCIAS</p><h1>Configurações</h1><p className="muted">Atualize seus dados de planejamento.</p></div></header>
    <div className="settings-grid"><article className="panel rule-editor"><div className="panel-title"><h2><UserRound size={17}/> Perfil financeiro</h2></div>
      <label>Nome<input value={name} onChange={e=>setName(e.target.value)}/></label>
      <div className="form-row"><label>Renda líquida mensal<input type="number" min="0" step="0.01" value={income} onChange={e=>setIncome(e.target.value)}/></label>
        <label>Dia de recebimento<input type="number" min="1" max="31" value={day} onChange={e=>setDay(e.target.value)}/></label></div>
      <label>Objetivo principal<select value={goal??""} onChange={e=>setGoal((e.target.value||undefined) as FinancialGoal|undefined)}><option value="">Não definido</option>
        {Object.entries(goalLabels).map(([value,label])=><option key={value} value={value}>{label}</option>)}</select></label>
      <button onClick={save}><Save size={16}/> Salvar alterações</button>{message&&<p className="notice">{message}</p>}
    </article><article className="panel privacy-settings"><ShieldCheck/><div><h2>Privacidade local</h2><p className="muted">Seu perfil e seus dados financeiros permanecem exclusivamente neste computador.</p></div></article></div>
  </section>
}
