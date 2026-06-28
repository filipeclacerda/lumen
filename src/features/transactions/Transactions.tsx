import { useQuery, useQueryClient } from "@tanstack/react-query";
import { CreditCard, Landmark, Search, Tags, Trash2, Undo2 } from "lucide-react";
import { useState } from "react";
import { api } from "../../shared/api";
import { shortDate } from "../../shared/format";
import type { Transaction } from "../../shared/types";

export function Transactions() {
  const [search, setSearch] = useState("");
  const [learning, setLearning] = useState<{transaction:Transaction;categoryId:string;pattern:string}>();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkCategory, setBulkCategory] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [undoIds, setUndoIds] = useState<string[]>([]);
  const [notice, setNotice] = useState("");
  const client = useQueryClient();
  const { data = [] } = useQuery({ queryKey: ["transactions"], queryFn: () => api.transactions() });
  const { data: categories = [] } = useQuery({ queryKey: ["categories"], queryFn: () => api.categories() });
  const rows = data.filter(t => t.description.toLowerCase().includes(search.toLowerCase()));
  const allVisibleSelected = rows.length > 0 && rows.every(t=>selected.has(t.id));
  function toggle(id:string) {
    setSelected(current=>{const next=new Set(current);next.has(id)?next.delete(id):next.add(id);return next});
  }
  function toggleAll() {
    setSelected(current=>{
      const next=new Set(current);
      if(allVisibleSelected) rows.forEach(t=>next.delete(t.id)); else rows.forEach(t=>next.add(t.id));
      return next;
    });
  }
  async function refresh() {
    await Promise.all([client.invalidateQueries({queryKey:["transactions"]}),client.invalidateQueries({queryKey:["summary"]})]);
  }
  async function changeCategory(transaction:Transaction, categoryId:string) {
    await api.updateTransactionCategory(transaction.id, categoryId || undefined);
    await refresh();
    if(categoryId) setLearning({transaction,categoryId,pattern:transaction.description.toUpperCase()});
  }
  async function changeAmount(transactionId:string,amountInCents:number) {
    try {
      await api.updateTransactionAmount(transactionId,amountInCents);
      setNotice("Valor da transação atualizado."); await refresh();
    } catch(e:any) {
      setNotice(`Não foi possível atualizar: ${e?.message||e}`);
    }
  }
  async function deleteOne(id:string) {
    const count=await api.deleteTransactions([id]);
    setUndoIds([id]); setNotice(`${count} transação movida para a lixeira.`);
    setSelected(current=>{const next=new Set(current);next.delete(id);return next}); await refresh();
  }
  async function createRule() {
    if(!learning)return;
    const selectedCategory=categories.find(c=>c.id===learning.categoryId);
    await api.saveRule({
      name:`Reconhecer ${learning.transaction.description}`,priority:100,enabled:true,operator:"contains",
      pattern:learning.pattern,movementType:selectedCategory?.kind==="transfer"?"transfer":learning.transaction.amountInCents>=0?"income":"expense",
      categoryId:learning.categoryId
    });
    setLearning(undefined); await client.invalidateQueries({queryKey:["rules"]});
  }
  async function applyBulkCategory() {
    const ids=[...selected]; if(!ids.length)return;
    const count=await api.bulkUpdateTransactionCategory(ids,bulkCategory||undefined);
    setNotice(`${count} transações atualizadas.`); setSelected(new Set()); setBulkCategory(""); await refresh();
  }
  async function deleteSelected() {
    const ids=[...selected]; if(!ids.length)return;
    const count=await api.deleteTransactions(ids);
    setUndoIds(ids); setNotice(`${count} transações movidas para a lixeira.`);
    setSelected(new Set()); setConfirmDelete(false); await refresh();
  }
  async function undoDelete() {
    const count=await api.restoreTransactions(undoIds);
    setUndoIds([]); setNotice(`${count} transações restauradas.`); await refresh();
  }
  return <section><header><div><p className="eyebrow">MOVIMENTAÇÕES</p><h1>Transações</h1><p className="muted">{data.length} lançamentos no período</p></div></header>
    {notice&&<div className="notice notice-action"><span>{notice}</span>{undoIds.length>0&&<button className="text-button" onClick={undoDelete}><Undo2 size={15}/> Desfazer</button>}</div>}
    <article className="panel"><div className="transactions-toolbar"><div className="toolbar"><Search size={18}/><input aria-label="Buscar transações" placeholder="Buscar por descrição…" value={search} onChange={e=>setSearch(e.target.value)}/></div>
      {selected.size>0&&<div className="bulk-actions"><b>{selected.size} selecionada{selected.size>1?"s":""}</b><select aria-label="Categoria em massa" value={bulkCategory} onChange={e=>setBulkCategory(e.target.value)}>
        <option value="">Sem categoria</option>{categories.map(c=><option key={c.id} value={c.id}>{c.parentId?"↳ ":""}{c.name}</option>)}</select>
        <button className="secondary" onClick={applyBulkCategory}><Tags size={15}/> Categorizar</button>
        <button className="danger" onClick={()=>setConfirmDelete(true)}><Trash2 size={15}/> Excluir</button></div>}</div>
      <table><thead><tr><th className="select-cell"><input type="checkbox" aria-label="Selecionar transações visíveis" checked={allVisibleSelected} onChange={toggleAll}/></th><th>Data</th><th>Descrição</th><th>Origem</th><th>Categoria</th><th>Status</th><th>Valor editável</th><th></th></tr></thead>
      <tbody>
        {rows.length === 0 && <tr><td colSpan={8} style={{textAlign:"center", padding:"60px 20px", color:"#87908c"}}>Nenhuma transação encontrada para este filtro.</td></tr>}
        {rows.map(t=><tr key={t.id} className={selected.has(t.id)?"selected-row":""}>
          <td className="select-cell"><input type="checkbox" aria-label={`Selecionar ${t.description}`} checked={selected.has(t.id)} onChange={()=>toggle(t.id)}/></td>
          <td style={{whiteSpace:"nowrap", color: "#66706c"}}>{shortDate(t.date)}</td>
          <td><div style={{display:"flex", alignItems:"center", gap:"12px"}}><div className="tx-icon">{t.description[0]}</div> <b>{t.description}</b></div></td>
          <td><span className={`origin-tag ${t.accountKind==="credit_card"?"card-origin":"bank-origin"}`}>
            {t.accountKind==="credit_card"?<CreditCard size={13}/>:<Landmark size={13}/>}
            <span>{t.accountKind==="credit_card"?"Cartão de crédito":"Conta bancária"}<small>{t.accountName}</small></span>
          </span></td>
          <td><select className="category-select" aria-label={`Categoria de ${t.description}`} value={t.categoryId??""} onChange={e=>changeCategory(t,e.target.value)}>
            <option value="">Sem categoria</option>{categories.map(c=><option key={c.id} value={c.id}>{c.parentId?"↳ ":""}{c.name}</option>)}</select>
            {t.categorySource&&<small className="source-label" style={{marginTop:"6px"}}>{t.categorySource==="rule"?"categorizado por regra":"selecionado manualmente"}</small>}
          </td>
          <td><span className="badge" style={t.status === 'cleared' ? undefined : {background:"#fbf3e5", color:"#a96a1a"}}>{t.status === "cleared" ? "Confirmada" : "Pendente"}</span></td>
          <td><TransactionAmountEditor value={t.amountInCents} onCommit={value=>changeAmount(t.id,value)}/></td>
          <td><button className="danger icon-button" title="Excluir transação" aria-label={`Excluir ${t.description}`} onClick={()=>deleteOne(t.id)}><Trash2 size={15}/></button></td>
        </tr>)}
      </tbody></table>
    </article>
    {learning&&<div className="modal-backdrop"><article className="modal"><h2>Usar esta correção no futuro?</h2><p className="muted">Você pode criar uma regra local ou manter a alteração somente nesta transação.</p>
      <label>Descrição contém<input value={learning.pattern} onChange={e=>setLearning({...learning,pattern:e.target.value})}/></label>
      <div className="editor-actions"><button className="secondary" onClick={()=>setLearning(undefined)}>Somente esta transação</button><button onClick={createRule}>Criar regra</button></div>
    </article></div>}
    {confirmDelete&&<div className="modal-backdrop"><article className="modal"><h2>Excluir {selected.size} transações?</h2>
      <p className="muted">Elas serão removidas dos saldos e relatórios. Você poderá desfazer imediatamente após a ação.</p>
      <div className="editor-actions"><button className="secondary" onClick={()=>setConfirmDelete(false)}>Cancelar</button><button className="danger" onClick={deleteSelected}><Trash2 size={15}/> Mover para lixeira</button></div>
    </article></div>}
  </section>
}

function TransactionAmountEditor({value,onCommit}:{value:number;onCommit:(value:number)=>void}) {
  const [text,setText]=useState((value/100).toFixed(2).replace(".",","));
  function commit() {
    const parsed=Number(text.trim().replace(/\./g,"").replace(",","."));
    if(!Number.isFinite(parsed)||parsed===0){setText((value/100).toFixed(2).replace(".",","));return}
    const cents=Math.round(parsed*100);
    setText((cents/100).toFixed(2).replace(".",","));
    if(cents!==value)onCommit(cents);
  }
  return <div className="editable-money"><span>R$</span><input value={text} aria-label="Editar valor"
    onChange={e=>setText(e.target.value)} onBlur={commit} onKeyDown={e=>{if(e.key==="Enter")e.currentTarget.blur()}}/></div>
}
