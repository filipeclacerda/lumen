import { PageHeader } from "../../shared/ui/PageHeader";
import { type DragEvent, useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { open, save } from "@tauri-apps/plugin-dialog";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import {
  ArrowLeftRight,
  Check,
  CheckCircle2,
  Circle,
  CreditCard,
  Download,
  FileText,
  FileUp,
  ListChecks,
  Plus,
  ShieldCheck,
  TableProperties,
  X,
} from "lucide-react";
import { api } from "../../shared/api";
import { Modal } from "../../shared/ui/Modal";
import { CategorySelect } from "../../shared/ui/CategorySelect";
import { ErrorState, LoadingState } from "../../shared/ui/AsyncState";
import { Select } from "../../shared/ui/Select";
import {
  money,
  centsToInput,
  parseMoneyToCents,
  maskCurrency,
  normalizeText,
  suggestRulePattern,
} from "../../shared/format";
import type {
  CreditCardImportPreview,
  CsvColumnRole,
  CsvMappingDraft,
  CsvMappingProfile,
  ImportFileInspection,
  ImportPreview,
  ImportSourceKind,
  TemplateKind,
  TransferCandidate,
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
  const [searchParams, setSearchParams] = useSearchParams();
  const client = useQueryClient();
  const [bankPreview, setBankPreview] = useState<ImportPreview>();
  const [cardPreview, setCardPreview] = useState<CreditCardImportPreview>();
  const [learning, setLearning] = useState<{
    sourceRow: number;
    categoryId: string;
    pattern: string;
    amountInCents: number;
    kind: "bank" | "card";
  }>();
  const [mappingState, setMappingState] = useState<MappingState>();
  const [mappingError, setMappingError] = useState("");
  const [pendingCardPath, setPendingCardPath] = useState("");
  const [cardAccountId, setCardAccountId] = useState("");
  const [newCardName, setNewCardName] = useState("");
  const [creatingCard, setCreatingCard] = useState(false);
  const [cardDueDate, setCardDueDate] = useState("");
  const [isDraggingFile, setIsDraggingFile] = useState(false);
  const [isReadingFile, setIsReadingFile] = useState(false);
  const [transferCandidates, setTransferCandidates] = useState<TransferCandidate[]>([]);
  const [linkingTransfer, setLinkingTransfer] = useState<string>();

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
  const troubleMenuTriggerRef = useRef<HTMLButtonElement>(null);
  const chooseFileRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (searchParams.get("action") !== "choose") return;
    requestAnimationFrame(() => chooseFileRef.current?.focus());
    setSearchParams(
      (params) => {
        const next = new URLSearchParams(params);
        next.delete("action");
        return next;
      },
      { replace: true },
    );
  }, [searchParams, setSearchParams]);

  function closeTroubleMenu(returnFocus = false) {
    setShowTroubleMenu(false);
    if (returnFocus) requestAnimationFrame(() => troubleMenuTriggerRef.current?.focus());
  }

  useEffect(() => {
    if (showTroubleMenu && troubleMenuRef.current) {
      const rect = troubleMenuRef.current.getBoundingClientRect();
      setOpenUpwards(rect.bottom > window.innerHeight - 20);
      troubleMenuRef.current.querySelector<HTMLElement>("[data-initial-focus]")?.focus();
    } else {
      setOpenUpwards(false);
    }
  }, [showTroubleMenu]);

  useEffect(() => {
    if (!showTroubleMenu) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        closeTroubleMenu(true);
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [showTroubleMenu]);

  const {
    data: categories = [],
    isLoading: categoriesLoading,
    isError: categoriesError,
    refetch: refetchCategories,
  } = useQuery({ queryKey: ["categories"], queryFn: api.categories });
  const {
    data: accounts = [],
    isLoading: accountsLoading,
    isError: accountsError,
    refetch: refetchAccounts,
  } = useQuery({ queryKey: ["accounts"], queryFn: api.accounts });
  const asyncLoading = categoriesLoading || accountsLoading;
  const asyncError = categoriesError || accountsError;
  const bankAccount = accounts.find((account) => account.kind !== "credit_card");
  const cards = accounts.filter((account) => account.kind === "credit_card");
  const bankAccountId = bankAccount?.id;
  const firstCardId = cards[0]?.id ?? "";
  const canStartImport = !bankPreview && !cardPreview && !pendingCardPath && !mappingState;

  // Keep the selected card valid: a custom select with a value that matches no
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

  const resetFlow = useCallback(() => {
    setBankPreview(undefined);
    setCardPreview(undefined);
    setPendingCardPath("");
    setMappingState(undefined);
    setMappingError("");
  }, []);

  const processImportPath = useCallback(
    async (path: string) => {
      if (!path || isReadingFile) return;
      setIsReadingFile(true);
      setIsDraggingFile(false);
      resetFlow();
      setMessage("");
      try {
        const kind = await api.detectImportKind(path);
        if (kind === "known_credit_card") {
          setPendingCardPath(path);
          setCardAccountId(firstCardId);
          return;
        }
        if (kind === "known_bank") {
          if (!bankAccountId) {
            setMessage("Cadastre uma conta bancária antes de importar o extrato.");
            return;
          }
          setBankPreview(await api.previewImport(path, bankAccountId));
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
        if (sourceKind === "credit_card" && firstCardId) {
          setCardAccountId(firstCardId);
        }
      } catch (error: any) {
        setMessage(`Não foi possível ler o arquivo: ${error?.message || error}`);
      } finally {
        setIsReadingFile(false);
      }
    },
    [bankAccountId, firstCardId, isReadingFile, resetFlow],
  );

  const handleDroppedPaths = useCallback(
    async (paths: string[]) => {
      if (!canStartImport || paths.length === 0) return;
      if (paths.length > 1) {
        setIsDraggingFile(false);
        setMessage("Solte apenas um arquivo por vez para revisar a importação com segurança.");
        return;
      }
      await processImportPath(paths[0]);
    },
    [canStartImport, processImportPath],
  );

  useEffect(() => {
    if (!("__TAURI_INTERNALS__" in window)) return;
    let disposed = false;
    let unlisten: (() => void) | undefined;

    getCurrentWebview()
      .onDragDropEvent((event) => {
        if (disposed) return;
        if (!canStartImport) {
          if (event.payload.type !== "over") setIsDraggingFile(false);
          return;
        }
        if (event.payload.type === "enter" || event.payload.type === "over") {
          setIsDraggingFile(true);
          return;
        }
        if (event.payload.type === "leave") {
          setIsDraggingFile(false);
          return;
        }
        void handleDroppedPaths(event.payload.paths);
      })
      .then((nextUnlisten) => {
        if (disposed) nextUnlisten();
        else unlisten = nextUnlisten;
      })
      .catch(() => setIsDraggingFile(false));

    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [canStartImport, handleDroppedPaths]);

  async function choose() {
    if (!("__TAURI_INTERNALS__" in window)) {
      setMessage("Abra o aplicativo desktop para selecionar arquivos locais.");
      return;
    }
    const selectedPath = await open({
      multiple: false,
      filters: [{ name: "Extratos e faturas", extensions: ["csv", "ofx", "pdf"] }],
    });
    if (!selectedPath) return;
    const path = Array.isArray(selectedPath) ? selectedPath[0] : selectedPath;
    await processImportPath(path);
  }

  function handleDropzoneDrag(event: DragEvent<HTMLElement>) {
    event.preventDefault();
    event.stopPropagation();
    if (canStartImport) setIsDraggingFile(true);
  }

  function handleDropzoneLeave(event: DragEvent<HTMLElement>) {
    event.preventDefault();
    const nextTarget = event.relatedTarget as Node | null;
    if (nextTarget && event.currentTarget.contains(nextTarget)) return;
    setIsDraggingFile(false);
  }

  function handleDropzoneDrop(event: DragEvent<HTMLElement>) {
    event.preventDefault();
    event.stopPropagation();
    setIsDraggingFile(false);
    if (!canStartImport) return;
    const paths = Array.from(event.dataTransfer.files)
      .map((file) => (file as File & { path?: string }).path)
      .filter((path): path is string => Boolean(path));
    if (paths.length > 0) {
      void handleDroppedPaths(paths);
      return;
    }
    setMessage(
      "__TAURI_INTERNALS__" in window
        ? "Não consegui acessar o caminho do arquivo arrastado. Use Escolher arquivo ou tente soltar novamente."
        : "Abra o aplicativo desktop para arrastar arquivos locais.",
    );
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
    const { count, batchId } = await api.commitImport(bankPreview.sessionId);
    await maybeSaveMappingProfile();
    setMessage(`${count} transações importadas com segurança.`);
    resetFlow();
    await refresh();
    await checkForTransferCandidates(batchId);
  }

  async function checkForTransferCandidates(batchId: string) {
    try {
      const candidates = await api.detectTransferCandidates(batchId);
      if (candidates.length > 0) setTransferCandidates(candidates);
    } catch (error: any) {
      // Detection is a best-effort convenience; a failure here shouldn't block the import.
      console.error("Falha ao detectar transferências entre contas:", error);
    }
  }

  async function linkTransferCandidate(candidate: TransferCandidate) {
    const key = `${candidate.debitTransactionId}:${candidate.creditTransactionId}`;
    setLinkingTransfer(key);
    try {
      await api.linkTransferPair(candidate.debitTransactionId, candidate.creditTransactionId);
      setTransferCandidates((current) => current.filter((c) => c !== candidate));
      setMessage("Transferência vinculada com sucesso.");
      await refresh();
    } catch (error: any) {
      setMessage(`Não foi possível vincular a transferência: ${error?.message || error}`);
    } finally {
      setLinkingTransfer(undefined);
    }
  }

  function dismissTransferCandidate(candidate: TransferCandidate) {
    setTransferCandidates((current) => current.filter((c) => c !== candidate));
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

  async function changeBankCategory(sourceRow: number, categoryId?: string) {
    if (!bankPreview) return;
    const candidate = bankPreview.candidates.find((c) => c.sourceRow === sourceRow);
    const oldCategoryId = candidate?.suggestedCategoryId;
    await api.setImportCategory(bankPreview.sessionId, sourceRow, categoryId || undefined);
    const category = categories.find((item) => item.id === categoryId);

    if (categoryId && oldCategoryId !== categoryId && candidate) {
      setLearning({
        sourceRow,
        categoryId,
        pattern: suggestRulePattern(candidate.normalizedDescription || candidate.description),
        amountInCents: candidate.amountInCents,
        kind: "bank",
      });
    }

    setBankPreview({
      ...bankPreview,
      candidates: bankPreview.candidates.map((candidate) =>
        candidate.sourceRow === sourceRow
          ? {
              ...candidate,
              suggestedCategoryId: categoryId || undefined,
              suggestedCategoryName: category?.name,
              suggestedRuleId: undefined,
              suggestedRuleName: undefined,
            }
          : candidate,
      ),
    });
  }

  async function updateBankCandidate(sourceRow: number, amountInCents: number, included: boolean) {
    if (!bankPreview) return;
    try {
      const updated = await api.updateImportCandidate(bankPreview.sessionId, sourceRow, amountInCents, included);
      setBankPreview({
        ...bankPreview,
        candidates: bankPreview.candidates.map((candidate) =>
          candidate.sourceRow === sourceRow ? updated : candidate,
        ),
      });
    } catch (error: any) {
      setMessage(`Erro ao atualizar lançamento: ${error?.message || error}`);
    }
  }

  async function updateCard(sourceRow: number, included: boolean, categoryId?: string, dueDate?: string) {
    if (!cardPreview) return;

    const item = cardPreview.items.find((i) => i.candidate.sourceRow === sourceRow);
    const oldCategoryId = item?.candidate.suggestedCategoryId;

    setCardPreview(await api.updateCreditCardImport(cardPreview.sessionId, sourceRow, included, categoryId, dueDate));

    if (categoryId && oldCategoryId !== categoryId && item) {
      setLearning({
        sourceRow,
        categoryId,
        pattern: suggestRulePattern(item.candidate.normalizedDescription || item.candidate.description),
        amountInCents: item.candidate.amountInCents,
        kind: "card",
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
      movementType:
        selectedCategory?.kind === "transfer" ? "transfer" : learning.amountInCents >= 0 ? "income" : "expense",
      categoryId: learning.categoryId,
    });

    const p = normalizeText(learning.pattern);
    const matchesLearning = (description: string) => normalizeText(description).includes(p);

    if (learning.kind === "bank" && bankPreview) {
      const updates = bankPreview.candidates.filter(
        (c) =>
          matchesLearning(c.normalizedDescription || c.description) && c.suggestedCategoryId !== learning.categoryId,
      );
      for (const u of updates) {
        await api.setImportCategory(bankPreview.sessionId, u.sourceRow, learning.categoryId);
      }
      setBankPreview({
        ...bankPreview,
        candidates: bankPreview.candidates.map((c) =>
          matchesLearning(c.normalizedDescription || c.description)
            ? { ...c, suggestedCategoryId: learning.categoryId, suggestedCategoryName: selectedCategory?.name }
            : c,
        ),
      });
    }

    if (learning.kind === "card" && cardPreview) {
      let currentPreview = cardPreview;
      const updates = cardPreview.items.filter(
        (i) =>
          matchesLearning(i.candidate.normalizedDescription || i.candidate.description) &&
          i.candidate.suggestedCategoryId !== learning.categoryId,
      );
      for (const u of updates) {
        currentPreview = await api.updateCreditCardImport(
          cardPreview.sessionId,
          u.candidate.sourceRow,
          u.included,
          learning.categoryId,
          undefined,
        );
      }
      setCardPreview(currentPreview);
    }

    setLearning(undefined);
  }

  function setDraft(next: CsvMappingDraft) {
    setMappingState((current) => (current ? { ...current, draft: next } : current));
  }

  return (
    <section className="import-page">
      <PageHeader>
        <div>
          <p className="eyebrow">IMPORTAÇÃO SEGURA</p>
          <h1>Importar extrato ou fatura</h1>
          <p className="muted">CSV, OFX e PDF são processados somente neste computador.</p>
        </div>
      </PageHeader>
      {asyncLoading && <LoadingState variant="panel" label="Carregando dados para importação…" />}
      {asyncError && (
        <ErrorState
          message="Não foi possível carregar os dados para importação."
          onRetry={() => void Promise.all([refetchCategories(), refetchAccounts()])}
        />
      )}

      {canStartImport && (
        <article
          className={`dropzone import-dropzone${isDraggingFile ? " dragging" : ""}`}
          onDragEnter={handleDropzoneDrag}
          onDragOver={handleDropzoneDrag}
          onDragLeave={handleDropzoneLeave}
          onDrop={handleDropzoneDrop}
        >
          <FileUp size={42} />
          <h2>{isDraggingFile ? "Solte o arquivo para importar" : "Arraste ou selecione um arquivo financeiro"}</h2>
          <p>
            Arraste um CSV, OFX ou PDF para esta área. O aplicativo reconhece automaticamente extratos e faturas; para
            outros CSVs, você pode mapear as colunas e salvar o layout.
          </p>
          <button ref={chooseFileRef} onClick={choose} disabled={isReadingFile}>
            {isReadingFile ? "Lendo arquivo..." : "Escolher arquivo"}
          </button>
          <div className="import-trouble-menu">
            <button
              ref={troubleMenuTriggerRef}
              type="button"
              className="text-button"
              aria-haspopup="dialog"
              aria-expanded={showTroubleMenu}
              aria-controls="import-trouble-menu"
              onClick={() => setShowTroubleMenu((open) => !open)}
            >
              Enfrentando problemas?
            </button>
            {showTroubleMenu && (
              <div
                ref={troubleMenuRef}
                id="import-trouble-menu"
                role="dialog"
                aria-label="Ajuda para importar arquivos"
                style={{
                  position: "absolute",
                  top: openUpwards ? "auto" : "calc(100% + 8px)",
                  bottom: openUpwards ? "calc(100% + 8px)" : "auto",
                  left: "50%",
                  transform: "translateX(-50%)",
                  background: "var(--surface)",
                  border: "1px solid var(--border-strong)",
                  padding: "14px",
                  borderRadius: "14px",
                  boxShadow: "var(--shadow-md)",
                  display: "flex",
                  flexDirection: "column",
                  zIndex: 10,
                  minWidth: "240px",
                  animation: openUpwards ? "slideUp 0.2s ease-out" : "slideDown 0.2s ease-out",
                }}
              >
                <button
                  className="icon-button"
                  type="button"
                  aria-label="Fechar ajuda para importar"
                  style={{ position: "absolute", top: "4px", right: "4px", background: "transparent", margin: 0 }}
                  onClick={() => closeTroubleMenu(true)}
                >
                  <X size={14} />
                </button>
                <p
                  style={{
                    margin: "6px 20px 12px 0",
                    fontSize: "12px",
                    color: "var(--text-muted)",
                    textAlign: "left",
                    lineHeight: 1.4,
                    fontWeight: 500,
                  }}
                >
                  Baixe nossos templates vazios em CSV e preencha com seus dados de onde estiver.
                </p>
                <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
                  <button
                    className="secondary"
                    type="button"
                    data-initial-focus
                    style={{
                      justifyContent: "flex-start",
                      width: "100%",
                      padding: "10px 14px",
                      borderRadius: "9px",
                      margin: 0,
                    }}
                    onClick={() => {
                      closeTroubleMenu();
                      exportTemplate("bank");
                    }}
                  >
                    <Download size={15} /> Template de conta
                  </button>
                  <button
                    className="secondary"
                    type="button"
                    style={{
                      justifyContent: "flex-start",
                      width: "100%",
                      padding: "10px 14px",
                      borderRadius: "9px",
                      margin: 0,
                    }}
                    onClick={() => {
                      closeTroubleMenu();
                      exportTemplate("credit_card");
                    }}
                  >
                    <Download size={15} /> Template de cartão
                  </button>
                </div>
              </div>
            )}
          </div>
          <small>
            <ShieldCheck size={15} /> Nenhum dado financeiro é enviado para a internet.
          </small>
        </article>
      )}

      {pendingCardPath && (
        <article className="panel card-import-setup">
          <div className="panel-title">
            <div>
              <p className="eyebrow">FATURA DETECTADA</p>
              <h2>Em qual cartão importar?</h2>
            </div>
            <div className="metric-icon blue">
              <CreditCard />
            </div>
          </div>
          <div className="file-banner">
            <FileText size={16} />
            <span>{pendingCardPath.split(/[\\/]/).pop()}</span>
          </div>
          <div className="card-import-form">
            <CardPicker
              label="Cartão"
              required
              cards={cards}
              value={cardAccountId}
              onChange={setCardAccountId}
              onCreate={() => setCreatingCard(true)}
            />
            <label>
              Vencimento da fatura (caso não conste no arquivo)
              <input type="date" value={cardDueDate} onChange={(e) => setCardDueDate(e.target.value)} />
            </label>
            <div className="editor-actions">
              <button className="secondary" onClick={resetFlow}>
                Cancelar
              </button>
              <button disabled={!cardAccountId} onClick={previewCard}>
                Revisar fatura
              </button>
            </div>
          </div>
        </article>
      )}

      {mappingState && (
        <article className="panel import-mapping-panel">
          <div className="panel-title">
            <div>
              <p className="eyebrow">CSV PERSONALIZADO</p>
              <h2>Mapeie as colunas do arquivo</h2>
              <small>{mappingState.inspection.fileName}</small>
            </div>
            <TableProperties />
          </div>
          <p className="muted import-flow-hint">
            Confira o tipo do arquivo, indique o que cada coluna representa e escolha o destino. Assim que todos os
            passos abaixo estiverem completos, a prévia aparece embaixo para você revisar antes de confirmar.
          </p>
          {mappingState.matchedProfile && (
            <p className="notice">
              Layout salvo detectado: <b>{mappingState.matchedProfile.name}</b>. Você pode revisar antes de importar.
            </p>
          )}
          <MappingChecklist
            draft={mappingState.draft}
            hasBankAccount={Boolean(bankAccount)}
            hasCard={Boolean(cardAccountId)}
          />
          <div className="rules-layout">
            <div className="rule-editor">
              <div className="form-row">
                <label>
                  Tipo do CSV
                  <Select
                    value={mappingState.draft.sourceKind}
                    onChange={(value) => {
                      const sourceKind = value as ImportSourceKind;
                      setDraft(buildInitialDraft(mappingState.inspection, sourceKind, mappingState.draft));
                      setMappingState((current) =>
                        current ? { ...current, matchedProfile: undefined, saveProfile: true } : current,
                      );
                    }}
                    options={[
                      { value: "bank", label: "Conta bancária" },
                      { value: "credit_card", label: "Cartão de crédito" },
                    ]}
                  />
                </label>
                <label>
                  Delimitador
                  <Select
                    value={mappingState.draft.delimiter}
                    onChange={(value) => setDraft({ ...mappingState.draft, delimiter: value })}
                    options={[
                      { value: ";", label: "Ponto e vírgula (;)" },
                      { value: ",", label: "Vírgula (,)" },
                    ]}
                  />
                </label>
              </div>
              <div className="form-row">
                <label>
                  Formato de data
                  <Select
                    value={mappingState.draft.dateFormat ?? ""}
                    onChange={(value) => setDraft({ ...mappingState.draft, dateFormat: value || undefined })}
                    options={[
                      { value: "", label: "Automático" },
                      { value: "dd/MM/yyyy", label: "dd/MM/yyyy" },
                      { value: "yyyy-MM-dd", label: "yyyy-MM-dd" },
                      { value: "dd/MM/yy", label: "dd/MM/yy" },
                    ]}
                  />
                </label>
                <label>
                  Separador decimal
                  <Select
                    value={mappingState.draft.decimalSeparator ?? "comma"}
                    onChange={(value) =>
                      setDraft({ ...mappingState.draft, decimalSeparator: value as "comma" | "dot" })
                    }
                    options={[
                      { value: "comma", label: "Vírgula decimal" },
                      { value: "dot", label: "Ponto decimal" },
                    ]}
                  />
                </label>
              </div>
              {mappingState.draft.sourceKind === "credit_card" && (
                <div className="form-row form-row-top">
                  <CardPicker
                    label="Cartão de destino"
                    required
                    cards={cards}
                    value={cardAccountId}
                    onChange={setCardAccountId}
                    onCreate={() => setCreatingCard(true)}
                  />
                  <label>
                    <span>
                      Vencimento padrão da fatura <span className="req">*</span>
                    </span>
                    <input
                      type="date"
                      value={mappingState.draft.defaultDueDate ?? ""}
                      onChange={(event) =>
                        setDraft({ ...mappingState.draft, defaultDueDate: event.target.value || undefined })
                      }
                    />
                  </label>
                </div>
              )}
              <label className="check-label">
                <input
                  type="checkbox"
                  checked={mappingState.saveProfile}
                  onChange={(event) =>
                    setMappingState((current) =>
                      current ? { ...current, saveProfile: event.target.checked } : current,
                    )
                  }
                />
                Salvar este layout para próximas importações
              </label>
              {mappingState.saveProfile && (
                <label>
                  <span>
                    Nome do layout <span className="req">*</span>
                  </span>
                  <input
                    value={mappingState.draft.profileName ?? ""}
                    onChange={(event) => setDraft({ ...mappingState.draft, profileName: event.target.value })}
                    placeholder="Ex.: CSV Nubank crédito"
                  />
                </label>
              )}
              <div className="impact">
                <b>Colunas encontradas</b>
                <small className="impact-hint">
                  {mappingState.draft.sourceKind === "credit_card"
                    ? "Atribua, no mínimo, data da compra, descrição e valor."
                    : "Atribua, no mínimo, data, descrição e valor."}
                </small>
                {mappingState.draft.columns.map((column, index) => (
                  <div key={`${column.header}-${index}`} className="mapping-row">
                    <span>
                      <b>{column.header}</b>
                      <small>{sampleValue(mappingState.inspection, column.index)}</small>
                    </span>
                    <Select
                      value={column.role}
                      onChange={(value) =>
                        setDraft({
                          ...mappingState.draft,
                          columns: mappingState.draft.columns.map((item, itemIndex) =>
                            itemIndex === index ? { ...item, role: value as CsvColumnRole } : item,
                          ),
                        })
                      }
                      options={roleOptions(mappingState.draft.sourceKind).map((role) => ({
                        value: role.value,
                        label: role.label,
                      }))}
                    />
                  </div>
                ))}
              </div>
              <p className="req-legend">
                <span className="req">*</span> Campos obrigatórios para liberar a prévia.
              </p>
              <div className="editor-actions">
                <button className="secondary" onClick={resetFlow}>
                  Cancelar
                </button>
                {mappingState.matchedProfile && (
                  <button
                    className="secondary"
                    onClick={() => setDraft(draftFromProfile(mappingState.matchedProfile!))}
                  >
                    Reaplicar layout salvo
                  </button>
                )}
              </div>
            </div>

            <article className="panel mapping-sample-panel">
              <div className="panel-title">
                <div>
                  <h2>Amostra do arquivo</h2>
                  <small>Use esta grade para conferir se o mapeamento faz sentido.</small>
                </div>
              </div>
              <div className="table-scroll">
                <table>
                  <thead>
                    <tr>
                      {mappingState.inspection.headers.map((header) => (
                        <th key={header}>{header}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {mappingState.inspection.sampleRows.map((row, index) => (
                      <tr key={`row-${index}`}>
                        {mappingState.inspection.headers.map((_, cellIndex) => (
                          <td key={`${index}-${cellIndex}`}>{row[cellIndex] || "—"}</td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {mappingError && <p className="form-error">{mappingError}</p>}
            </article>
          </div>
        </article>
      )}

      {bankPreview && (
        <article className="panel">
          <div className="panel-title">
            <h2>Prévia de {bankPreview.fileName}</h2>
            <span>{bankPreview.candidates.length} registros</span>
          </div>
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Incluir</th>
                  <th>Data</th>
                  <th>Descrição</th>
                  <th>Categoria sugerida</th>
                  <th>Valor editável</th>
                  <th>Duplicidade</th>
                </tr>
              </thead>
              <tbody>
                {bankPreview.candidates.slice(0, 100).map((candidate) => (
                  <tr key={candidate.sourceRow} className={!candidate.included ? "excluded-row" : ""}>
                    <td>
                      <input
                        type="checkbox"
                        checked={candidate.included}
                        disabled={candidate.duplicateStatus === "exact"}
                        onChange={(event) =>
                          updateBankCandidate(candidate.sourceRow, candidate.amountInCents, event.target.checked)
                        }
                      />
                    </td>
                    <td>{candidate.date}</td>
                    <td>
                      {candidate.description}
                      {candidate.suggestionSource === "rule" && candidate.suggestedRuleName && (
                        <small className="source-label">por {candidate.suggestedRuleName}</small>
                      )}
                      {candidate.suggestionSource === "history" && (
                        <small className="source-label history-label">pelo seu histórico</small>
                      )}
                    </td>
                    <td>
                      <CategorySelect
                        value={candidate.suggestedCategoryId}
                        categories={categories}
                        onChange={(value) => changeBankCategory(candidate.sourceRow, value)}
                      />
                    </td>
                    <td>
                      <MoneyEditor
                        value={candidate.amountInCents}
                        disabled={!candidate.included}
                        onCommit={(value) => updateBankCandidate(candidate.sourceRow, value, candidate.included)}
                      />
                    </td>
                    <td>
                      <span className="badge">{candidate.duplicateStatus}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="editor-actions">
            <button className="secondary" onClick={resetFlow}>
              Cancelar
            </button>
            <button onClick={commitBank}>Confirmar importação</button>
          </div>
        </article>
      )}

      {cardPreview && (
        <article className="panel">
          <div className="panel-title">
            <div>
              <p className="eyebrow">FATURA DE CARTÃO</p>
              <h2>{cardPreview.fileName}</h2>
            </div>
            <label className="compact-label">
              Vencimento
              <input
                type="date"
                value={cardPreview.dueDate}
                onChange={(event) =>
                  updateCard(
                    cardPreview.items[0].candidate.sourceRow,
                    cardPreview.items[0].included,
                    cardPreview.items[0].candidate.suggestedCategoryId,
                    event.target.value,
                  )
                }
              />
            </label>
          </div>
          <div className="invoice-totals">
            <div>
              <span>Compras</span>
              <strong>{money(cardPreview.purchasesInCents)}</strong>
            </div>
            <div>
              <span>Créditos e pagamentos</span>
              <strong>{money(cardPreview.creditsInCents)}</strong>
            </div>
            <div className="invoice-total">
              <span>Saldo da fatura</span>
              <strong>{money(cardPreview.totalInCents)}</strong>
            </div>
          </div>
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Incluir</th>
                  <th>Data</th>
                  <th>Estabelecimento</th>
                  <th>Portador</th>
                  <th>Parcela</th>
                  <th>Categoria</th>
                  <th>Valor</th>
                </tr>
              </thead>
              <tbody>
                {cardPreview.items.map((item) => (
                  <tr key={item.candidate.sourceRow} className={!item.included ? "excluded-row" : ""}>
                    <td>
                      <input
                        type="checkbox"
                        checked={item.included}
                        disabled={item.candidate.duplicateStatus === "exact"}
                        onChange={(event) =>
                          updateCard(item.candidate.sourceRow, event.target.checked, item.candidate.suggestedCategoryId)
                        }
                      />
                    </td>
                    <td>{item.candidate.date}</td>
                    <td>
                      {item.candidate.description}
                      {item.isPayment && <small className="source-label">transferência</small>}
                      {!item.isPayment && item.candidate.suggestionSource === "history" && (
                        <small className="source-label history-label">pelo seu histórico</small>
                      )}
                    </td>
                    <td>{item.holder ?? "—"}</td>
                    <td>{item.installment ?? "—"}</td>
                    <td>
                      <CategorySelect
                        value={item.candidate.suggestedCategoryId}
                        categories={categories}
                        onChange={(value) => updateCard(item.candidate.sourceRow, item.included, value)}
                      />
                    </td>
                    <td className={item.candidate.amountInCents > 0 ? "positive amount" : "amount"}>
                      {money(item.candidate.amountInCents)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="editor-actions">
            <button className="secondary" onClick={resetFlow}>
              Cancelar
            </button>
            <button onClick={commitCard}>Confirmar fatura</button>
          </div>
        </article>
      )}
      {message && <p className="notice">{message}</p>}

      {transferCandidates.length > 0 && (
        <article className="panel">
          <div className="panel-title">
            <div>
              <p className="eyebrow">POSSÍVEIS TRANSFERÊNCIAS</p>
              <h2>Detectamos possíveis transferências entre suas contas</h2>
            </div>
            <div className="metric-icon blue">
              <ArrowLeftRight />
            </div>
          </div>
          <p className="muted import-flow-hint">
            Estes lançamentos parecem ser a mesma transferência aparecendo duas vezes — uma saída e uma entrada em
            contas diferentes. Vincule-os para que deixem de contar como receita e despesa nos relatórios.
          </p>
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Saída</th>
                  <th>Entrada</th>
                  <th>Valor</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {transferCandidates.map((candidate) => {
                  const key = `${candidate.debitTransactionId}:${candidate.creditTransactionId}`;
                  const linking = linkingTransfer === key;
                  return (
                    <tr key={key}>
                      <td>
                        {candidate.debitDescription}
                        <small className="source-label">
                          {candidate.debitAccountName} · {candidate.debitDate}
                        </small>
                      </td>
                      <td>
                        {candidate.creditDescription}
                        <small className="source-label">
                          {candidate.creditAccountName} · {candidate.creditDate}
                        </small>
                      </td>
                      <td>{money(candidate.amountInCents)}</td>
                      <td>
                        <div className="editor-actions" style={{ margin: 0 }}>
                          <button
                            className="secondary"
                            disabled={linking}
                            onClick={() => dismissTransferCandidate(candidate)}
                          >
                            Ignorar
                          </button>
                          <button disabled={linking} onClick={() => linkTransferCandidate(candidate)}>
                            {linking ? "Vinculando..." : "Vincular como transferência"}
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </article>
      )}

      {learning && (
        <Modal title="Usar esta correção no futuro?" onClose={() => setLearning(undefined)}>
          <div className="modal-form">
            <p className="muted">
              Você pode criar uma regra local, deixar que o histórico aprenda sozinho ou manter a alteração somente
              nesta importação.
            </p>
            <label>
              Descrição contém
              <input value={learning.pattern} onChange={(e) => setLearning({ ...learning, pattern: e.target.value })} />
            </label>
            <div className="editor-actions">
              <button className="secondary" onClick={() => setLearning(undefined)}>
                Somente nesta importação
              </button>
              <button className="secondary" onClick={() => setLearning(undefined)}>
                Não perguntar de novo para este estabelecimento
              </button>
              <button onClick={createRule}>Criar regra</button>
            </div>
          </div>
        </Modal>
      )}

      {creatingCard && (
        <Modal title="Novo cartão" onClose={() => setCreatingCard(false)}>
          <p className="muted">Cadastre um cartão de crédito para vincular a esta fatura.</p>
          <div className="modal-form">
            <label>
              Nome do cartão
              <input
                value={newCardName}
                onChange={(e) => setNewCardName(e.target.value)}
                placeholder="Ex.: Itaú Mastercard"
                onKeyDown={(e) => e.key === "Enter" && createCard()}
              />
            </label>
          </div>
          <div className="editor-actions" style={{ marginTop: "24px" }}>
            <button className="secondary" onClick={() => setCreatingCard(false)}>
              Cancelar
            </button>
            <button disabled={newCardName.trim().length < 2} onClick={createCard}>
              Salvar cartão
            </button>
          </div>
        </Modal>
      )}
    </section>
  );
}

function buildInitialDraft(
  inspection: ImportFileInspection,
  sourceKind: ImportSourceKind,
  previous?: CsvMappingDraft,
): CsvMappingDraft {
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
    if (normalized.includes("descr") || normalized.includes("hist") || normalized.includes("memo"))
      return "description";
    if (normalized.includes("deb")) return "debit_amount";
    if (normalized.includes("cred")) return "credit_amount";
    if (normalized.includes("valor") || normalized.includes("amount")) return "signed_amount";
    if (normalized.includes("id") || normalized.includes("fitid") || normalized.includes("doc")) return "external_id";
    if (normalized.includes("saldo")) return "balance";
    return "ignore";
  }
  if (normalized.includes("data")) return "purchase_date";
  if (
    normalized.includes("estabele") ||
    normalized.includes("descr") ||
    normalized.includes("hist") ||
    normalized.includes("memo")
  )
    return "description";
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
  return (
    (has("purchase_date") || has("date")) &&
    has("description") &&
    has("signed_amount") &&
    (has("due_date") || Boolean(draft.defaultDueDate))
  );
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
      {
        label: "Mapear a coluna de valor (com sinal, débito ou crédito)",
        done: has("signed_amount") || has("debit_amount") || has("credit_amount"),
      },
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

function MappingChecklist({
  draft,
  hasBankAccount,
  hasCard,
}: {
  draft: CsvMappingDraft;
  hasBankAccount: boolean;
  hasCard: boolean;
}) {
  const items = mappingChecklist(draft, hasBankAccount, hasCard);
  const pending = items.filter((item) => !item.done).length;
  const ready = pending === 0;
  return (
    <div className={`mapping-checklist${ready ? " ready" : ""}`}>
      <div className="mapping-checklist-head">
        {ready ? (
          <>
            <CheckCircle2 size={16} /> Tudo pronto! Confira a prévia da fatura logo abaixo.
          </>
        ) : (
          <>
            <ListChecks size={16} /> Faltam {pending} {pending === 1 ? "passo" : "passos"} para liberar a prévia:
          </>
        )}
      </div>
      <ul>
        {items.map((item, index) => (
          <li key={index} className={item.done ? "done" : "pending"}>
            {item.done ? <Check size={14} /> : <Circle size={14} />}
            <span>{item.label}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function CardPicker({
  label,
  cards,
  value,
  onChange,
  onCreate,
  required,
}: {
  label: string;
  cards: { id: string; name: string }[];
  value: string;
  onChange: (id: string) => void;
  onCreate: () => void;
  required?: boolean;
}) {
  const empty = cards.length === 0;
  return (
    <div className="card-picker">
      <span className="card-picker-label">
        {label}
        {required && <span className="req"> *</span>}
      </span>
      <div className="card-picker-row">
        <Select
          value={value}
          onChange={onChange}
          disabled={empty}
          ariaLabel={label}
          options={
            empty
              ? [{ value: "", label: "Nenhum cartão cadastrado" }]
              : cards.map((card) => ({ value: card.id, label: card.name }))
          }
        />
        <button
          type="button"
          className="icon-button card-picker-add"
          onClick={onCreate}
          title="Cadastrar novo cartão"
          aria-label="Cadastrar novo cartão"
        >
          <Plus size={18} />
        </button>
      </div>
      {empty && (
        <small className="card-picker-hint">
          Você ainda não tem cartões. Toque em <b>+</b> para cadastrar o primeiro.
        </small>
      )}
    </div>
  );
}

function MoneyEditor({
  value,
  disabled,
  onCommit,
}: {
  value: number;
  disabled?: boolean;
  onCommit: (value: number) => void;
}) {
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
  return (
    <div className="editable-money">
      <span>R$</span>
      <input
        inputMode="decimal"
        aria-label="Valor da transação"
        value={text}
        disabled={disabled}
        onChange={(event) => setText(maskCurrency(event.target.value))}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === "Enter") event.currentTarget.blur();
        }}
      />
    </div>
  );
}
