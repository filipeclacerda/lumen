import { useQuery, useQueryClient } from "@tanstack/react-query";
import { CreditCard, Landmark, Link2, Trash2, Undo2, Unlink } from "lucide-react";
import { useState } from "react";
import { api } from "../../shared/api";
import { money, shortDate } from "../../shared/format";
import type { CreditCardInvoice, PaymentMatchCandidate } from "../../shared/types";

export function AccountsCards() {
  const client=useQueryClient();
  const [expanded,setExpanded]=useState<string>();
  const [matching,setMatching]=useState<{
    invoice?:CreditCardInvoice; creditTransactionId?:string; amountInCents:number; candidates:PaymentMatchCandidate[]
  }>();
  const [undoId,setUndoId]=useState<string>();
  const [notice,setNotice]=useState("");
  const {data:accounts=[]}=useQuery({queryKey:["accounts"],queryFn:api.accounts});
  const {data:invoices=[]}=useQuery({queryKey:["credit-card-invoices"],queryFn:api.creditCardInvoices});
  const {data:items=[]}=useQuery({
    queryKey:["credit-card-invoice-items",expanded],
    queryFn:()=>api.creditCardInvoiceItems(expanded!),
    enabled:Boolean(expanded)
  });

  async function refresh() {
    await Promise.all([
      client.invalidateQueries({queryKey:["credit-card-invoices"]}),
      client.invalidateQueries({queryKey:["credit-card-invoice-items"]}),
      client.invalidateQueries({queryKey:["transactions"]}),
      client.invalidateQueries({queryKey:["summary"]}),
      client.invalidateQueries({queryKey:["accounts"]})
    ]);
  }
  async function findPayment(invoice:CreditCardInvoice) {
    setMatching({invoice,amountInCents:invoice.totalInCents,candidates:await api.invoicePaymentMatches(invoice.id)});
  }
  async function findImportedPayment(transactionId:string,amountInCents:number) {
    setMatching({creditTransactionId:transactionId,amountInCents,candidates:await api.cardPaymentMatches(transactionId)});
  }
  async function link(transactionId:string) {
    if(!matching)return;
    if(matching.invoice) await api.linkInvoicePayment(matching.invoice.id,transactionId);
    else await api.linkCardPayment(matching.creditTransactionId!,transactionId);
    setNotice("Pagamento vinculado. Ele agora é tratado como transferência.");
    setMatching(undefined); await refresh();
  }
  async function unlink(invoiceId:string) {
    await api.unlinkInvoicePayment(invoiceId);
    setNotice("Vínculo removido; a fatura voltou a ficar aberta."); await refresh();
  }
  async function unlinkImportedPayment(transactionId:string) {
    await api.unlinkCardPayment(transactionId);
    setNotice("Conciliação do pagamento removida."); await refresh();
  }
  async function remove(invoiceId:string) {
    await api.setCreditCardInvoiceDeleted(invoiceId,true);
    setUndoId(invoiceId); setNotice("Fatura e lançamentos removidos."); await refresh();
  }
  async function restore() {
    if(!undoId)return;
    await api.setCreditCardInvoiceDeleted(undoId,false);
    setUndoId(undefined); setNotice("Fatura restaurada."); await refresh();
  }

  return <section>
    <header><div><p className="eyebrow">PATRIMÔNIO E CRÉDITO</p><h1>Contas e cartões</h1>
      <p className="muted">Saldos, faturas e pagamentos conciliados em um só lugar.</p></div></header>
    {notice&&<div className="notice notice-action"><span>{notice}</span>{undoId&&<button className="text-button" onClick={restore}><Undo2 size={15}/> Desfazer</button>}</div>}
    <div className="account-grid">{accounts.map(account=><article className="account-card" key={account.id}>
      <div className={`metric-icon ${account.kind==="credit_card"?"red":"green"}`}>{account.kind==="credit_card"?<CreditCard/>:<Landmark/>}</div>
      <div><small>{account.kind==="credit_card"?"Cartão de crédito":"Conta"}</small><h3>{account.name}</h3></div>
      <strong>{money(account.balanceInCents)}</strong>
    </article>)}</div>
    <article className="panel">
      <div className="panel-title"><h2>Faturas importadas</h2><span>{invoices.length} fatura{invoices.length===1?"":"s"}</span></div>
      {invoices.length===0?<div className="empty-state"><CreditCard size={34}/><h3>Nenhuma fatura importada</h3>
        <p className="muted">Use a área Importar para adicionar o CSV do cartão.</p></div>:
      <div className="invoice-list">{invoices.map(invoice=><div className="invoice-row-wrap" key={invoice.id}>
        <div className="invoice-row">
          <button className="invoice-main" onClick={()=>setExpanded(expanded===invoice.id?undefined:invoice.id)}>
            <span><b>{invoice.accountName}</b><small>Vence em {shortDate(invoice.dueDate)}</small></span>
            <span><small>Compras</small>{money(invoice.purchasesInCents)}</span>
            <span><small>Créditos</small>{money(invoice.creditsInCents)}</span>
            <strong>{money(invoice.totalInCents)}</strong>
            <span className={`badge ${invoice.status==="paid"?"success-badge":""}`}>{invoice.status==="paid"?"Paga":"Aberta"}</span>
          </button>
          <div className="invoice-actions">
            {invoice.paymentTransactionId
              ?<button className="secondary icon-button" title="Desvincular pagamento" onClick={()=>unlink(invoice.id)}><Unlink size={16}/></button>
              :<button className="secondary" onClick={()=>findPayment(invoice)}><Link2 size={15}/> Vincular pagamento</button>}
            <button className="danger icon-button" title="Excluir fatura" onClick={()=>remove(invoice.id)}><Trash2 size={16}/></button>
          </div>
        </div>
        {invoice.paymentTransactionId&&<p className="linked-payment"><Link2 size={14}/> {invoice.paymentDescription} em {shortDate(invoice.paymentDate!)}</p>}
        {expanded===invoice.id&&<div className="invoice-items">
          <table><thead><tr><th>Data</th><th>Descrição</th><th>Portador</th><th>Parcela</th><th>Categoria</th><th>Valor</th><th></th></tr></thead>
            <tbody>{items.map(item=><tr key={item.transactionId}><td>{shortDate(item.date)}</td><td>{item.description}</td>
              <td>{item.holder??"—"}</td><td>{item.installment??"—"}</td><td>{item.categoryName??"Sem categoria"}</td>
              <td className={item.amountInCents>0?"positive amount":"amount"}>{money(item.amountInCents)}</td>
              <td>{item.isPayment&&(item.isLinked?<button className="secondary" onClick={()=>unlinkImportedPayment(item.transactionId)}><Unlink size={14}/> Desvincular</button>:
                <button className="secondary" onClick={()=>findImportedPayment(item.transactionId,item.amountInCents)}><Link2 size={14}/> Conciliar</button>)}</td>
            </tr>)}</tbody></table>
        </div>}
      </div>)}</div>}
    </article>
    {matching&&<div className="modal-backdrop"><article className="modal wide-modal">
      <h2>Vincular pagamento de {money(matching.amountInCents)}</h2>
      <p className="muted">Sugestões com o mesmo valor e até 10 dias de distância. O vínculo só será criado após sua confirmação.</p>
      {matching.candidates.length===0?<p className="notice">Nenhum débito bancário compatível foi encontrado.</p>:
        <div className="match-list">{matching.candidates.map(candidate=><button className="match-row" key={candidate.transactionId} onClick={()=>link(candidate.transactionId)}>
          <span><b>{candidate.description}</b><small>{candidate.accountName} · {shortDate(candidate.date)} · {candidate.distanceInDays} dia(s) do vencimento</small></span>
          <strong>{money(candidate.amountInCents)}</strong><Link2 size={17}/>
        </button>)}</div>}
      <div className="editor-actions"><button className="secondary" onClick={()=>setMatching(undefined)}>Fechar</button></div>
    </article></div>}
  </section>
}
