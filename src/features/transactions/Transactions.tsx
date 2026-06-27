import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Search, Tags, Trash2, Undo2 } from "lucide-react";
import { useState } from "react";
import { api } from "../../shared/api";
import { money, shortDate } from "../../shared/format";
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
  const { data = [] } = useQuery({ queryKey: ["transactions"], queryFn: api.transactions });
  const { data: categories = [] } = useQuery({ queryKey: ["categories"], queryFn: api.categories });
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
      <table><thead><tr><th className="select-cell"><input type="checkbox" aria-label="Selecionar transações visíveis" checked={allVisibleSelected} onChange={toggleAll}/></th><th>Data</th><th>Descrição</th><th>Categoria</th><th>Status</th><th>Valor</th></tr></thead>
      <tbody>{rows.map(t=><tr key={t.id} className={selected.has(t.id)?"selected-row":""}><td className="select-cell"><input type="checkbox" aria-label={`Selecionar ${t.description}`} checked={selected.has(t.id)} onChange={()=>toggle(t.id)}/></td><td>{shortDate(t.date)}</td><td><b>{t.description}</b></td><td><select className="category-select" aria-label={`Categoria de ${t.description}`} value={t.categoryId??""} onChange={e=>changeCategory(t,e.target.value)}>
        <option value="">Sem categoria</option>{categories.map(c=><option key={c.id} value={c.id}>{c.parentId?"↳ ":""}{c.name}</option>)}</select>
        {t.categorySource&&<small className="source-label">{t.categorySource==="rule"?"regra":"manual"}</small>}</td>
        <td><span className="badge">{t.status === "cleared" ? "Confirmada" : "Pendente"}</span></td><td className={t.amountInCents > 0 ? "positive amount" : "amount"}>{money(t.amountInCents)}</td></tr>)}</tbody></table>
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
