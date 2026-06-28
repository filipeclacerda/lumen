import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { open, save } from "@tauri-apps/plugin-dialog";
import { CreditCard, Download, FileUp, ShieldCheck, TableProperties } from "lucide-react";
import { api } from "../../shared/api";
import { money } from "../../shared/format";
import type {
  CreditCardImportPreview,
  CsvColumnRole,
  CsvMappingDraft,
  CsvMappingProfile,
  ImportFileInspection,
  ImportPreview,
  ImportSourceKind,
  TemplateKind,
} from "../../shared/types";

type MappingState = {
  path: string;
  inspection: ImportFileInspection;
  draft: CsvMappingDraft;
  saveProfile: boolean;
  matchedProfile?: CsvMappingProfile;
};

const bankRoles: { value: CsvColumnRole; label: string }[] = [
  { value: "ignore", label: "Ignorar" },
  { value: "date", label: "Data" },
  { value: "description", label: "Descrição" },
  { value: "signed_amount", label: "Valor com sinal" },
  { value: "debit_amount", label: "Débito" },
  { value: "credit_amount", label: "Crédito" },
  { value: "external_id", label: "ID externo" },
  { value: "balance", label: "Saldo" },
];

const cardRoles: { value: CsvColumnRole; label: string }[] = [
  { value: "ignore", label: "Ignorar" },
  { value: "purchase_date", label: "Data da compra" },
  { value: "description", label: "Descrição" },
  { value: "signed_amount", label: "Valor" },
  { value: "row_kind", label: "Tipo da linha" },
  { value: "holder", label: "Portador" },
  { value: "installment", label: "Parcela" },
  { value: "due_date", label: "Vencimento" },
  { value: "external_id", label: "ID externo" },
];

export function ImportPage() {
  const client = useQueryClient();
  const [bankPreview, setBankPreview] = useState<ImportPreview>();
  const [cardPreview, setCardPreview] = useState<CreditCardImportPreview>();
  const [mappingState, setMappingState] = useState<MappingState>();
  const [mappingError, setMappingError] = useState("");
  const [pendingCardPath, setPendingCardPath] = useState("");
  const [cardAccountId, setCardAccountId] = useState("");
  const [newCardName, setNewCardName] = useState("");
  const [message, setMessage] = useState("");
  const { data: categories = [] } = useQuery({ queryKey: ["categories"], queryFn: api.categories });
  const { data: accounts = [] } = useQuery({ queryKey: ["accounts"], queryFn: api.accounts });
  const bankAccount = accounts.find((account) => account.kind !== "credit_card");
  const cards = accounts.filter((account) => account.kind === "credit_card");

  useEffect(() => {
    if (!mappingState || !bankAccount) return;
    if (!isMappingReady(mappingState.draft)) {
      setBankPreview(undefined);
      setCardPreview(undefined);
      setMappingError("");
      return;
    }
    const timer = setTimeout(async () => {
      try {
        if (mappingState.draft.sourceKind === "bank") {
          setCardPreview(undefined);
          setBankPreview(await api.previewMappedBankImport(mappingState.path, bankAccount.id, mappingState.draft));
        } else if (cardAccountId) {
          setBankPreview(undefined);
          setCardPreview(await api.previewMappedCreditCardImport(mappingState.path, cardAccountId, mappingState.draft));
        }
        setMappingError("");
      } catch (error: any) {
        setMappingError(`Prévia não disponível ainda: ${error?.message || error}`);
      }
    }, 250);
    return () => clearTimeout(timer);
  }, [mappingState, bankAccount, cardAccountId]);

  async function choose() {
    if (!("__TAURI_INTERNALS__" in window)) {
      setMessage("Abra o aplicativo desktop para selecionar arquivos locais.");
      return;
    }
    const path = await open({ multiple: false, filters: [{ name: "Extratos e faturas", extensions: ["csv", "ofx", "pdf"] }] });
    if (!path) return;
    resetFlow();
    setMessage("");
    const kind = await api.detectImportKind(path);
    if (kind === "known_credit_card") {
      setPendingCardPath(path);
      setCardAccountId(cards[0]?.id ?? "");
      return;
    }
    if (kind === "known_bank") {
      if (!bankAccount) {
        setMessage("Cadastre uma conta bancária antes de importar o extrato.");
        return;
      }
      setBankPreview(await api.previewImport(path, bankAccount.id));
      return;
    }
    const inspection = await api.inspectImportFile(path);
    const matchedProfile = inspection.matchedProfiles.length === 1 ? inspection.matchedProfiles[0] : undefined;
    const sourceKind = matchedProfile?.sourceKind ?? inspection.suggestedSourceKind ?? "bank";
    setMappingState({
      path,
      inspection,
      draft: matchedProfile ? draftFromProfile(matchedProfile) : buildInitialDraft(inspection, sourceKind),
      saveProfile: !matchedProfile,
      matchedProfile,
    });
    if (sourceKind === "credit_card" && cards[0]?.id) {
      setCardAccountId(cards[0].id);
    }
  }

  async function createCard() {
    if (newCardName.trim().length < 2) return;
    const id = await api.createCreditCardAccount(newCardName.trim());
    await client.invalidateQueries({ queryKey: ["accounts"] });
    setCardAccountId(id);
    setNewCardName("");
  }

  async function previewCard() {
    if (!pendingCardPath || !cardAccountId) return;
    setCardPreview(await api.previewCreditCardImport(pendingCardPath, cardAccountId));
    setPendingCardPath("");
  }

  async function exportTemplate(templateKind: TemplateKind) {
    if (!("__TAURI_INTERNALS__" in window)) {
      setMessage("Abra o aplicativo desktop para salvar o template em CSV.");
      return;
    }
    const suggested = templateKind === "bank" ? "template_conta_corrente.csv" : "template_cartao_credito.csv";
    const path = await save({ defaultPath: suggested, filters: [{ name: "CSV", extensions: ["csv"] }] });
    if (!path) return;
    await api.exportImportTemplate(path, templateKind);
    setMessage(`Template ${templateKind === "bank" ? "de conta corrente" : "de cartão de crédito"} salvo com sucesso.`);
  }

  async function commitBank() {
    if (!bankPreview) return;
    const count = await api.commitImport(bankPreview.sessionId);
    await maybeSaveMappingProfile();
    setMessage(`${count} transações importadas com segurança.`);
    resetFlow();
    await refresh();
  }

  async function commitCard() {
    if (!cardPreview) return;
    await api.commitCreditCardImport(cardPreview.sessionId);
    await maybeSaveMappingProfile();
    setMessage("Fatura importada. As compras já aparecem nas despesas pelas datas originais.");
    resetFlow();
    await refresh();
  }

  async function maybeSaveMappingProfile() {
    if (!mappingState?.saveProfile) return;
    try {
      await api.saveCsvMappingProfile(mappingState.draft);
    } catch (error: any) {
      setMessage(`Importação concluída, mas o layout não foi salvo: ${error?.message || error}`);
    }
  }

  async function refresh() {
    await Promise.all([
      client.invalidateQueries({ queryKey: ["transactions"] }),
      client.invalidateQueries({ queryKey: ["summary"] }),
      client.invalidateQueries({ queryKey: ["credit-card-invoices"] }),
      client.invalidateQueries({ queryKey: ["accounts"] }),
    ]);
  }

  function resetFlow() {
    setBankPreview(undefined);
    setCardPreview(undefined);
    setPendingCardPath("");
    setMappingState(undefined);
    setMappingError("");
  }

  async function changeBankCategory(sourceRow: number, categoryId: string) {
    if (!bankPreview) return;
    await api.setImportCategory(bankPreview.sessionId, sourceRow, categoryId || undefined);
    const category = categories.find((item) => item.id === categoryId);
    setBankPreview({
      ...bankPreview,
      candidates: bankPreview.candidates.map((candidate) => candidate.sourceRow === sourceRow ? {
        ...candidate,
        suggestedCategoryId: categoryId || undefined,
        suggestedCategoryName: category?.name,
        suggestedRuleId: undefined,
        suggestedRuleName: undefined,
      } : candidate),
    });
  }

  async function updateBankCandidate(sourceRow: number, amountInCents: number, included: boolean) {
    if (!bankPreview) return;
    try {
      const updated = await api.updateImportCandidate(bankPreview.sessionId, sourceRow, amountInCents, included);
      setBankPreview({
        ...bankPreview,
        candidates: bankPreview.candidates.map((candidate) => candidate.sourceRow === sourceRow ? updated : candidate),
      });
    } catch (error: any) {
      setMessage(`Erro ao atualizar lançamento: ${error?.message || error}`);
    }
  }

  async function updateCard(sourceRow: number, included: boolean, categoryId?: string, dueDate?: string) {
    if (!cardPreview) return;
    setCardPreview(await api.updateCreditCardImport(
      cardPreview.sessionId,
      sourceRow,
      included,
      categoryId,
      dueDate,
    ));
  }

  function setDraft(next: CsvMappingDraft) {
    setMappingState((current) => current ? { ...current, draft: next } : current);
  }

  return <section>
    <header><div><p className="eyebrow">IMPORTAÇÃO SEGURA</p><h1>Importar extrato ou fatura</h1>
      <p className="muted">CSV, OFX e PDF são processados somente neste computador.</p></div></header>

    {!bankPreview && !cardPreview && !pendingCardPath && !mappingState && <article className="dropzone">
      <FileUp size={42} /><h2>Selecione um arquivo financeiro</h2>
      <p>O aplicativo reconhece automaticamente extratos e o CSV de fatura de cartão. Para outros CSVs, você pode mapear as colunas e salvar o layout.</p>
      <button onClick={choose}>Escolher arquivo</button>
      <div className="editor-actions import-template-actions">
        <button className="secondary" onClick={() => exportTemplate("bank")}><Download size={15} /> Template conta</button>
        <button className="secondary" onClick={() => exportTemplate("credit_card")}><Download size={15} /> Template cartão</button>
      </div>
      <small><ShieldCheck size={15} /> Nenhum dado financeiro é enviado para a internet.</small>
    </article>}

    {pendingCardPath && <article className="panel card-import-setup">
      <div className="panel-title"><div><p className="eyebrow">FATURA DETECTADA</p><h2>Em qual cartão importar?</h2></div><CreditCard /></div>
      {cards.length > 0 && <label>Cartão
        <select value={cardAccountId} onChange={(event) => setCardAccountId(event.target.value)}>
          {cards.map((card) => <option key={card.id} value={card.id}>{card.name}</option>)}
        </select>
      </label>}
      <div className="inline-create">
        <label>Novo cartão<input value={newCardName} onChange={(event) => setNewCardName(event.target.value)} placeholder="Ex.: Sicoob Mastercard" /></label>
        <button className="secondary" onClick={createCard}>Criar cartão</button>
      </div>
      <div className="editor-actions"><button className="secondary" onClick={resetFlow}>Cancelar</button>
        <button disabled={!cardAccountId} onClick={previewCard}>Revisar fatura</button></div>
    </article>}

    {mappingState && <article className="panel import-mapping-panel">
      <div className="panel-title"><div><p className="eyebrow">CSV PERSONALIZADO</p><h2>Mapeie as colunas do arquivo</h2>
        <small>{mappingState.inspection.fileName}</small></div><TableProperties /></div>
      {mappingState.matchedProfile && <p className="notice">Layout salvo detectado: <b>{mappingState.matchedProfile.name}</b>. Você pode revisar antes de importar.</p>}
      {!bankAccount && mappingState.draft.sourceKind === "bank" && <p className="form-error">Cadastre uma conta bancária antes de revisar este extrato.</p>}
      {mappingState.draft.sourceKind === "credit_card" && cards.length === 0 && <p className="form-error">Cadastre um cartão antes de revisar esta fatura.</p>}
      <div className="rules-layout">
        <div className="rule-editor">
          <div className="form-row">
            <label>Tipo do CSV
              <select value={mappingState.draft.sourceKind} onChange={(event) => {
                const sourceKind = event.target.value as ImportSourceKind;
                setDraft(buildInitialDraft(mappingState.inspection, sourceKind, mappingState.draft));
                setMappingState((current) => current ? { ...current, matchedProfile: undefined, saveProfile: true } : current);
              }}>
                <option value="bank">Conta bancária</option>
                <option value="credit_card">Cartão de crédito</option>
              </select>
            </label>
            <label>Delimitador
              <select value={mappingState.draft.delimiter} onChange={(event) => setDraft({ ...mappingState.draft, delimiter: event.target.value })}>
                <option value=";">Ponto e vírgula (;)</option>
                <option value=",">Vírgula (,)</option>
              </select>
            </label>
          </div>
          <div className="form-row">
            <label>Formato de data
              <select value={mappingState.draft.dateFormat ?? ""} onChange={(event) => setDraft({ ...mappingState.draft, dateFormat: event.target.value || undefined })}>
                <option value="">Automático</option>
                <option value="dd/MM/yyyy">dd/MM/yyyy</option>
                <option value="yyyy-MM-dd">yyyy-MM-dd</option>
                <option value="dd/MM/yy">dd/MM/yy</option>
              </select>
            </label>
            <label>Separador decimal
              <select value={mappingState.draft.decimalSeparator ?? "comma"} onChange={(event) => setDraft({ ...mappingState.draft, decimalSeparator: event.target.value as "comma" | "dot" })}>
                <option value="comma">Vírgula decimal</option>
                <option value="dot">Ponto decimal</option>
              </select>
            </label>
          </div>
          {mappingState.draft.sourceKind === "credit_card" && <>
            {cards.length > 0 && <label>Cartão de destino
              <select value={cardAccountId} onChange={(event) => setCardAccountId(event.target.value)}>
                {cards.map((card) => <option key={card.id} value={card.id}>{card.name}</option>)}
              </select>
            </label>}
            <label>Vencimento padrão da fatura
              <input type="date" value={mappingState.draft.defaultDueDate ?? ""} onChange={(event) => setDraft({ ...mappingState.draft, defaultDueDate: event.target.value || undefined })} />
            </label>
          </>}
          <label className="check-label"><input
            type="checkbox"
            checked={mappingState.saveProfile}
            onChange={(event) => setMappingState((current) => current ? { ...current, saveProfile: event.target.checked } : current)}
          />Salvar este layout para próximas importações</label>
          {mappingState.saveProfile && <label>Nome do layout
            <input value={mappingState.draft.profileName ?? ""} onChange={(event) => setDraft({ ...mappingState.draft, profileName: event.target.value })} placeholder="Ex.: CSV Nubank crédito" />
          </label>}
          <div className="impact">
            <b>Colunas encontradas</b>
            {mappingState.draft.columns.map((column, index) => <div key={`${column.header}-${index}`} className="mapping-row">
              <span><b>{column.header}</b><small>{sampleValue(mappingState.inspection, column.index)}</small></span>
              <select value={column.role} onChange={(event) => setDraft({
                ...mappingState.draft,
                columns: mappingState.draft.columns.map((item, itemIndex) =>
                  itemIndex === index ? { ...item, role: event.target.value as CsvColumnRole } : item,
                ),
              })}>
                {roleOptions(mappingState.draft.sourceKind).map((role) => <option key={role.value} value={role.value}>{role.label}</option>)}
              </select>
            </div>)}
          </div>
          <div className="editor-actions">
            <button className="secondary" onClick={resetFlow}>Cancelar</button>
            {mappingState.matchedProfile && <button className="secondary" onClick={() => setDraft(draftFromProfile(mappingState.matchedProfile!))}>Reaplicar layout salvo</button>}
          </div>
        </div>

        <article className="panel mapping-sample-panel">
          <div className="panel-title"><div><h2>Amostra do arquivo</h2><small>Use esta grade para conferir se o mapeamento faz sentido.</small></div></div>
          <div className="table-scroll"><table><thead><tr>{mappingState.inspection.headers.map((header) => <th key={header}>{header}</th>)}</tr></thead>
            <tbody>{mappingState.inspection.sampleRows.map((row, index) => <tr key={`row-${index}`}>
              {mappingState.inspection.headers.map((_, cellIndex) => <td key={`${index}-${cellIndex}`}>{row[cellIndex] || "—"}</td>)}
            </tr>)}</tbody></table></div>
          {mappingError && <p className="form-error">{mappingError}</p>}
        </article>
      </div>
    </article>}

    {bankPreview && <article className="panel"><div className="panel-title"><h2>Prévia de {bankPreview.fileName}</h2><span>{bankPreview.candidates.length} registros</span></div>
      <table><thead><tr><th>Incluir</th><th>Data</th><th>Descrição</th><th>Categoria sugerida</th><th>Valor editável</th><th>Duplicidade</th></tr></thead>
        <tbody>{bankPreview.candidates.slice(0, 100).map((candidate) => <tr key={candidate.sourceRow} className={!candidate.included ? "excluded-row" : ""}>
          <td><input type="checkbox" checked={candidate.included} disabled={candidate.duplicateStatus === "exact"}
            onChange={(event) => updateBankCandidate(candidate.sourceRow, candidate.amountInCents, event.target.checked)} /></td>
          <td>{candidate.date}</td>
          <td>{candidate.description}{candidate.suggestedRuleName && <small className="source-label">por {candidate.suggestedRuleName}</small>}</td>
          <td><CategorySelect value={candidate.suggestedCategoryId} categories={categories} onChange={(value) => changeBankCategory(candidate.sourceRow, value)} /></td>
          <td><MoneyEditor value={candidate.amountInCents} disabled={!candidate.included}
            onCommit={(value) => updateBankCandidate(candidate.sourceRow, value, candidate.included)} /></td>
          <td><span className="badge">{candidate.duplicateStatus}</span></td></tr>)}</tbody></table>
      <div className="editor-actions"><button className="secondary" onClick={resetFlow}>Cancelar</button><button onClick={commitBank}>Confirmar importação</button></div></article>}

    {cardPreview && <article className="panel">
      <div className="panel-title"><div><p className="eyebrow">FATURA DE CARTÃO</p><h2>{cardPreview.fileName}</h2></div>
        <label className="compact-label">Vencimento<input type="date" value={cardPreview.dueDate}
          onChange={(event) => updateCard(cardPreview.items[0].candidate.sourceRow, cardPreview.items[0].included, cardPreview.items[0].candidate.suggestedCategoryId, event.target.value)} /></label></div>
      <div className="invoice-totals">
        <div><span>Compras</span><strong>{money(cardPreview.purchasesInCents)}</strong></div>
        <div><span>Créditos e pagamentos</span><strong>{money(cardPreview.creditsInCents)}</strong></div>
        <div className="invoice-total"><span>Saldo da fatura</span><strong>{money(cardPreview.totalInCents)}</strong></div>
      </div>
      <div className="table-scroll"><table><thead><tr><th>Incluir</th><th>Data</th><th>Estabelecimento</th><th>Portador</th><th>Parcela</th><th>Categoria</th><th>Valor</th></tr></thead>
        <tbody>{cardPreview.items.map((item) => <tr key={item.candidate.sourceRow} className={!item.included ? "excluded-row" : ""}>
          <td><input type="checkbox" checked={item.included} disabled={item.candidate.duplicateStatus === "exact"}
            onChange={(event) => updateCard(item.candidate.sourceRow, event.target.checked, item.candidate.suggestedCategoryId)} /></td>
          <td>{item.candidate.date}</td><td>{item.candidate.description}{item.isPayment && <small className="source-label">transferência</small>}</td>
          <td>{item.holder ?? "—"}</td><td>{item.installment ?? "—"}</td>
          <td><CategorySelect value={item.candidate.suggestedCategoryId} categories={categories}
            onChange={(value) => updateCard(item.candidate.sourceRow, item.included, value)} /></td>
          <td className={item.candidate.amountInCents > 0 ? "positive amount" : "amount"}>{money(item.candidate.amountInCents)}</td>
        </tr>)}</tbody></table></div>
      <div className="editor-actions"><button className="secondary" onClick={resetFlow}>Cancelar</button>
        <button onClick={commitCard}>Confirmar fatura</button></div>
    </article>}
    {message && <p className="notice">{message}</p>}
  </section>;
}

function buildInitialDraft(inspection: ImportFileInspection, sourceKind: ImportSourceKind, previous?: CsvMappingDraft): CsvMappingDraft {
  return {
    sourceKind,
    delimiter: inspection.delimiter ?? previous?.delimiter ?? ";",
    dateFormat: previous?.dateFormat,
    decimalSeparator: previous?.decimalSeparator ?? "comma",
    defaultDueDate: previous?.defaultDueDate,
    profileName: previous?.profileName,
    columns: inspection.headers.map((header, index) => ({
      index,
      header,
      role: guessRole(header, sourceKind),
    })),
  };
}

function draftFromProfile(profile: CsvMappingProfile): CsvMappingDraft {
  return {
    sourceKind: profile.sourceKind,
    delimiter: profile.delimiter,
    dateFormat: profile.dateFormat,
    decimalSeparator: profile.decimalSeparator,
    profileName: profile.name,
    columns: profile.columns,
  };
}

function guessRole(header: string, sourceKind: ImportSourceKind): CsvColumnRole {
  const normalized = header.trim().toLowerCase();
  if (sourceKind === "bank") {
    if (normalized.includes("data") || normalized === "date") return "date";
    if (normalized.includes("descr") || normalized.includes("hist") || normalized.includes("memo")) return "description";
    if (normalized.includes("deb")) return "debit_amount";
    if (normalized.includes("cred")) return "credit_amount";
    if (normalized.includes("valor") || normalized.includes("amount")) return "signed_amount";
    if (normalized.includes("id") || normalized.includes("fitid") || normalized.includes("doc")) return "external_id";
    if (normalized.includes("saldo")) return "balance";
    return "ignore";
  }
  if (normalized.includes("data")) return "purchase_date";
  if (normalized.includes("estabele") || normalized.includes("descr") || normalized.includes("hist") || normalized.includes("memo")) return "description";
  if (normalized.includes("valor") || normalized.includes("amount")) return "signed_amount";
  if (normalized.includes("portador") || normalized.includes("holder")) return "holder";
  if (normalized.includes("parcela") || normalized.includes("install")) return "installment";
  if (normalized.includes("tipo") || normalized.includes("kind")) return "row_kind";
  if (normalized.includes("venc")) return "due_date";
  if (normalized.includes("id")) return "external_id";
  return "ignore";
}

function roleOptions(sourceKind: ImportSourceKind) {
  return sourceKind === "bank" ? bankRoles : cardRoles;
}

function isMappingReady(draft: CsvMappingDraft) {
  const has = (role: CsvColumnRole) => draft.columns.some((column) => column.role === role);
  if (draft.sourceKind === "bank") {
    return has("date") && has("description") && (has("signed_amount") || has("debit_amount") || has("credit_amount"));
  }
  return (has("purchase_date") || has("date")) && has("description") && has("signed_amount")
    && (has("due_date") || Boolean(draft.defaultDueDate));
}

function sampleValue(inspection: ImportFileInspection, columnIndex: number) {
  return inspection.sampleRows.find((row) => row[columnIndex])?.[columnIndex] || "Sem exemplo";
}

function CategorySelect({ value, categories, onChange }: {
  value?: string; categories: Awaited<ReturnType<typeof api.categories>>; onChange: (value: string) => void
}) {
  return <select className="category-select" value={value ?? ""} onChange={(event) => onChange(event.target.value)}>
    <option value="">Sem categoria</option>
    {categories.map((category) => <option key={category.id} value={category.id}>{category.parentId ? "↳ " : ""}{category.name}</option>)}
  </select>;
}

function MoneyEditor({ value, disabled, onCommit }: { value: number; disabled?: boolean; onCommit: (value: number) => void }) {
  const [text, setText] = useState((value / 100).toFixed(2).replace(".", ","));
  function commit() {
    const normalized = text.trim().replace(/\./g, "").replace(",", ".");
    const parsed = Number(normalized);
    if (!Number.isFinite(parsed) || parsed === 0) {
      setText((value / 100).toFixed(2).replace(".", ","));
      return;
    }
    const cents = Math.round(parsed * 100);
    setText((cents / 100).toFixed(2).replace(".", ","));
    if (cents !== value) onCommit(cents);
  }
  return <div className="editable-money"><span>R$</span><input aria-label="Valor da transação" value={text} disabled={disabled}
    onChange={(event) => setText(event.target.value)} onBlur={commit} onKeyDown={(event) => { if (event.key === "Enter") event.currentTarget.blur(); }} /></div>;
}
