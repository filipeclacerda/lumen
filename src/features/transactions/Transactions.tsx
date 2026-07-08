import { useQuery, useQueryClient } from "@tanstack/react-query";
import { CreditCard, Download, Landmark, Pencil, Plus, Repeat, Search, Tags, Trash2, Undo2, ArrowUpRight, ArrowDownRight, X } from "lucide-react";
import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { save } from "@tauri-apps/plugin-dialog";
import { api } from "../../shared/api";
import { money, shortDate, suggestRulePattern } from "../../shared/format";
import { CategorySelect } from "../../shared/ui/CategorySelect";
import { useToast } from "../../shared/ui/toast";
import type { ReportSource, Transaction } from "../../shared/types";
import { TransactionForm } from "./TransactionForm";

const PAGE_SIZE = 100;

export function Transactions() {
  const [searchParams, setSearchParams] = useSearchParams();
  const categoryFilter = searchParams.get("category") ?? "";
  const uncategorizedFilter = searchParams.get("uncategorized") === "1";
  const startMonthFilter = searchParams.get("startMonth") ?? "";
  const endMonthFilter = searchParams.get("endMonth") ?? "";
  const sourceParam = searchParams.get("source");
  const sourceFilter = (sourceParam === "bank" || sourceParam === "credit_card" ? sourceParam : "") as ReportSource | "";
  const accountFilter = searchParams.get("accountId") ?? "";
  const qParam = searchParams.get("q") ?? "";
  const [search, setSearch] = useState(qParam);
  const [debouncedSearch, setDebouncedSearch] = useState(qParam);
  const [exporting, setExporting] = useState(false);
  const toast = useToast();
  const [page, setPage] = useState(0);
  const [showNew, setShowNew] = useState(false);
  const [editing, setEditing] = useState<Transaction>();
  const [learning, setLearning] = useState<{transaction:Transaction;categoryId:string;pattern:string}>();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkCategory, setBulkCategory] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [undo, setUndo] = useState<
    { kind: "delete"; ids: string[] } | { kind: "categorize"; previous: { id: string; categoryId?: string }[] }
  >();
  const [notice, setNotice] = useState("");
  const client = useQueryClient();

  // Debounce the search box so typing doesn't spam the backend with a query per keystroke.
  useEffect(() => {
    const timeout = setTimeout(() => setDebouncedSearch(search), 300);
    return () => clearTimeout(timeout);
  }, [search]);

  // Seeds the search box from a `?q=` URL param (e.g. navigated here from the command palette),
  // then drops the param so it doesn't linger once the box has taken over.
  useEffect(() => {
    if (!qParam) return;
    setSearch(qParam);
    setDebouncedSearch(qParam);
    setSearchParams(params => {
      const next = new URLSearchParams(params);
      next.delete("q");
      return next;
    }, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [qParam]);

  // Any filter change resets pagination back to the first page.
  useEffect(() => {
    setPage(0);
  }, [debouncedSearch, categoryFilter, uncategorizedFilter, startMonthFilter, endMonthFilter, sourceFilter, accountFilter]);

  const filter = {
    startMonth: startMonthFilter || undefined,
    endMonth: endMonthFilter || undefined,
    source: sourceFilter || undefined,
    accountId: accountFilter || undefined,
    categoryId: uncategorizedFilter ? undefined : (categoryFilter || undefined),
    uncategorized: uncategorizedFilter || undefined,
    search: debouncedSearch || undefined,
    limit: PAGE_SIZE,
    offset: page * PAGE_SIZE,
  };
  const { data, isLoading } = useQuery({
    queryKey: ["transactions", filter],
    queryFn: () => api.listTransactions(filter),
  });
  const items = data?.items ?? [];
  const totalCount = data?.totalCount ?? 0;
  const { data: categories = [] } = useQuery({ queryKey: ["categories"], queryFn: () => api.categories() });
  const categoryFilterName = uncategorizedFilter ? "Sem categoria" : categories.find(c => c.id === categoryFilter)?.name;
  const hasReportFilters = Boolean(categoryFilter||uncategorizedFilter||startMonthFilter||endMonthFilter||sourceFilter||accountFilter);
  const sourceLabel = sourceFilter === "bank" ? "conta bancária" : sourceFilter === "credit_card" ? "cartão de crédito" : "";
  const filterSummary = [
    categoryFilterName&&`categoria: ${categoryFilterName}`,
    startMonthFilter&&endMonthFilter&&`${startMonthFilter} a ${endMonthFilter}`,
    sourceLabel&&`origem: ${sourceLabel}`,
    accountFilter&&`conta selecionada`
  ].filter(Boolean).join(" · ");
  const rows = items;
  function clearReportFilters() {
    setSearchParams(params => {
      const next = new URLSearchParams(params);
      ["category","uncategorized","startMonth","endMonth","source","accountId"].forEach(key=>next.delete(key));
      return next;
    });
  }
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
  const exportFilter = {
    startMonth: filter.startMonth,
    endMonth: filter.endMonth,
    source: filter.source,
    accountId: filter.accountId,
    categoryId: filter.categoryId,
    uncategorized: filter.uncategorized,
    search: filter.search,
  };
  async function exportFile(kind: "csv" | "ofx" | "pdf") {
    if (!("__TAURI_INTERNALS__" in window)) {
      toast("Abra o aplicativo desktop para exportar arquivos.", "error");
      return;
    }
    const labels = {
      csv: { name: "CSV", extension: "csv", action: api.exportTransactionsCsv },
      ofx: { name: "OFX", extension: "ofx", action: api.exportTransactionsOfx },
      pdf: { name: "PDF", extension: "pdf", action: api.exportTransactionsPdf },
    };
    const option = labels[kind];
    const path = await save({ defaultPath: `transacoes.${option.extension}`, filters: [{ name: option.name, extensions: [option.extension] }] });
    if (!path) return;
    setExporting(true);
    try {
      const count = await option.action(path, exportFilter);
      toast(`${count} transações exportadas em ${option.name}.`);
    } catch (error: any) {
      toast(`Não foi possível exportar ${option.name}: ${error?.message || error}`, "error");
    } finally {
      setExporting(false);
    }
  }
  async function refresh() {
    await Promise.all([client.invalidateQueries({queryKey:["transactions"]}),client.invalidateQueries({queryKey:["summary"]})]);
  }
  async function changeCategory(transaction:Transaction, categoryId?:string) {
    await api.updateTransactionCategory(transaction.id, categoryId || undefined);
    await refresh();
    if(categoryId) setLearning({transaction,categoryId,pattern:suggestRulePattern(transaction.description)});
  }
  async function deleteOne(id:string) {
    const count=await api.deleteTransactions([id]);
    setUndo({kind:"delete",ids:[id]}); setNotice(`${count} transação movida para a lixeira.`);
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
    setLearning(undefined);
    await api.applyRules(false);
    await client.invalidateQueries({queryKey:["rules"]});
    await refresh();
  }
  async function applyBulkCategory() {
    const ids=[...selected]; if(!ids.length)return;
    const previous=ids.map(id=>({id,categoryId:items.find(t=>t.id===id)?.categoryId}));
    const count=await api.bulkUpdateTransactionCategory(ids,bulkCategory||undefined);
    setUndo({kind:"categorize",previous});
    setNotice(`${count} transações atualizadas.`); setSelected(new Set()); setBulkCategory(""); await refresh();
  }
  async function deleteSelected() {
    const ids=[...selected]; if(!ids.length)return;
    const count=await api.deleteTransactions(ids);
    setUndo({kind:"delete",ids}); setNotice(`${count} transações movidas para a lixeira.`);
    setSelected(new Set()); setConfirmDelete(false); await refresh();
  }
  async function undoLast() {
    if(!undo)return;
    if(undo.kind==="delete"){
      const count=await api.restoreTransactions(undo.ids);
      setNotice(`${count} transações restauradas.`);
    } else {
      // Regroup by former category so the rollback runs as few bulk calls as possible.
      const groups=new Map<string|undefined,string[]>();
      undo.previous.forEach(p=>{
        const list=groups.get(p.categoryId)??[];
        list.push(p.id); groups.set(p.categoryId,list);
      });
      for(const [categoryId,ids] of groups) await api.bulkUpdateTransactionCategory(ids,categoryId);
      setNotice(`${undo.previous.length} transações voltaram às categorias anteriores.`);
    }
    setUndo(undefined); await refresh();
  }
  const rangeStart = totalCount === 0 ? 0 : page * PAGE_SIZE + 1;
  const rangeEnd = Math.min(totalCount, page * PAGE_SIZE + rows.length);
  const hasMore = page * PAGE_SIZE + rows.length < totalCount;
  const hasPrevious = page > 0;
  return <section><header><div><p className="eyebrow">MOVIMENTAÇÕES</p><h1>Transações</h1><p className="muted">{totalCount === 0 ? "0 lançamentos" : `${rangeStart}–${rangeEnd} de ${totalCount} lançamentos`}</p></div>
    <div style={{display:"flex", gap:"10px"}}>
      <button className="secondary" disabled={exporting} onClick={() => exportFile("csv")}><Download size={17}/> CSV</button>
      <button className="secondary" disabled={exporting} onClick={() => exportFile("ofx")}><Download size={17}/> OFX</button>
      <button className="secondary" disabled={exporting} onClick={() => exportFile("pdf")}><Download size={17}/> PDF</button>
      <button onClick={()=>setShowNew(true)}><Plus size={17}/> Nova transação</button>
    </div></header>
    {showNew&&<TransactionForm onClose={()=>setShowNew(false)}/>}
    {editing&&<TransactionForm existing={editing} onClose={()=>setEditing(undefined)}/>}
    {notice&&<div className="notice notice-action"><span>{notice}</span>{undo&&<button className="text-button" onClick={undoLast}><Undo2 size={15}/> Desfazer</button>}</div>}
    {hasReportFilters&&<div className="notice notice-action"><span>Filtros do relatório: <b>{filterSummary||"ativos"}</b></span>
      <button className="text-button" onClick={clearReportFilters}><X size={15}/> Remover filtros</button></div>}
    <article className="panel"><div className="transactions-toolbar"><div className="toolbar"><Search size={18}/><input aria-label="Buscar transações" placeholder="Buscar por descrição…" value={search} onChange={e=>setSearch(e.target.value)}/></div>
      {selected.size>0&&<div className="bulk-actions"><b>{selected.size} selecionada{selected.size>1?"s":""}</b><CategorySelect
          value={bulkCategory}
          onChange={id => setBulkCategory(id ?? "")}
          categories={categories}
          allowEmpty
          emptyLabel="Sem categoria"
        />
        <button className="secondary" onClick={applyBulkCategory}><Tags size={15}/> Categorizar</button>
        <button className="danger" onClick={()=>setConfirmDelete(true)}><Trash2 size={15}/> Excluir</button></div>}</div>
      <div className="table-scroll"><table><thead><tr><th className="select-cell"><input type="checkbox" aria-label="Selecionar transações visíveis" checked={allVisibleSelected} onChange={toggleAll}/></th><th>Data</th><th>Descrição</th><th>Origem</th><th>Categoria</th><th>Status</th><th className="amount">Valor</th><th></th></tr></thead>
      <tbody>
        {rows.length === 0 && <tr><td colSpan={8} style={{textAlign:"center", padding:"60px 20px", color:"var(--text-soft)"}}>{isLoading?"Carregando transações…":"Nenhuma transação encontrada para este filtro."}</td></tr>}
        {rows.map(t=><tr key={t.id} className={selected.has(t.id)?"selected-row":""}>
          <td className="select-cell"><input type="checkbox" aria-label={`Selecionar ${t.description}`} checked={selected.has(t.id)} onChange={()=>toggle(t.id)}/></td>
          <td style={{whiteSpace:"nowrap", color: "#66706c"}}>{shortDate(t.date)}</td>
          <td><div style={{display:"flex", alignItems:"center", gap:"12px"}}>
            {(() => {
              const c = categories.find(cat => cat.id === t.categoryId);
              const isInv = c?.kind === "investment";
              const isInc = t.amountInCents > 0;
              const bg = isInv ? "#eaf1f8" : isInc ? "#e8f5ef" : "#fff0ed";
              const col = isInv ? "#3d6f9a" : isInc ? "#16825c" : "#c76155";
              return <div className="tx-icon" style={{background: bg, color: col}}>
                {isInc || isInv ? <ArrowUpRight size={20} /> : <ArrowDownRight size={20} />}
              </div>;
            })()}
            <b>{t.description}</b>
            {t.isTransferLeg && <span className="badge" title="Parte de uma transferência vinculada" style={{display:"inline-flex", alignItems:"center", gap:"4px", background:"#eef0ff", color:"#4c5bd4"}}><Repeat size={12}/> Vinculada</span>}
          </div></td>
          <td><span className={`origin-tag ${t.accountKind==="credit_card"?"card-origin":"bank-origin"}`}>
            {t.accountKind==="credit_card"?<CreditCard size={13}/>:<Landmark size={13}/>}
            <span>{t.accountKind==="credit_card"?"Cartão de crédito":"Conta bancária"}<small>{t.accountName}</small></span>
          </span></td>
          <td><CategorySelect
            value={t.categoryId}
            onChange={id => changeCategory(t, id)}
            categories={categories}
            allowEmpty
            emptyLabel="Sem categoria"
            className="category-select"
          />
            {t.categorySource&&<small className="source-label" style={{marginTop:"6px"}}>{t.categorySource==="rule"?"categorizado por regra":"selecionado manualmente"}</small>}
          </td>
          <td><span className="badge" style={t.status === 'cleared' ? undefined : {background:"#fbf3e5", color:"#a96a1a"}}>{t.status === "cleared" ? "Confirmada" : "Pendente"}</span></td>
          <td className="amount"><span className={t.amountInCents>0?"positive":""}>{money(t.amountInCents)}</span></td>
          <td><div className="row-actions"><button className="icon-button" title="Editar transação" aria-label={`Editar ${t.description}`} onClick={()=>setEditing(t)}><Pencil size={14}/></button>
            <button className="danger icon-button" title="Excluir transação" aria-label={`Excluir ${t.description}`} onClick={()=>deleteOne(t.id)}><Trash2 size={15}/></button></div></td>
        </tr>)}
      </tbody></table></div>
      {totalCount > 0 && <div className="pagination" style={{display:"flex", alignItems:"center", justifyContent:"flex-end", gap:"10px", padding:"14px 4px 4px"}}>
        <span className="muted" style={{fontSize:13}}>{rangeStart}–{rangeEnd} de {totalCount}</span>
        <button className="secondary" disabled={!hasPrevious} onClick={()=>setPage(p=>Math.max(0,p-1))}>Anterior</button>
        <button className="secondary" disabled={!hasMore} onClick={()=>setPage(p=>p+1)}>Carregar mais</button>
      </div>}
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
