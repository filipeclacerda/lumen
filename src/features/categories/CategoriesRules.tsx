import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Archive, ArrowDown, ArrowUp, Plus, Save, Sparkles, TestTube2 } from "lucide-react";
import { useMemo, useState } from "react";
import { api } from "../../shared/api";
import type { Category, CategoryKind, CategorizationRule, MovementType, RuleImpact, RuleInput, RuleOperator } from "../../shared/types";
import { shortDate } from "../../shared/format";

const emptyRule: RuleInput = {
  name: "", priority: 100, enabled: true, operator: "contains", pattern: "",
  movementType: "any", categoryId: "", minAmountInCents: undefined, maxAmountInCents: undefined
};

export function CategoriesRules() {
  const client = useQueryClient();
  const { data: categories = [] } = useQuery({ queryKey:["categories"], queryFn:api.categories });
  const { data: rules = [] } = useQuery({ queryKey:["rules"], queryFn:api.rules });
  const { data: accounts = [] } = useQuery({ queryKey:["accounts"], queryFn:api.accounts });
  const [tab, setTab] = useState<"rules"|"categories">("rules");
  const [rule, setRule] = useState<RuleInput>(emptyRule);
  const [impact, setImpact] = useState<RuleImpact>();
  const [historyImpact, setHistoryImpact] = useState<RuleImpact>();
  const [message, setMessage] = useState("");
  const [categoryDraft, setCategoryDraft] = useState<{id?:string;parentId?:string;name:string;kind:CategoryKind;color:string;sortOrder:number}>({name:"",kind:"expense",color:"#497ca5",sortOrder:0});
  const categoryMap = useMemo(() => new Map(categories.map(c=>[c.id,c])), [categories]);

  async function saveRule() {
    if (!rule.name || !rule.pattern || !rule.categoryId) { setMessage("Preencha nome, padrão e categoria."); return; }
    await api.saveRule(rule);
    setRule(emptyRule); setImpact(undefined); setMessage("Regra salva.");
    await client.invalidateQueries({queryKey:["rules"]});
  }
  async function testRule() {
    if (!rule.name || !rule.pattern || !rule.categoryId) { setMessage("Preencha a regra antes de testar."); return; }
    setImpact(await api.previewRule(rule));
  }
  async function applyAll() {
    setHistoryImpact(await api.previewAllRules(false));
  }
  async function confirmApplyAll() {
    const count = await api.applyRules(false);
    setMessage(`${count} transações categorizadas; escolhas manuais foram preservadas.`);
    setHistoryImpact(undefined);
    await Promise.all([
      client.invalidateQueries({queryKey:["transactions"]}),
      client.invalidateQueries({queryKey:["summary"]}),
      client.invalidateQueries({queryKey:["rules"]})
    ]);
  }
  async function moveRule(index:number, delta:number) {
    const next=[...rules]; const target=index+delta;
    if(target<0||target>=next.length)return;
    [next[index],next[target]]=[next[target],next[index]];
    await api.reorderRules(next.map(x=>x.id));
    await client.invalidateQueries({queryKey:["rules"]});
  }
  async function archiveRule(id:string) {
    await api.archiveRule(id); await client.invalidateQueries({queryKey:["rules"]});
  }
  async function saveCategory() {
    if(!categoryDraft.name)return;
    await api.saveCategory(categoryDraft);
    setCategoryDraft({name:"",kind:"expense",color:"#497ca5",sortOrder:categories.length*10});
    await client.invalidateQueries({queryKey:["categories"]});
  }
  async function archiveCategory(id:string) {
    try { await api.archiveCategory(id); await client.invalidateQueries({queryKey:["categories"]}); }
    catch { setMessage("Esta categoria está em uso e não pode ser arquivada ainda."); }
  }
  function editRule(value:CategorizationRule) {
    setRule({
      id:value.id,name:value.name,priority:value.priority,enabled:value.enabled,operator:value.operator,
      pattern:value.pattern,accountId:value.accountId,movementType:value.movementType,
      minAmountInCents:value.minAmountInCents,maxAmountInCents:value.maxAmountInCents,categoryId:value.categoryId
    });
    setImpact(undefined); window.scrollTo({top:0,behavior:"smooth"});
  }

  return <section>
    <header><div><p className="eyebrow">ORGANIZAÇÃO AUTOMÁTICA</p><h1>Categorias e regras</h1>
      <p className="muted">Regras locais, previsíveis e sempre revisáveis.</p></div>
      <button onClick={applyAll}><Sparkles size={17}/> Aplicar ao histórico</button>
    </header>
    <div className="tabs"><button className={tab==="rules"?"selected":""} onClick={()=>setTab("rules")}>Regras ({rules.length})</button>
      <button className={tab==="categories"?"selected":""} onClick={()=>setTab("categories")}>Categorias ({categories.length})</button></div>
    {message&&<p className="notice">{message}</p>}

    {tab==="rules"&&<div className="rules-layout">
      <article className="panel rule-editor">
        <div className="panel-title"><h2>{rule.id?"Editar regra":"Nova regra"}</h2>{rule.id&&<button className="text-button" onClick={()=>setRule(emptyRule)}>Cancelar</button>}</div>
        <label>Nome<input value={rule.name} onChange={e=>setRule({...rule,name:e.target.value})} placeholder="Ex.: Mercado do bairro"/></label>
        <div className="form-row">
          <label>Correspondência<select value={rule.operator} onChange={e=>setRule({...rule,operator:e.target.value as RuleOperator})}>
            <option value="contains">Descrição contém</option><option value="starts_with">Descrição começa com</option><option value="regex">Expressão regular</option>
          </select></label>
          <label>Movimento<select value={rule.movementType} onChange={e=>setRule({...rule,movementType:e.target.value as MovementType})}>
            <option value="any">Qualquer</option><option value="expense">Despesa</option><option value="income">Receita</option><option value="transfer">Transferência</option>
          </select></label>
        </div>
        <label>Padrão<input value={rule.pattern} onChange={e=>setRule({...rule,pattern:e.target.value})} placeholder="SUPERMERCADO"/></label>
        <label>Categoria<select value={rule.categoryId} onChange={e=>setRule({...rule,categoryId:e.target.value})}><option value="">Selecione…</option>
          {categories.map(c=><option key={c.id} value={c.id}>{c.parentId?"↳ ":""}{c.name}</option>)}</select></label>
        <label>Conta<select value={rule.accountId??""} onChange={e=>setRule({...rule,accountId:e.target.value||undefined})}><option value="">Todas as contas</option>
          {accounts.map(a=><option key={a.id} value={a.id}>{a.name}</option>)}</select></label>
        <div className="form-row">
          <label>Valor mínimo<input type="number" min="0" value={rule.minAmountInCents?rule.minAmountInCents/100:""} onChange={e=>setRule({...rule,minAmountInCents:e.target.value?Math.round(Number(e.target.value)*100):undefined})}/></label>
          <label>Valor máximo<input type="number" min="0" value={rule.maxAmountInCents?rule.maxAmountInCents/100:""} onChange={e=>setRule({...rule,maxAmountInCents:e.target.value?Math.round(Number(e.target.value)*100):undefined})}/></label>
        </div>
        <label className="check-label"><input type="checkbox" checked={rule.enabled} onChange={e=>setRule({...rule,enabled:e.target.checked})}/> Regra ativa</label>
        <div className="editor-actions"><button className="secondary" onClick={testRule}><TestTube2 size={16}/> Testar impacto</button><button onClick={saveRule}><Save size={16}/> Salvar regra</button></div>
        {impact&&<div className="impact"><b>{impact.count} transações correspondem</b>{impact.sample.map(x=><div key={x.transactionId}><span>{shortDate(x.date)} · {x.description}</span><small>{x.currentCategory??"Sem categoria"} → {x.suggestedCategory}</small></div>)}</div>}
      </article>
      <article className="panel">
        <div className="panel-title"><h2>Prioridade das regras</h2><span>A primeira correspondência vence</span></div>
        <div className="rule-list">{rules.map((r,index)=><div className={`rule-item ${!r.enabled?"disabled":""}`} key={r.id}>
          <span className="category-swatch" style={{background:categoryMap.get(r.categoryId)?.color??"#789"}}/>
          <div onClick={()=>editRule(r)} role="button" tabIndex={0}><b>{r.name}</b><small>{operatorLabel(r.operator)} “{r.pattern}” · {r.categoryName}</small></div>
          <span className="uses">{r.useCount} usos</span>
          <button className="icon-button" title="Subir" onClick={()=>moveRule(index,-1)}><ArrowUp size={14}/></button>
          <button className="icon-button" title="Descer" onClick={()=>moveRule(index,1)}><ArrowDown size={14}/></button>
          <button className="icon-button" title="Arquivar" onClick={()=>archiveRule(r.id)}><Archive size={14}/></button>
        </div>)}</div>
      </article>
    </div>}

    {tab==="categories"&&<div className="rules-layout">
      <article className="panel rule-editor"><div className="panel-title"><h2>{categoryDraft.id?"Editar categoria":"Nova categoria"}</h2>{categoryDraft.id&&<button className="text-button" onClick={()=>setCategoryDraft({name:"",kind:"expense",color:"#497ca5",sortOrder:0})}>Cancelar</button>}</div>
        <label>Nome<input value={categoryDraft.name} onChange={e=>setCategoryDraft({...categoryDraft,name:e.target.value})}/></label>
        <label>Tipo<select value={categoryDraft.kind} onChange={e=>setCategoryDraft({...categoryDraft,kind:e.target.value as CategoryKind})}>
          <option value="expense">Despesa</option><option value="income">Receita</option><option value="transfer">Transferência</option>
        </select></label>
        <label>Categoria superior<select value={categoryDraft.parentId??""} onChange={e=>setCategoryDraft({...categoryDraft,parentId:e.target.value||undefined})}><option value="">Nenhuma</option>
          {categories.filter(c=>c.id!==categoryDraft.id).map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
        <label>Ordem<input type="number" value={categoryDraft.sortOrder} onChange={e=>setCategoryDraft({...categoryDraft,sortOrder:Number(e.target.value)})}/></label>
        <label>Cor<input type="color" value={categoryDraft.color} onChange={e=>setCategoryDraft({...categoryDraft,color:e.target.value})}/></label>
        <button onClick={saveCategory}><Plus size={16}/> {categoryDraft.id?"Salvar categoria":"Criar categoria"}</button>
      </article>
      <article className="panel"><div className="panel-title"><h2>Estrutura atual</h2><span>Transferências não contam como despesa</span></div>
        {categories.map(c=><CategoryRow key={c.id} category={c} parent={c.parentId?categoryMap.get(c.parentId):undefined}
          onEdit={()=>setCategoryDraft({id:c.id,parentId:c.parentId,name:c.name,kind:c.kind,color:c.color??"#497ca5",sortOrder:c.sortOrder})}
          onArchive={()=>archiveCategory(c.id)}/>)}
      </article>
    </div>}
    {historyImpact&&<div className="modal-backdrop"><article className="modal"><h2>Aplicar regras ao histórico?</h2>
      <p className="muted">{historyImpact.count} transações serão categorizadas. Categorias definidas manualmente serão preservadas.</p>
      <div className="impact">{historyImpact.sample.map(x=><div key={x.transactionId}><span>{shortDate(x.date)} · {x.description}</span><small>{x.currentCategory??"Sem categoria"} → {x.suggestedCategory}</small></div>)}</div>
      <div className="editor-actions"><button className="secondary" onClick={()=>setHistoryImpact(undefined)}>Cancelar</button><button onClick={confirmApplyAll}>Confirmar aplicação</button></div>
    </article></div>}
  </section>
}

function operatorLabel(value:RuleOperator){return value==="contains"?"contém":value==="starts_with"?"começa com":"regex"}
function CategoryRow({category,parent,onEdit,onArchive}:{category:Category;parent?:Category;onEdit:()=>void;onArchive:()=>void}){
  return <div className="category-row"><span className="category-swatch" style={{background:category.color??"#789"}}/><div><b>{category.name}</b>
    <small>{parent?`${parent.name} · `:""}{category.kind==="expense"?"Despesa":category.kind==="income"?"Receita":"Transferência"}</small></div>
    {category.isSystem&&<span className="system-label">padrão</span>}<button className="icon-button" onClick={onEdit}>Editar</button><button className="icon-button" onClick={onArchive}><Archive size={14}/></button></div>
}
