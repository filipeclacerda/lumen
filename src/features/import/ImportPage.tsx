import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { open, save } from "@tauri-apps/plugin-dialog";
import { Check, CheckCircle2, Circle, CreditCard, Download, FileText, FileUp, ListChecks, Plus, ShieldCheck, TableProperties, X } from "lucide-react";
import { api } from "../../shared/api";
import { Modal } from "../../shared/ui/Modal";
import { money, centsToInput, parseMoneyToCents, maskCurrency } from "../../shared/format";
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
  { value: "date", label: "Data" },
  { value: "signed_amount", label: "Valor" },
  { value: "description", label: "Descrição" },
  { value: "ignore", label: "Ignorar" },
  { value: "debit_amount", label: "Débito" },
  { value: "credit_amount", label: "Crédito" },
  { value: "external_id", label: "ID externo" },
  { value: "balance", label: "Saldo" },
];

const cardRoles: { value: CsvColumnRole; label: string }[] = [
  { value: "purchase_date", label: "Data da compra" },
  { value: "signed_amount", label: "Valor" },
  { value: "description", label: "Descrição" },
  { value: "ignore", label: "Ignorar" },
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
  const [learning, setLearning] = useState<{sourceRow: number; categoryId: string; pattern: string; amountInCents: number; kind: 'bank'|'card'}>();
  const [mappingState, setMappingState] = useState<MappingState>();
  const [mappingError, setMappingError] = useState("");
  const [pendingCardPath, setPendingCardPath] = useState("");
  const [cardAccountId, setCardAccountId] = useState("");
  const [newCardName, setNewCardName] = useState("");
  const [creatingCard, setCreatingCard] = useState(false);
  const [cardDueDate, setCardDueDate] = useState("");

  useEffect(() => {
    if (pendingCardPath) {
      const match = pendingCardPath.match(/\d{4}-\d{2}-\d{2}/);
      if (match) setCardDueDate(match[0]);
    }
  }, [pendingCardPath]);

  const [message, setMessage] = useState("");
  const [showTroubleMenu, setShowTroubleMenu] = useState(false);
  const [openUpwards, setOpenUpwards] = useState(false);
  const troubleMenuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (showTroubleMenu && troubleMenuRef.current) {
      const rect = troubleMenuRef.current.getBoundingClientRect();
      setOpenUpwards(rect.bottom > window.innerHeight - 20);
    } else {
      setOpenUpwards(false);
    }
  }, [showTroubleMenu]);

  const { data: categories = [] } = useQuery({ queryKey: ["categories"], queryFn: api.categories });
  const { data: accounts = [] } = useQuery({ queryKey: ["accounts"], queryFn: api.accounts });
  const bankAccount = accounts.find((account) => account.kind !== "credit_card");
  const cards = accounts.filter((account) => account.kind === "credit_card");

  // Keep the selected card valid: a <select> with a value that matches no
  // option shows the first option visually but leaves cardAccountId empty.
  // Default to the first card so the pre-filled selection counts as chosen.
  useEffect(() => {
    const cardList = accounts.filter((account) => account.kind === "credit_card");
    if (cardList.length === 0) return;
    if (!cardList.some((card) => card.id === cardAccountId)) {
      setCardAccountId(cardList[0].id);
    }
  }, [accounts, cardAccountId]);

  useEffect(() => {
    if (!mappingState) return;
    const draft = mappingState.draft;
    // A bank import needs a bank account; a card import needs a destination card.
    const accountReady = draft.sourceKind === "bank" ? Boolean(bankAccount) : Boolean(cardAccountId);
    if (!isMappingReady(draft) || !accountReady) {
      setBankPreview(undefined);
      setCardPreview(undefined);
      setMappingError("");
      return;
    }
    const timer = setTimeout(async () => {
      try {
        if (draft.sourceKind === "bank" && bankAccount) {
          setCardPreview(undefined);
          setBankPreview(await api.previewMappedBankImport(mappingState.path, bankAccount.id, draft));
        } else if (draft.sourceKind === "credit_card" && cardAccountId) {
          setBankPreview(undefined);
          setCardPreview(await api.previewMappedCreditCardImport(mappingState.path, cardAccountId, draft));
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
    const name = newCardName.trim();
    if (name.length < 2) return;
    try {
      const id = await api.createCreditCardAccount(name);
      await client.invalidateQueries({ queryKey: ["accounts"] });
      setCardAccountId(id);
      setNewCardName("");
      setCreatingCard(false);
    } catch (error: any) {
      setMessage(`Não foi possível cadastrar o cartão: ${error?.message || error}`);
    }
  }

  async function previewCard() {
    if (!pendingCardPath || !cardAccountId) return;
    setCardPreview(await api.previewCreditCardImport(pendingCardPath, cardAccountId, cardDueDate || undefined));
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
    const candidate = bankPreview.candidates.find((c) => c.sourceRow === sourceRow);
    const oldCategoryId = candidate?.suggestedCategoryId;
    await api.setImportCategory(bankPreview.sessionId, sourceRow, categoryId || undefined);
    const category = categories.find((item) => item.id === categoryId);
    
    if (categoryId && oldCategoryId !== categoryId && candidate) {
      setLearning({
        sourceRow, categoryId, pattern: candidate.description, amountInCents: candidate.amountInCents, kind: 'bank'
      });
    }

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
    
    const item = cardPreview.items.find(i => i.candidate.sourceRow === sourceRow);
    const oldCategoryId = item?.candidate.suggestedCategoryId;

    setCardPreview(await api.updateCreditCardImport(
      cardPreview.sessionId,
      sourceRow,
      included,
      categoryId,
      dueDate,
    ));

    if (categoryId && oldCategoryId !== categoryId && item) {
      setLearning({
        sourceRow, categoryId, pattern: item.candidate.description, amountInCents: item.candidate.amountInCents, kind: 'card'
      });
    }
  }

  async function createRule() {
    if (!learning) return;
    const selectedCategory = categories.find((c) => c.id === learning.categoryId);
    await api.saveRule({
      name: `Reconhecer ${learning.pattern}`,
      priority: 100,
      enabled: true,
      operator: "contains",
      pattern: learning.pattern,
      movementType: selectedCategory?.kind === "transfer" ? "transfer" : learning.amountInCents >= 0 ? "income" : "expense",
      categoryId: learning.categoryId,
    });
    
    const p = learning.pattern.toLowerCase();

    if (learning.kind === 'bank' && bankPreview) {
      const updates = bankPreview.candidates.filter(c => c.description.toLowerCase().includes(p) && c.suggestedCategoryId !== learning.categoryId);
      for (const u of updates) {
        await api.setImportCategory(bankPreview.sessionId, u.sourceRow, learning.categoryId);
      }
      setBankPreview({
        ...bankPreview,
        candidates: bankPreview.candidates.map(c => 
          c.description.toLowerCase().includes(p) ? { ...c, suggestedCategoryId: learning.categoryId, suggestedCategoryName: selectedCategory?.name } : c
        )
      });
    }

    if (learning.kind === 'card' && cardPreview) {
      let currentPreview = cardPreview;
      const updates = cardPreview.items.filter(i => i.candidate.description.toLowerCase().includes(p) && i.candidate.suggestedCategoryId !== learning.categoryId);
      for (const u of updates) {
        currentPreview = await api.updateCreditCardImport(cardPreview.sessionId, u.candidate.sourceRow, u.included, learning.categoryId, undefined);
      }
      setCardPreview(currentPreview);
    }

    setLearning(undefined);
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
      <div style={{ position: "relative", display: "inline-block", margin: "0 auto 22px" }}>
        <button className="text-button" onClick={() => setShowTroubleMenu(!showTroubleMenu)}>Enfrentando problemas?</button>
        {showTroubleMenu && <div ref={troubleMenuRef} style={{ position: "absolute", top: openUpwards ? "auto" : "calc(100% + 8px)", bottom: openUpwards ? "calc(100% + 8px)" : "auto", left: "50%", transform: "translateX(-50%)", background: "var(--surface)", border: "1px solid var(--border-strong)", padding: "14px", borderRadius: "14px", boxShadow: "var(--shadow-md)", display: "flex", flexDirection: "column", zIndex: 10, minWidth: "240px", animation: openUpwards ? "slideUp 0.2s ease-out" : "slideDown 0.2s ease-out" }}>
          <button className="icon-button" style={{ position: "absolute", top: "4px", right: "4px", background: "transparent", margin: 0 }} onClick={() => setShowTroubleMenu(false)}><X size={14} /></button>
          <p style={{ margin: "6px 20px 12px 0", fontSize: "12px", color: "var(--text-muted)", textAlign: "left", lineHeight: 1.4, fontWeight: 500 }}>Baixe nossos templates vazios em CSV e preencha com seus dados de onde estiver.</p>
          <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
            <button className="secondary" style={{ justifyContent: "flex-start", width: "100%", padding: "10px 14px", borderRadius: "9px", margin: 0 }} onClick={() => { setShowTroubleMenu(false); exportTemplate("bank"); }}><Download size={15} /> Template de conta</button>
            <button className="secondary" style={{ justifyContent: "flex-start", width: "100%", padding: "10px 14px", borderRadius: "9px", margin: 0 }} onClick={() => { setShowTroubleMenu(false); exportTemplate("credit_card"); }}><Download size={15} /> Template de cartão</button>
          </div>
        </div>}
      </div>
      <small><ShieldCheck size={15} /> Nenhum dado financeiro é enviado para a internet.</small>
    </article>}

    {pendingCardPath && (
      <article className="panel card-import-setup">
        <div className="panel-title">
          <div>
            <p className="eyebrow">FATURA DETECTADA</p>
            <h2>Em qual cartão importar?</h2>
          </div>
          <div className="metric-icon blue"><CreditCard /></div>
        </div>
        <div className="file-banner">
          <FileText size={16} />
          <span>{pendingCardPath.split(/[\\/]/).pop()}</span>
        </div>
        <div className="card-import-form">
        <CardPicker label="Cartão" required cards={cards} value={cardAccountId} onChange={setCardAccountId} onCreate={() => setCreatingCard(true)} />
      <label>Vencimento da fatura (caso não conste no arquivo)
        <input type="date" value={cardDueDate} onChange={(e) => setCardDueDate(e.target.value)} />
      </label>
        <div className="editor-actions">
          <button className="secondary" onClick={resetFlow}>Cancelar</button>
          <button disabled={!cardAccountId} onClick={previewCard}>Revisar fatura</button>
        </div>
      </div>
    </article>
    )}

    {mappingState && <article className="panel import-mapping-panel">
      <div className="panel-title"><div><p className="eyebrow">CSV PERSONALIZADO</p><h2>Mapeie as colunas do arquivo</h2>
        <small>{mappingState.inspection.fileName}</small></div><TableProperties /></div>
      <p className="muted import-flow-hint">Confira o tipo do arquivo, indique o que cada coluna representa e escolha o destino. Assim que todos os passos abaixo estiverem completos, a prévia aparece embaixo para você revisar antes de confirmar.</p>
      {mappingState.matchedProfile && <p className="notice">Layout salvo detectado: <b>{mappingState.matchedProfile.name}</b>. Você pode revisar antes de importar.</p>}
      <MappingChecklist draft={mappingState.draft} hasBankAccount={Boolean(bankAccount)} hasCard={Boolean(cardAccountId)} />
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
          {mappingState.draft.sourceKind === "credit_card" && <div className="form-row form-row-top">
            <CardPicker label="Cartão de destino" required cards={cards} value={cardAccountId} onChange={setCardAccountId} onCreate={() => setCreatingCard(true)} />
            <label><span>Vencimento padrão da fatura <span className="req">*</span></span>
              <input type="date" value={mappingState.draft.defaultDueDate ?? ""} onChange={(event) => setDraft({ ...mappingState.draft, defaultDueDate: event.target.value || undefined })} />
            </label>
          </div>}
          <label className="check-label"><input
            type="checkbox"
            checked={mappingState.saveProfile}
            onChange={(event) => setMappingState((current) => current ? { ...current, saveProfile: event.target.checked } : current)}
          />Salvar este layout para próximas importações</label>
          {mappingState.saveProfile && <label><span>Nome do layout <span className="req">*</span></span>
            <input value={mappingState.draft.profileName ?? ""} onChange={(event) => setDraft({ ...mappingState.draft, profileName: event.target.value })} placeholder="Ex.: CSV Nubank crédito" />
          </label>}
          <div className="impact">
            <b>Colunas encontradas</b>
            <small className="impact-hint">{mappingState.draft.sourceKind === "credit_card"
              ? "Atribua, no mínimo, data da compra, descrição e valor."
              : "Atribua, no mínimo, data, descrição e valor."}</small>
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
          <p className="req-legend"><span className="req">*</span> Campos obrigatórios para liberar a prévia.</p>
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
    
    {learning&&<div className="modal-backdrop"><article className="modal"><h2>Usar esta correção no futuro?</h2><p className="muted">Você pode criar uma regra local ou manter a alteração somente nesta importação.</p>
      <label>Descrição contém<input value={learning.pattern} onChange={e=>setLearning({...learning,pattern:e.target.value})}/></label>
      <div className="editor-actions"><button className="secondary" onClick={()=>setLearning(undefined)}>Somente nesta importação</button><button onClick={createRule}>Criar regra</button></div>
    </article></div>}

    {creatingCard && (
      <Modal title="Novo cartão" onClose={() => setCreatingCard(false)}>
        <p className="muted">Cadastre um cartão de crédito para vincular a esta fatura.</p>
        <div className="modal-form">
          <label>Nome do cartão
            <input
              value={newCardName}
              onChange={e => setNewCardName(e.target.value)}
              placeholder="Ex.: Itaú Mastercard"
              onKeyDown={e => e.key === "Enter" && createCard()}
            />
          </label>
        </div>
        <div className="editor-actions" style={{ marginTop: "24px" }}>
          <button className="secondary" onClick={() => setCreatingCard(false)}>Cancelar</button>
          <button disabled={newCardName.trim().length < 2} onClick={createCard}>Salvar cartão</button>
        </div>
      </Modal>
    )}
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

type ChecklistItem = { label: string; done: boolean };

function mappingChecklist(draft: CsvMappingDraft, hasBankAccount: boolean, hasCard: boolean): ChecklistItem[] {
  const has = (role: CsvColumnRole) => draft.columns.some((column) => column.role === role);
  if (draft.sourceKind === "bank") {
    return [
      { label: "Mapear a coluna de data", done: has("date") },
      { label: "Mapear a coluna de descrição", done: has("description") },
      { label: "Mapear a coluna de valor (com sinal, débito ou crédito)", done: has("signed_amount") || has("debit_amount") || has("credit_amount") },
      { label: "Ter uma conta bancária cadastrada", done: hasBankAccount },
    ];
  }
  return [
    { label: "Mapear a coluna de data da compra", done: has("purchase_date") || has("date") },
    { label: "Mapear a coluna de descrição (estabelecimento)", done: has("description") },
    { label: "Mapear a coluna de valor", done: has("signed_amount") },
    { label: "Selecionar o cartão de destino", done: hasCard },
    { label: "Definir o vencimento da fatura", done: has("due_date") || Boolean(draft.defaultDueDate) },
  ];
}

function MappingChecklist({ draft, hasBankAccount, hasCard }: {
  draft: CsvMappingDraft; hasBankAccount: boolean; hasCard: boolean;
}) {
  const items = mappingChecklist(draft, hasBankAccount, hasCard);
  const pending = items.filter((item) => !item.done).length;
  const ready = pending === 0;
  return <div className={`mapping-checklist${ready ? " ready" : ""}`}>
    <div className="mapping-checklist-head">
      {ready
        ? <><CheckCircle2 size={16} /> Tudo pronto! Confira a prévia da fatura logo abaixo.</>
        : <><ListChecks size={16} /> Faltam {pending} {pending === 1 ? "passo" : "passos"} para liberar a prévia:</>}
    </div>
    <ul>
      {items.map((item, index) => <li key={index} className={item.done ? "done" : "pending"}>
        {item.done ? <Check size={14} /> : <Circle size={14} />}
        <span>{item.label}</span>
      </li>)}
    </ul>
  </div>;
}

function CardPicker({ label, cards, value, onChange, onCreate, required }: {
  label: string;
  cards: { id: string; name: string }[];
  value: string;
  onChange: (id: string) => void;
  onCreate: () => void;
  required?: boolean;
}) {
  const empty = cards.length === 0;
  return <div className="card-picker">
    <span className="card-picker-label">{label}{required && <span className="req"> *</span>}</span>
    <div className="card-picker-row">
      <select value={value} onChange={(event) => onChange(event.target.value)} disabled={empty} aria-label={label}>
        {empty
          ? <option value="">Nenhum cartão cadastrado</option>
          : cards.map((card) => <option key={card.id} value={card.id}>{card.name}</option>)}
      </select>
      <button type="button" className="icon-button card-picker-add" onClick={onCreate} title="Cadastrar novo cartão" aria-label="Cadastrar novo cartão">
        <Plus size={18} />
      </button>
    </div>
    {empty && <small className="card-picker-hint">Você ainda não tem cartões. Toque em <b>+</b> para cadastrar o primeiro.</small>}
  </div>;
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
  const [text, setText] = useState(centsToInput(value));
  function commit() {
    const cents = parseMoneyToCents(text);
    if (cents === null || cents === 0) {
      setText(centsToInput(value));
      return;
    }
    setText(centsToInput(cents));
    if (cents !== value) onCommit(cents);
  }
  return <div className="editable-money"><span>R$</span><input inputMode="decimal" aria-label="Valor da transação" value={text} disabled={disabled}
    onChange={(event) => setText(maskCurrency(event.target.value))} onBlur={commit} onKeyDown={(event) => { if (event.key === "Enter") event.currentTarget.blur(); }} /></div>;
}
