import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { open, save } from "@tauri-apps/plugin-dialog";
import { Database, Download, RotateCcw, Save, ShieldCheck, UserRound } from "lucide-react";
import { api } from "../../shared/api";
import { useToast } from "../../shared/ui/toast";
import type { FinancialGoal } from "../../shared/types";

const goalLabels:Record<FinancialGoal,string>={
  organize:"Organizar minhas finanças",emergency_fund:"Criar reserva de emergência",
  pay_debt:"Quitar dívidas",save:"Economizar para um objetivo",invest:"Investir mais"
};

export function SettingsPage(){
  const client=useQueryClient();
  const toast=useToast();
  const {data:profile}=useQuery({queryKey:["profile"],queryFn:api.profile});
  const [name,setName]=useState("");const [income,setIncome]=useState("");const [day,setDay]=useState("");
  const [goal,setGoal]=useState<FinancialGoal>();const [saving,setSaving]=useState(false);
  useEffect(()=>{if(profile){setName(profile.displayName);setIncome(profile.monthlyIncomeInCents?String(profile.monthlyIncomeInCents/100):"");
    setDay(profile.incomeDay?String(profile.incomeDay):"");setGoal(profile.financialGoal)}},[profile]);
  async function saveProfile(){
    setSaving(true);
    try {
      await api.saveProfile({displayName:name.trim(),monthlyIncomeInCents:income?Math.round(Number(income)*100):undefined,
        incomeDay:day?Number(day):undefined,financialGoal:goal});
      await Promise.all([client.invalidateQueries({queryKey:["profile"]}),client.invalidateQueries({queryKey:["bootstrap"]})]);
      toast("Perfil atualizado.");
    } catch(e) { toast((e as {message?:string})?.message??"Não foi possível salvar.","error"); }
    finally { setSaving(false); }
  }
  async function exportCsv(){
    try {
      const path=await save({defaultPath:"transacoes.csv",filters:[{name:"Planilha CSV",extensions:["csv"]}]});
      if(!path)return;
      const count=await api.exportTransactionsCsv(path);
      toast(`${count} transações exportadas.`);
    } catch(e) { toast((e as {message?:string})?.message??"Falha na exportação.","error"); }
  }
  async function backup(){
    try {
      const path=await save({defaultPath:"financa-backup.db",filters:[{name:"Backup do Finança",extensions:["db"]}]});
      if(!path)return;
      await api.backupDatabase(path);
      toast("Backup salvo com sucesso.");
    } catch(e) { toast((e as {message?:string})?.message??"Falha ao gerar o backup.","error"); }
  }
  async function restore(){
    try {
      const path=await open({multiple:false,filters:[{name:"Backup do Finança",extensions:["db"]}]});
      if(typeof path!=="string")return;
      await api.restoreDatabase(path);
      toast("Backup carregado. Reinicie o Finança para concluir a restauração.");
    } catch(e) { toast((e as {message?:string})?.message??"Falha ao restaurar.","error"); }
  }
  return <section><header><div><p className="eyebrow">PREFERÊNCIAS</p><h1>Configurações</h1><p className="muted">Atualize seus dados de planejamento.</p></div></header>
    <div className="settings-grid"><article className="panel rule-editor"><div className="panel-title"><h2><UserRound size={17}/> Perfil financeiro</h2></div>
      <label>Nome<input value={name} onChange={e=>setName(e.target.value)}/></label>
      <div className="form-row"><label>Renda líquida mensal<input type="number" min="0" step="0.01" value={income} onChange={e=>setIncome(e.target.value)}/></label>
        <label>Dia de recebimento<input type="number" min="1" max="31" value={day} onChange={e=>setDay(e.target.value)}/></label></div>
      <label>Objetivo principal<select value={goal??""} onChange={e=>setGoal((e.target.value||undefined) as FinancialGoal|undefined)}><option value="">Não definido</option>
        {Object.entries(goalLabels).map(([value,label])=><option key={value} value={value}>{label}</option>)}</select></label>
      <button onClick={saveProfile} disabled={saving}><Save size={16}/> {saving?"Salvando…":"Salvar alterações"}</button>
    </article><article className="panel privacy-settings"><ShieldCheck/><div><h2>Privacidade local</h2><p className="muted">Seu perfil e seus dados financeiros permanecem exclusivamente neste computador.</p></div></article></div>
    <article className="panel" style={{marginTop:18}}><div className="panel-title"><h2><Database size={17}/> Dados e backup</h2></div>
      <p className="muted">Exporte suas transações ou guarde uma cópia completa dos seus dados. Recomendado antes de grandes mudanças.</p>
      <div className="data-actions">
        <button className="secondary" onClick={exportCsv}><Download size={15}/> Exportar transações (CSV)</button>
        <button className="secondary" onClick={backup}><Database size={15}/> Fazer backup completo</button>
        <button className="secondary" onClick={restore}><RotateCcw size={15}/> Restaurar backup</button>
      </div>
      <p className="muted" style={{fontSize:12,marginTop:12}}>A restauração substitui todos os dados atuais e é aplicada ao reiniciar o aplicativo.</p>
    </article>
  </section>
}
