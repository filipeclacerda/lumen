import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { open } from "@tauri-apps/plugin-dialog";
import { CreditCard, FileUp, ShieldCheck } from "lucide-react";
import { api } from "../../shared/api";
import { money } from "../../shared/format";
import type { CreditCardImportPreview, ImportPreview } from "../../shared/types";

export function ImportPage() {
  const client = useQueryClient();
  const [bankPreview, setBankPreview] = useState<ImportPreview>();
  const [cardPreview, setCardPreview] = useState<CreditCardImportPreview>();
  const [pendingCardPath, setPendingCardPath] = useState("");
  const [cardAccountId, setCardAccountId] = useState("");
  const [newCardName, setNewCardName] = useState("");
  const [message, setMessage] = useState("");
  const { data: categories = [] } = useQuery({queryKey:["categories"],queryFn:api.categories});
  const { data: accounts = [] } = useQuery({queryKey:["accounts"],queryFn:api.accounts});
  const bankAccount = accounts.find(a=>a.kind!=="credit_card");
  const cards = accounts.filter(a=>a.kind==="credit_card");

  async function choose() {
    if (!("__TAURI_INTERNALS__" in window)) {
      setMessage("Abra o aplicativo desktop para selecionar arquivos locais."); return;
    }
    const path = await open({ multiple:false, filters:[{name:"Extratos e faturas",extensions:["csv","ofx","pdf"]}] });
    if (!path) return;
    setMessage("");
    const kind = await api.detectImportKind(path);
    if (kind === "credit_card") {
      setPendingCardPath(path);
      setCardAccountId(cards[0]?.id ?? "");
      return;
    }
    if (!bankAccount) { setMessage("Cadastre uma conta bancária antes de importar o extrato."); return; }
    setBankPreview(await api.previewImport(path,bankAccount.id));
  }

  async function createCard() {
    if(newCardName.trim().length<2)return;
    const id=await api.createCreditCardAccount(newCardName.trim());
    await client.invalidateQueries({queryKey:["accounts"]});
    setCardAccountId(id); setNewCardName("");
  }

  async function previewCard() {
    if(!pendingCardPath||!cardAccountId)return;
    setCardPreview(await api.previewCreditCardImport(pendingCardPath,cardAccountId));
    setPendingCardPath("");
  }

  async function commitBank() {
    if(!bankPreview)return;
    const count=await api.commitImport(bankPreview.sessionId);
    setMessage(`${count} transações importadas com segurança.`);
    setBankPreview(undefined);
    await refresh();
  }

  async function commitCard() {
    if(!cardPreview)return;
    await api.commitCreditCardImport(cardPreview.sessionId);
    setMessage("Fatura importada. As compras já aparecem nas despesas pelas datas originais.");
    setCardPreview(undefined);
    await refresh();
  }

  async function refresh() {
    await Promise.all([
      client.invalidateQueries({queryKey:["transactions"]}),
      client.invalidateQueries({queryKey:["summary"]}),
      client.invalidateQueries({queryKey:["credit-card-invoices"]}),
      client.invalidateQueries({queryKey:["accounts"]})
    ]);
  }

  async function changeBankCategory(sourceRow:number,categoryId:string) {
    if(!bankPreview)return;
    await api.setImportCategory(bankPreview.sessionId,sourceRow,categoryId||undefined);
    const category=categories.find(c=>c.id===categoryId);
    setBankPreview({...bankPreview,candidates:bankPreview.candidates.map(c=>c.sourceRow===sourceRow?{
      ...c,suggestedCategoryId:categoryId||undefined,suggestedCategoryName:category?.name,
      suggestedRuleId:undefined,suggestedRuleName:undefined
    }:c)});
  }

  async function updateBankCandidate(sourceRow:number,amountInCents:number,included:boolean) {
    if(!bankPreview)return;
    try {
      const updated=await api.updateImportCandidate(bankPreview.sessionId,sourceRow,amountInCents,included);
      setBankPreview({...bankPreview,candidates:bankPreview.candidates.map(c=>c.sourceRow===sourceRow?updated:c)});
    } catch(e:any) {
      setMessage(`Erro ao atualizar lançamento: ${e?.message||e}`);
    }
  }

  async function updateCard(sourceRow:number,included:boolean,categoryId?:string,dueDate?:string) {
    if(!cardPreview)return;
    setCardPreview(await api.updateCreditCardImport(
      cardPreview.sessionId,sourceRow,included,categoryId,dueDate
    ));
  }

  return <section>
    <header><div><p className="eyebrow">IMPORTAÇÃO SEGURA</p><h1>Importar extrato ou fatura</h1>
      <p className="muted">CSV, OFX e PDF são processados somente neste computador.</p></div></header>

    {!bankPreview&&!cardPreview&&!pendingCardPath&&<article className="dropzone">
      <FileUp size={42}/><h2>Selecione um arquivo financeiro</h2>
      <p>O aplicativo reconhece automaticamente extratos e o CSV de fatura de cartão.</p>
      <button onClick={choose}>Escolher arquivo</button>
      <small><ShieldCheck size={15}/> Nenhum dado financeiro é enviado para a internet.</small>
    </article>}

    {pendingCardPath&&<article className="panel card-import-setup">
      <div className="panel-title"><div><p className="eyebrow">FATURA DETECTADA</p><h2>Em qual cartão importar?</h2></div><CreditCard/></div>
      {cards.length>0&&<label>Cartão
        <select value={cardAccountId} onChange={e=>setCardAccountId(e.target.value)}>
          {cards.map(card=><option key={card.id} value={card.id}>{card.name}</option>)}
        </select>
      </label>}
      <div className="inline-create">
        <label>Novo cartão<input value={newCardName} onChange={e=>setNewCardName(e.target.value)} placeholder="Ex.: Sicoob Mastercard"/></label>
        <button className="secondary" onClick={createCard}>Criar cartão</button>
      </div>
      <div className="editor-actions"><button className="secondary" onClick={()=>setPendingCardPath("")}>Cancelar</button>
        <button disabled={!cardAccountId} onClick={previewCard}>Revisar fatura</button></div>
    </article>}

    {bankPreview&&<article className="panel"><div className="panel-title"><h2>Prévia de {bankPreview.fileName}</h2><span>{bankPreview.candidates.length} registros</span></div>
      <table><thead><tr><th>Incluir</th><th>Data</th><th>Descrição</th><th>Categoria sugerida</th><th>Valor editável</th><th>Duplicidade</th></tr></thead>
      <tbody>{bankPreview.candidates.slice(0,100).map(c=><tr key={c.sourceRow} className={!c.included?"excluded-row":""}>
        <td><input type="checkbox" checked={c.included} disabled={c.duplicateStatus==="exact"}
          onChange={e=>updateBankCandidate(c.sourceRow,c.amountInCents,e.target.checked)}/></td>
        <td>{c.date}</td><td>{c.description}{c.suggestedRuleName&&<small className="source-label">por {c.suggestedRuleName}</small>}</td>
        <td><CategorySelect value={c.suggestedCategoryId} categories={categories} onChange={value=>changeBankCategory(c.sourceRow,value)}/></td>
        <td><MoneyEditor value={c.amountInCents} disabled={!c.included}
          onCommit={value=>updateBankCandidate(c.sourceRow,value,c.included)}/></td>
        <td><span className="badge">{c.duplicateStatus}</span></td></tr>)}</tbody></table>
      <button onClick={commitBank}>Confirmar importação</button></article>}

    {cardPreview&&<article className="panel">
      <div className="panel-title"><div><p className="eyebrow">FATURA DE CARTÃO</p><h2>{cardPreview.fileName}</h2></div>
        <label className="compact-label">Vencimento<input type="date" value={cardPreview.dueDate}
          onChange={e=>updateCard(cardPreview.items[0].candidate.sourceRow,cardPreview.items[0].included,cardPreview.items[0].candidate.suggestedCategoryId,e.target.value)}/></label></div>
      <div className="invoice-totals">
        <div><span>Compras</span><strong>{money(cardPreview.purchasesInCents)}</strong></div>
        <div><span>Créditos e pagamentos</span><strong>{money(cardPreview.creditsInCents)}</strong></div>
        <div className="invoice-total"><span>Saldo da fatura</span><strong>{money(cardPreview.totalInCents)}</strong></div>
      </div>
      <div className="table-scroll"><table><thead><tr><th>Incluir</th><th>Data</th><th>Estabelecimento</th><th>Portador</th><th>Parcela</th><th>Categoria</th><th>Valor</th></tr></thead>
        <tbody>{cardPreview.items.map(item=><tr key={item.candidate.sourceRow} className={!item.included?"excluded-row":""}>
          <td><input type="checkbox" checked={item.included} disabled={item.candidate.duplicateStatus==="exact"}
            onChange={e=>updateCard(item.candidate.sourceRow,e.target.checked,item.candidate.suggestedCategoryId)}/></td>
          <td>{item.candidate.date}</td><td>{item.candidate.description}{item.isPayment&&<small className="source-label">transferência</small>}</td>
          <td>{item.holder??"—"}</td><td>{item.installment??"—"}</td>
          <td><CategorySelect value={item.candidate.suggestedCategoryId} categories={categories}
            onChange={value=>updateCard(item.candidate.sourceRow,item.included,value)}/></td>
          <td className={item.candidate.amountInCents>0?"positive amount":"amount"}>{money(item.candidate.amountInCents)}</td>
        </tr>)}</tbody></table></div>
      <div className="editor-actions"><button className="secondary" onClick={()=>setCardPreview(undefined)}>Cancelar</button>
        <button onClick={commitCard}>Confirmar fatura</button></div>
    </article>}
    {message&&<p className="notice">{message}</p>}
  </section>
}

function CategorySelect({value,categories,onChange}:{
  value?:string; categories:Awaited<ReturnType<typeof api.categories>>; onChange:(value:string)=>void
}) {
  return <select className="category-select" value={value??""} onChange={e=>onChange(e.target.value)}>
    <option value="">Sem categoria</option>
    {categories.map(category=><option key={category.id} value={category.id}>{category.parentId?"↳ ":""}{category.name}</option>)}
  </select>
}

function MoneyEditor({value,disabled,onCommit}:{value:number;disabled?:boolean;onCommit:(value:number)=>void}) {
  const [text,setText]=useState((value/100).toFixed(2).replace(".",","));
  function commit() {
    const normalized=text.trim().replace(/\./g,"").replace(",",".");
    const parsed=Number(normalized);
    if(!Number.isFinite(parsed)||parsed===0) {
      setText((value/100).toFixed(2).replace(".",","));
      return;
    }
    const cents=Math.round(parsed*100);
    setText((cents/100).toFixed(2).replace(".",","));
    if(cents!==value)onCommit(cents);
  }
  return <div className="editable-money"><span>R$</span><input aria-label="Valor da transação" value={text} disabled={disabled}
    onChange={e=>setText(e.target.value)} onBlur={commit} onKeyDown={e=>{if(e.key==="Enter")e.currentTarget.blur()}}/></div>
}
