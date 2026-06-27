import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { open } from "@tauri-apps/plugin-dialog";
import { FileUp, ShieldCheck } from "lucide-react";
import { api } from "../../shared/api";
import type { ImportPreview } from "../../shared/types";
export function ImportPage() {
  const [preview, setPreview] = useState<ImportPreview>();
  const [message, setMessage] = useState("");
  const { data: categories = [] } = useQuery({queryKey:["categories"],queryFn:api.categories});
  async function choose() {
    if (!("__TAURI_INTERNALS__" in window)) { setMessage("Abra o aplicativo desktop para selecionar arquivos locais."); return; }
    const path = await open({ multiple: false, filters: [{ name: "Extratos", extensions: ["csv", "ofx", "pdf"] }] });
    if (path) setPreview(await api.previewImport(path, "default-account"));
  }
  async function commit() {
    if (!preview) return;
    try {
      const count = await api.commitImport(preview.sessionId);
      setMessage(`${count} transações importadas com segurança.`);
      setPreview(undefined);
    } catch (e: any) {
      setMessage(`Erro ao importar: ${e}`);
    }
  }
  async function changeCategory(sourceRow:number, categoryId:string) {
    if(!preview)return;
    try {
      await api.setImportCategory(preview.sessionId,sourceRow,categoryId||undefined);
      const category=categories.find(c=>c.id===categoryId);
      setPreview({...preview,candidates:preview.candidates.map(c=>c.sourceRow===sourceRow?{
        ...c,suggestedCategoryId:categoryId||undefined,suggestedCategoryName:category?.name,
        suggestedRuleId:undefined,suggestedRuleName:undefined
      }:c)});
    } catch (e: any) {
      setMessage(`Erro ao definir categoria: ${e.message || e}`);
    }
  }
  return <section><header><div><p className="eyebrow">IMPORTAÇÃO SEGURA</p><h1>Importar extrato</h1><p className="muted">CSV e OFX são processados somente neste computador.</p></div></header>
    {!preview && <article className="dropzone"><FileUp size={42}/><h2>Selecione um arquivo bancário</h2><p>Use o seletor protegido para escolher um CSV, OFX ou extrato PDF textual do Sicoob.</p><button onClick={choose}>Escolher arquivo</button><small><ShieldCheck size={15}/> Nenhum dado financeiro é enviado para a internet.</small></article>}
    {preview && <article className="panel"><div className="panel-title"><h2>Prévia de {preview.fileName}</h2><span>{preview.candidates.length} registros</span></div>
      <table><thead><tr><th>Data</th><th>Descrição</th><th>Categoria sugerida</th><th>Valor</th><th>Duplicidade</th></tr></thead>
      <tbody>{preview.candidates.slice(0,100).map(c=><tr key={c.sourceRow}><td>{c.date}</td><td>{c.description}{c.suggestedRuleName&&<small className="source-label">por {c.suggestedRuleName}</small>}</td>
        <td><select className="category-select" value={c.suggestedCategoryId??""} onChange={e=>changeCategory(c.sourceRow,e.target.value)}><option value="">Sem categoria</option>
          {categories.map(category=><option key={category.id} value={category.id}>{category.parentId?"↳ ":""}{category.name}</option>)}</select></td>
        <td>{(c.amountInCents/100).toLocaleString("pt-BR",{style:"currency",currency:"BRL"})}</td><td><span className="badge">{c.duplicateStatus}</span></td></tr>)}</tbody></table>
      <button onClick={commit}>Confirmar importação</button></article>}
    {message && <p className="notice">{message}</p>}
  </section>
}
