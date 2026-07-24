import { PageHeader } from "../../shared/ui/PageHeader";
import { type DragEvent, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { open, save } from "@tauri-apps/plugin-dialog";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import {
  ArrowLeftRight,
  BookOpen,
  Check,
  CheckCircle2,
  ChevronLeft,
  Circle,
  CreditCard,
  Download,
  FileText,
  FileUp,
  ListChecks,
  Lightbulb,
  Plus,
  ShieldCheck,
  TableProperties,
  X,
} from "lucide-react";
import { api } from "../../shared/api";
import { Modal } from "../../shared/ui/Modal";
import { CategoryIcon, CategorySelect } from "../../shared/ui/CategorySelect";
import { DatePicker } from "../../shared/ui/CalendarPicker";
import { ErrorState, LoadingState } from "../../shared/ui/AsyncState";
import { Select } from "../../shared/ui/Select";
import { Tabs } from "../../shared/ui/Tabs";
import { ImportTutorial, shouldAutoStartImportGuide } from "./ImportTutorial";
import { useQuickStartGuide, type ImportGuidePhase } from "../../shared/quickStartGuide";
import {
  money,
  centsToInput,
  parseMoneyToCents,
  maskCurrency,
  normalizeText,
  suggestRulePattern,
} from "../../shared/format";
import type {
  CreditCardImportCommitResult,
  CreditCardImportPreview,
  CreditCardImportItem,
  Category,
  CategoryKind,
  ImportCandidate,
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

type LearningDraft = {
  sourceRow: number;
  categoryId: string;
  pattern: string;
  amountInCents: number;
  kind: "bank" | "card";
  count: number;
};

type ReviewUndoChoice = {
  kind: "bank" | "card";
  sessionId: string;
  groupKey: string;
  label: string;
  sourceRows: number[];
  representative: ImportCandidate;
};

export function cardPaymentReconciliationPath(paymentTransactionId: string) {
  return `/accounts?reconcile=${encodeURIComponent(paymentTransactionId)}`;
}

export function CardImportCommitNotice({
  summary,
  onReview,
}: {
  summary: CreditCardImportCommitResult;
  onReview: (paymentTransactionId: string) => void;
}) {
  if (summary.paymentTransactionIds.length === 0) return null;

  return (
    <article className="import-payment-summary" aria-live="polite">
      <div>
        <CheckCircle2 aria-hidden="true" />
        <span>
          <strong>
            {summary.paymentTransactionIds.length}{" "}
            {summary.paymentTransactionIds.length === 1
              ? "pagamento anterior detectado"
              : "pagamentos anteriores detectados"}
          </strong>
          <small>
            Revise a correspondência com a fatura anterior e com o débito da conta antes de confirmar o vínculo.
          </small>
        </span>
      </div>
      <button className="secondary" onClick={() => onReview(summary.paymentTransactionIds[0])}>
        Revisar conciliação
      </button>
    </article>
  );
}

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

export function creditCardCategorizationCandidates(preview?: CreditCardImportPreview) {
  return preview?.items.filter((item) => !item.isPayment).map((item) => item.candidate) ?? [];
}

export function CreditCardImportTotals({ preview }: { preview: CreditCardImportPreview }) {
  const paymentCount = preview.items.filter((item) => item.isPayment && item.included).length;

  return (
    <>
      <div className="invoice-totals">
        <div>
          <span>Compras</span>
          <strong>{money(preview.purchasesInCents)}</strong>
        </div>
        <div>
          <span>Créditos e estornos</span>
          <strong>{money(preview.creditsInCents)}</strong>
        </div>
        <div className="invoice-total">
          <span>Total desta fatura</span>
          <strong>{money(preview.totalInCents)}</strong>
        </div>
      </div>
      {paymentCount > 0 && (
        <div className="import-payment-callout" role="status">
          <ArrowLeftRight aria-hidden="true" />
          <span>
            <strong>
              {paymentCount === 1 ? "Pagamento anterior detectado" : "Pagamentos anteriores detectados"} — não altera
              esta fatura
            </strong>
            <small>
              {money(preview.paymentsInCents)} será mantido para baixar a dívida do cartão e poderá ser conciliado
              depois.
            </small>
          </span>
        </div>
      )}
    </>
  );
}

type CreditCardImportItemsProps = {
  items: CreditCardImportItem[];
  paymentsInCents: number;
  categories: Category[];
  onUpdate: (sourceRow: number, included: boolean, categoryId?: string) => void;
};

export function CreditCardImportItems({ items, paymentsInCents, categories, onUpdate }: CreditCardImportItemsProps) {
  const regularItems = items.filter((item) => !item.isPayment);
  const paymentItems = items.filter((item) => item.isPayment);

  return (
    <div className="credit-card-import-items">
      <CreditCardItemsTable items={regularItems} categories={categories} onUpdate={onUpdate} />
      {paymentItems.length > 0 && (
        <details className="import-payment-details">
          <summary>
            <span>
              Pagamentos anteriores ({paymentItems.length}) <strong>{money(paymentsInCents)}</strong>
            </span>
            <small>Incluídos por padrão</small>
          </summary>
          <p>
            Estes lançamentos baixam a dívida do cartão, mas não alteram o total desta fatura. Desmarque somente se a
            detecção estiver incorreta.
          </p>
          <CreditCardItemsTable items={paymentItems} categories={categories} onUpdate={onUpdate} payments />
        </details>
      )}
    </div>
  );
}

function CreditCardItemsTable({
  items,
  categories,
  onUpdate,
  payments = false,
}: Omit<CreditCardImportItemsProps, "paymentsInCents"> & { payments?: boolean }) {
  if (items.length === 0) return null;

  return (
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
          {items.map((item) => (
            <tr key={item.candidate.sourceRow} className={!item.included ? "excluded-row" : ""}>
              <td>
                <input
                  type="checkbox"
                  checked={item.included}
                  disabled={item.candidate.duplicateStatus === "exact"}
                  aria-label={`Incluir ${item.candidate.description}`}
                  onChange={(event) =>
                    onUpdate(item.candidate.sourceRow, event.target.checked, item.candidate.suggestedCategoryId)
                  }
                />
              </td>
              <td>{item.candidate.date}</td>
              <td>
                {item.candidate.description}
                {payments && <small className="source-label">pagamento anterior</small>}
                {!payments && item.candidate.suggestionSource === "rule" && (
                  <small className="source-label">por {item.candidate.suggestedRuleName ?? "regra"}</small>
                )}
                {!payments && item.candidate.suggestionSource === "history" && (
                  <small className="source-label history-label">pelo seu histórico</small>
                )}
              </td>
              <td>{item.holder ?? "—"}</td>
              <td>{item.installment ?? "—"}</td>
              <td>
                <CategorySelect
                  value={item.candidate.suggestedCategoryId}
                  categories={categories}
                  kind={compatibleCategoryKinds(item.candidate, categories, true)}
                  disabled={payments}
                  onChange={(value) => onUpdate(item.candidate.sourceRow, item.included, value)}
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
  );
}

export function importGuidePhaseForScreen({
  currentPhase,
  pendingCommit,
  hasPreview,
  hasConfiguration,
}: {
  currentPhase?: ImportGuidePhase;
  pendingCommit: boolean;
  hasPreview: boolean;
  hasConfiguration: boolean;
}): ImportGuidePhase {
  if (currentPhase === "success") return "success";
  if (pendingCommit) return "confirm";
  if (hasPreview) return "review";
  if (hasConfiguration) return "configure";
  return "choose";
}

export function shouldHandoffCompleteGuideToImport({
  activeGuide,
  completeStepIndex,
  phase,
}: {
  activeGuide: "complete" | "import" | null;
  completeStepIndex: number;
  phase: ImportGuidePhase;
}) {
  return activeGuide === "complete" && completeStepIndex === 0 && phase !== "choose";
}

export function importGuidePhaseForActiveScreen({
  activeGuide,
  currentPhase,
  pendingCommit,
  hasPreview,
  hasConfiguration,
}: {
  activeGuide: "complete" | "import" | null;
  currentPhase?: ImportGuidePhase;
  pendingCommit: boolean;
  hasPreview: boolean;
  hasConfiguration: boolean;
}) {
  return importGuidePhaseForScreen({
    currentPhase: activeGuide === "import" ? currentPhase : undefined,
    pendingCommit,
    hasPreview,
    hasConfiguration,
  });
}

export function ImportPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const client = useQueryClient();
  const [bankPreview, setBankPreview] = useState<ImportPreview>();
  const [cardPreview, setCardPreview] = useState<CreditCardImportPreview>();
  const [learning, setLearning] = useState<LearningDraft>();
  const [lastChoice, setLastChoice] = useState<LearningDraft>();
  const [lastReviewChoice, setLastReviewChoice] = useState<ReviewUndoChoice>();
  const [previewMode, setPreviewMode] = useState<"review" | "all">("review");
  const [pendingCommit, setPendingCommit] = useState<"bank" | "card">();
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
  const [cardCommitSummary, setCardCommitSummary] = useState<CreditCardImportCommitResult>();
  const tutorialAutoStartAttempted = useRef(false);
  const activeGuide = useQuickStartGuide((state) => state.activeGuide);
  const guideMode = useQuickStartGuide((state) => state.mode);
  const completeGuideStatus = useQuickStartGuide((state) => state.guides.complete.status);
  const completeGuideStepIndex = useQuickStartGuide((state) => state.guides.complete.stepIndex);
  const importGuideProgress = useQuickStartGuide((state) => state.guides.import);
  const restartGuide = useQuickStartGuide((state) => state.restart);
  const setImportPhase = useQuickStartGuide((state) => state.setImportPhase);

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
  const { data: bootstrap } = useQuery({ queryKey: ["bootstrap"], queryFn: api.bootstrap });
  const asyncLoading = categoriesLoading || accountsLoading;
  const asyncError = categoriesError || accountsError;
  const bankAccount = accounts.find((account) => account.kind !== "credit_card");
  const cards = accounts.filter((account) => account.kind === "credit_card");
  const bankAccountId = bankAccount?.id;
  const firstCardId = cards[0]?.id ?? "";
  const canStartImport = !bankPreview && !cardPreview && !pendingCardPath && !mappingState;
  const bankSummary = useMemo(() => summarizeSuggestions(bankPreview?.candidates ?? []), [bankPreview?.candidates]);
  const bankGroups = useMemo(() => groupPendingCandidates(bankPreview?.candidates ?? []), [bankPreview?.candidates]);
  const cardCandidates = useMemo(() => creditCardCategorizationCandidates(cardPreview), [cardPreview]);
  const cardSummary = useMemo(() => summarizeSuggestions(cardCandidates), [cardCandidates]);
  const cardGroups = useMemo(() => groupPendingCandidates(cardCandidates), [cardCandidates]);

  useEffect(() => {
    if (!bootstrap || tutorialAutoStartAttempted.current) return;
    if (
      !shouldAutoStartImportGuide({
        hasImports: bootstrap.hasImports,
        importStatus: importGuideProgress?.status,
        completeStatus: completeGuideStatus,
        activeGuide,
        mode: guideMode,
      })
    )
      return;

    tutorialAutoStartAttempted.current = true;
    restartGuide("import");
  }, [activeGuide, bootstrap, completeGuideStatus, guideMode, importGuideProgress?.status, restartGuide]);

  useEffect(() => {
    const phase = importGuidePhaseForActiveScreen({
      activeGuide,
      currentPhase: importGuideProgress?.phase,
      pendingCommit: Boolean(pendingCommit),
      hasPreview: Boolean(bankPreview || cardPreview),
      hasConfiguration: Boolean(pendingCardPath || mappingState),
    });

    if (
      shouldHandoffCompleteGuideToImport({
        activeGuide,
        completeStepIndex: completeGuideStepIndex,
        phase,
      })
    ) {
      setImportPhase(phase);
      return;
    }

    if (activeGuide === "import" && phase !== importGuideProgress?.phase) setImportPhase(phase);
  }, [
    activeGuide,
    bankPreview,
    cardPreview,
    completeGuideStepIndex,
    importGuideProgress?.phase,
    mappingState,
    pendingCardPath,
    pendingCommit,
    setImportPhase,
  ]);

  useEffect(() => {
    setPreviewMode("review");
    setLastChoice(undefined);
    setLastReviewChoice(undefined);
  }, [bankPreview?.sessionId, cardPreview?.sessionId]);

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
    setLearning(undefined);
    setLastChoice(undefined);
    setLastReviewChoice(undefined);
    setPendingCommit(undefined);
    setPreviewMode("review");
  }, []);

  const processImportPath = useCallback(
    async (path: string) => {
      if (!path || isReadingFile) return;
      setIsReadingFile(true);
      setIsDraggingFile(false);
      resetFlow();
      setMessage("");
      setCardCommitSummary(undefined);
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

  async function commitBank(confirmed = false) {
    if (!bankPreview) return;
    if (!confirmed && bankSummary.pending > 0) {
      setPendingCommit("bank");
      return;
    }
    setPendingCommit(undefined);
    const { count, batchId } = await api.commitImport(bankPreview.sessionId);
    await maybeSaveMappingProfile();
    setMessage(`${count} transações importadas com segurança.`);
    finishImportTutorial();
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

  async function commitCard(confirmed = false) {
    if (!cardPreview) return;
    if (!confirmed && cardSummary.pending > 0) {
      setPendingCommit("card");
      return;
    }
    setPendingCommit(undefined);
    const result = await api.commitCreditCardImport(cardPreview.sessionId);
    await maybeSaveMappingProfile();
    setCardCommitSummary(result);
    setMessage(
      result.paymentTransactionIds.length > 0
        ? "Fatura importada. Os pagamentos anteriores estão prontos para conciliação."
        : "Fatura importada. As compras já aparecem nas despesas pelas datas originais.",
    );
    finishImportTutorial();
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
      client.invalidateQueries({ queryKey: ["bootstrap"] }),
    ]);
  }

  function finishImportTutorial() {
    const importProgress = useQuickStartGuide.getState().guides.import;
    if (importProgress?.status !== "active" && importProgress?.status !== "paused") return;
    useQuickStartGuide.getState().setImportPhase("success");
  }

  function invalidateLastReviewChoice(kind: ReviewUndoChoice["kind"], sourceRows: number[]) {
    setLastReviewChoice((current) =>
      current?.kind === kind && current.sourceRows.some((sourceRow) => sourceRows.includes(sourceRow))
        ? undefined
        : current,
    );
  }

  async function changeBankCategory(sourceRow: number, categoryId?: string) {
    if (!bankPreview) return;
    const candidate = bankPreview.candidates.find((c) => c.sourceRow === sourceRow);
    const oldCategoryId = candidate?.suggestedCategoryId;
    await api.setImportCategory(bankPreview.sessionId, sourceRow, categoryId || undefined);
    invalidateLastReviewChoice("bank", [sourceRow]);
    const category = categories.find((item) => item.id === categoryId);

    if (categoryId && oldCategoryId !== categoryId && candidate) {
      setLastChoice({
        sourceRow,
        categoryId,
        pattern: suggestRulePattern(candidate.normalizedDescription || candidate.description),
        amountInCents: candidate.amountInCents,
        kind: "bank",
        count: 1,
      });
    } else if (!categoryId) {
      setLastChoice(undefined);
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
              suggestionSource: undefined,
            }
          : candidate,
      ),
    });
  }

  async function changeBankGroup(rows: number[], categoryId: string | undefined, representative: ImportCandidate) {
    if (!bankPreview) return;
    setBankPreview(await api.setImportCategories(bankPreview.sessionId, rows, categoryId));
    if (categoryId) {
      setLastReviewChoice({
        kind: "bank",
        sessionId: bankPreview.sessionId,
        groupKey: candidateGroupKey(representative),
        label: representative.merchantKey || representative.description,
        sourceRows: rows,
        representative,
      });
      setLastChoice({
        sourceRow: representative.sourceRow,
        categoryId,
        pattern: suggestRulePattern(representative.normalizedDescription || representative.description),
        amountInCents: representative.amountInCents,
        kind: "bank",
        count: rows.length,
      });
    } else {
      setLastReviewChoice(undefined);
      setLastChoice(undefined);
    }
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
      invalidateLastReviewChoice("bank", [sourceRow]);
    } catch (error: any) {
      setMessage(`Erro ao atualizar lançamento: ${error?.message || error}`);
    }
  }

  async function updateCard(sourceRow: number, included: boolean, categoryId?: string, dueDate?: string) {
    if (!cardPreview) return;

    const item = cardPreview.items.find((i) => i.candidate.sourceRow === sourceRow);
    const oldCategoryId = item?.candidate.suggestedCategoryId;
    const candidateEdited =
      Boolean(item) && (item?.included !== included || item?.candidate.suggestedCategoryId !== categoryId);

    setCardPreview(await api.updateCreditCardImport(cardPreview.sessionId, sourceRow, included, categoryId, dueDate));
    if (candidateEdited) invalidateLastReviewChoice("card", [sourceRow]);

    if (categoryId && oldCategoryId !== categoryId && item) {
      setLastChoice({
        sourceRow,
        categoryId,
        pattern: suggestRulePattern(item.candidate.normalizedDescription || item.candidate.description),
        amountInCents: item.candidate.amountInCents,
        kind: "card",
        count: 1,
      });
    } else if (!categoryId) {
      setLastChoice(undefined);
    }
  }

  async function changeCardGroup(rows: number[], categoryId: string | undefined, representative: ImportCandidate) {
    if (!cardPreview) return;
    setCardPreview(await api.updateCreditCardImportCategories(cardPreview.sessionId, rows, categoryId));
    if (categoryId) {
      setLastReviewChoice({
        kind: "card",
        sessionId: cardPreview.sessionId,
        groupKey: candidateGroupKey(representative),
        label: representative.merchantKey || representative.description,
        sourceRows: rows,
        representative,
      });
      setLastChoice({
        sourceRow: representative.sourceRow,
        categoryId,
        pattern: suggestRulePattern(representative.normalizedDescription || representative.description),
        amountInCents: representative.amountInCents,
        kind: "card",
        count: rows.length,
      });
    } else {
      setLastReviewChoice(undefined);
      setLastChoice(undefined);
    }
  }

  async function undoReviewChoice(choice: ReviewUndoChoice) {
    if (choice.kind === "bank") {
      if (!bankPreview || choice.sessionId !== bankPreview.sessionId) {
        throw new Error("A sessão de importação não está mais disponível.");
      }
      await changeBankGroup(choice.sourceRows, undefined, choice.representative);
      return;
    }
    if (!cardPreview || choice.sessionId !== cardPreview.sessionId) {
      throw new Error("A sessão de importação não está mais disponível.");
    }
    await changeCardGroup(choice.sourceRows, undefined, choice.representative);
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
      if (updates.length > 0) {
        setBankPreview(
          await api.setImportCategories(
            bankPreview.sessionId,
            updates.map((candidate) => candidate.sourceRow),
            learning.categoryId,
          ),
        );
      }
    }

    if (learning.kind === "card" && cardPreview) {
      const updates = cardPreview.items.filter(
        (i) =>
          !i.isPayment &&
          matchesLearning(i.candidate.normalizedDescription || i.candidate.description) &&
          i.candidate.suggestedCategoryId !== learning.categoryId,
      );
      if (updates.length > 0) {
        setCardPreview(
          await api.updateCreditCardImportCategories(
            cardPreview.sessionId,
            updates.map((item) => item.candidate.sourceRow),
            learning.categoryId,
          ),
        );
      }
    }

    setLearning(undefined);
    setLastChoice(undefined);
  }

  function setDraft(next: CsvMappingDraft) {
    setMappingState((current) => (current ? { ...current, draft: next } : current));
  }

  return (
    <section className="import-page" data-tutorial="import">
      <PageHeader>
        <div>
          <p className="eyebrow">IMPORTAÇÃO SEGURA</p>
          <h1>Importar extrato ou fatura</h1>
          <p className="muted">CSV, OFX e PDF são processados somente neste computador.</p>
        </div>
        <button className="secondary" type="button" onClick={() => restartGuide("import")}>
          <BookOpen size={16} /> Como importar
        </button>
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
          <button ref={chooseFileRef} data-import-tutorial="choose" onClick={choose} disabled={isReadingFile}>
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
          <div className="panel-title" data-import-tutorial="configure">
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
          <div className="card-import-form" data-import-tutorial="configure-card-review">
            <CardPicker
              label="Cartão"
              required
              tutorialTarget="configure-card"
              cards={cards}
              value={cardAccountId}
              onChange={setCardAccountId}
              onCreate={() => setCreatingCard(true)}
            />
            <label>
              Vencimento da fatura (caso não conste no arquivo)
              <DatePicker ariaLabel="Vencimento da fatura" value={cardDueDate} onChange={setCardDueDate} />
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
          <div className="panel-title" data-import-tutorial="configure">
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
                    <DatePicker
                      ariaLabel="Vencimento padrão da fatura"
                      value={mappingState.draft.defaultDueDate ?? ""}
                      onChange={(value) => setDraft({ ...mappingState.draft, defaultDueDate: value || undefined })}
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
        <article className="panel import-review-panel">
          <div className="panel-title" data-import-tutorial="review">
            <h2>Prévia de {bankPreview.fileName}</h2>
            <span>{bankPreview.candidates.length} registros</span>
          </div>
          <SuggestionSummary summary={bankSummary} />
          {lastChoice?.kind === "bank" && (
            <ChoiceNotice choice={lastChoice} onCreateRule={() => setLearning(lastChoice)} />
          )}
          <Tabs
            hidePanel
            value={previewMode}
            onChange={(value) => setPreviewMode(value as "review" | "all")}
            tabs={[
              { id: "review", label: `Revisar (${bankSummary.pending})` },
              { id: "all", label: `Todas (${bankPreview.candidates.length})` },
            ]}
          />
          {previewMode === "review" ? (
            <div role="tabpanel" aria-label="Lançamentos para revisar">
              <ImportReviewGroups
                key={bankPreview.sessionId}
                groups={bankGroups}
                categories={categories}
                onApply={(rows, categoryId, representative) => changeBankGroup(rows, categoryId, representative)}
                undoChoice={lastReviewChoice?.kind === "bank" ? lastReviewChoice : undefined}
                onUndo={undoReviewChoice}
              />
            </div>
          ) : (
            <div className="table-scroll" role="tabpanel" aria-label="Todos os lançamentos">
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
                          aria-label={`Incluir ${candidate.description}`}
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
                          kind={compatibleCategoryKinds(candidate, categories, false)}
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
          )}
          <div className="editor-actions">
            <button className="secondary" onClick={resetFlow}>
              Cancelar
            </button>
            <button
              data-import-tutorial="confirm"
              onClick={() => {
                setImportPhase("confirm");
                void commitBank();
              }}
            >
              Confirmar importação
            </button>
          </div>
        </article>
      )}

      {cardPreview && (
        <article className="panel import-review-panel">
          <div className="panel-title" data-import-tutorial="review">
            <div>
              <p className="eyebrow">FATURA DE CARTÃO</p>
              <h2>{cardPreview.fileName}</h2>
            </div>
            <label className="compact-label">
              Vencimento
              <DatePicker
                ariaLabel="Vencimento da fatura"
                value={cardPreview.dueDate}
                onChange={(value) =>
                  updateCard(
                    cardPreview.items[0].candidate.sourceRow,
                    cardPreview.items[0].included,
                    cardPreview.items[0].candidate.suggestedCategoryId,
                    value,
                  )
                }
              />
            </label>
          </div>
          <CreditCardImportTotals preview={cardPreview} />
          <SuggestionSummary summary={cardSummary} />
          {lastChoice?.kind === "card" && (
            <ChoiceNotice choice={lastChoice} onCreateRule={() => setLearning(lastChoice)} />
          )}
          <Tabs
            hidePanel
            value={previewMode}
            onChange={(value) => setPreviewMode(value as "review" | "all")}
            tabs={[
              { id: "review", label: `Revisar (${cardSummary.pending})` },
              { id: "all", label: `Todas (${cardPreview.items.length})` },
            ]}
          />
          {previewMode === "review" ? (
            <div role="tabpanel" aria-label="Itens da fatura para revisar">
              <ImportReviewGroups
                key={cardPreview.sessionId}
                groups={cardGroups}
                categories={categories}
                creditCard
                onApply={(rows, categoryId, representative) => changeCardGroup(rows, categoryId, representative)}
                undoChoice={lastReviewChoice?.kind === "card" ? lastReviewChoice : undefined}
                onUndo={undoReviewChoice}
              />
            </div>
          ) : (
            <div role="tabpanel" aria-label="Todos os itens da fatura">
              <CreditCardImportItems
                items={cardPreview.items}
                paymentsInCents={cardPreview.paymentsInCents}
                categories={categories}
                onUpdate={(sourceRow, included, categoryId) => updateCard(sourceRow, included, categoryId)}
              />
            </div>
          )}
          <div className="editor-actions">
            <button className="secondary" onClick={resetFlow}>
              Cancelar
            </button>
            <button
              data-import-tutorial="confirm"
              onClick={() => {
                setImportPhase("confirm");
                void commitCard();
              }}
            >
              Confirmar fatura
            </button>
          </div>
        </article>
      )}
      {message && (
        <p className="notice" data-import-tutorial="success">
          {message}
        </p>
      )}
      {cardCommitSummary && (
        <CardImportCommitNotice
          summary={cardCommitSummary}
          onReview={(paymentTransactionId) => navigate(cardPaymentReconciliationPath(paymentTransactionId))}
        />
      )}

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
        <Modal title="Criar regra para o futuro" onClose={() => setLearning(undefined)}>
          <div className="modal-form">
            <p className="muted">
              A escolha atual já será aprendida pelo histórico. Crie uma regra somente se este texto sempre tiver a
              mesma categoria.
            </p>
            <label>
              Descrição contém
              <input value={learning.pattern} onChange={(e) => setLearning({ ...learning, pattern: e.target.value })} />
            </label>
            <div className="editor-actions">
              <button className="secondary" onClick={() => setLearning(undefined)}>
                Cancelar
              </button>
              <button onClick={createRule}>Criar regra</button>
            </div>
          </div>
        </Modal>
      )}

      {pendingCommit && (
        <Modal title="Importar com categorias pendentes?" onClose={() => setPendingCommit(undefined)}>
          <div className="modal-form import-pending-dialog">
            <p className="muted">
              {pendingCommit === "bank" ? bankSummary.pending : cardSummary.pending} lançamentos incluídos ainda estão
              sem categoria. Você poderá categorizá-los depois em Transações.
            </p>
            <div className="editor-actions">
              <button className="secondary" onClick={() => setPendingCommit(undefined)}>
                Continuar revisando
              </button>
              <button onClick={() => void (pendingCommit === "bank" ? commitBank(true) : commitCard(true))}>
                Importar com pendências
              </button>
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
      <ImportTutorial
        configureKind={pendingCardPath ? "card" : mappingState ? "mapping" : undefined}
        hasCards={cards.length > 0}
        cardSelected={Boolean(cardAccountId)}
      />
    </section>
  );
}

type SuggestionSummaryData = {
  rule: number;
  history: number;
  manual: number;
  pending: number;
};

type CandidateGroup = {
  key: string;
  label: string;
  candidates: ImportCandidate[];
  suggestions: ImportCandidate["categorySuggestions"];
  totalInCents: number;
  isPix: boolean;
  isOwnAccountPix: boolean;
};

export function summarizeSuggestions(candidates: ImportCandidate[]): SuggestionSummaryData {
  return candidates
    .filter((candidate) => candidate.included && candidate.duplicateStatus !== "exact")
    .reduce<SuggestionSummaryData>(
      (summary, candidate) => {
        if (!candidate.suggestedCategoryId) summary.pending += 1;
        else if (candidate.suggestionSource === "rule") summary.rule += 1;
        else if (candidate.suggestionSource === "history") summary.history += 1;
        else summary.manual += 1;
        return summary;
      },
      { rule: 0, history: 0, manual: 0, pending: 0 },
    );
}

export function groupPendingCandidates(candidates: ImportCandidate[]): CandidateGroup[] {
  return groupCandidates(candidates, (candidate) => !candidate.suggestedCategoryId);
}

function candidateGroupKey(candidate: ImportCandidate): string {
  const direction = candidate.amountInCents >= 0 ? "credit" : "debit";
  const identity = candidate.merchantKey || candidate.normalizedDescription || candidate.description;
  return candidate.isPix ? `${identity}::${direction}::pix:${candidate.sourceRow}` : `${identity}::${direction}`;
}

function groupCandidates(
  candidates: ImportCandidate[],
  include: (candidate: ImportCandidate) => boolean,
): CandidateGroup[] {
  const groups = new Map<string, ImportCandidate[]>();
  for (const candidate of candidates) {
    if (!candidate.included || candidate.duplicateStatus === "exact" || !include(candidate)) continue;
    const key = candidateGroupKey(candidate);
    groups.set(key, [...(groups.get(key) ?? []), candidate]);
  }
  return [...groups.entries()]
    .map(([key, items]) => {
      const seen = new Set<string>();
      const suggestions = items
        .flatMap((candidate) => candidate.categorySuggestions)
        .filter((suggestion) => {
          if (seen.has(suggestion.categoryId)) return false;
          seen.add(suggestion.categoryId);
          return true;
        })
        .slice(0, 3);
      return {
        key,
        label: items[0].merchantKey || items[0].description,
        candidates: items,
        suggestions,
        totalInCents: items.reduce((total, candidate) => total + candidate.amountInCents, 0),
        isPix: Boolean(items[0].isPix),
        isOwnAccountPix: Boolean(items[0].isOwnAccountPix),
      };
    })
    .sort(
      (left, right) =>
        Number(right.suggestions.length > 0) - Number(left.suggestions.length > 0) ||
        right.candidates.length - left.candidates.length ||
        left.label.localeCompare(right.label, "pt-BR"),
    );
}

function compatibleCategoryKinds(
  candidate: ImportCandidate,
  categories: Category[],
  creditCard: boolean,
): CategoryKind[] {
  if (creditCard) return ["expense", "investment"];
  if (candidate.amountInCents < 0) return ["expense", "investment", "transfer"];
  const suggestedKinds = candidate.categorySuggestions
    .map((suggestion) => categories.find((category) => category.id === suggestion.categoryId)?.kind)
    .filter((kind): kind is CategoryKind => Boolean(kind));
  const looksLikeRefund = /estorno|reembolso|devolucao|devolução|credito compra|crédito compra/i.test(
    candidate.description,
  );
  return looksLikeRefund || suggestedKinds.some((kind) => kind === "expense" || kind === "investment")
    ? ["income", "expense", "investment", "transfer"]
    : ["income", "transfer"];
}

function readableError(reason: unknown): string {
  if (reason instanceof Error) return reason.message;
  if (typeof reason === "string") return reason;
  if (reason && typeof reason === "object" && "message" in reason) {
    const message = (reason as { message?: unknown }).message;
    if (typeof message === "string" && message.trim()) return message;
  }
  return "Erro inesperado";
}

function SuggestionSummary({ summary }: { summary: SuggestionSummaryData }) {
  const items = [
    { label: "Por regra", value: summary.rule, className: "rule" },
    { label: "Pelo histórico", value: summary.history, className: "history" },
    { label: "Escolhidas", value: summary.manual, className: "manual" },
    { label: "Para revisar", value: summary.pending, className: "pending" },
  ];
  return (
    <div className="import-suggestion-summary" aria-label="Resumo da categorização">
      {items.map((item) => (
        <div key={item.label} className={`import-suggestion-stat import-suggestion-stat--${item.className}`}>
          <span>{item.label}</span>
          <strong>{item.value}</strong>
        </div>
      ))}
    </div>
  );
}

function ChoiceNotice({ choice, onCreateRule }: { choice: LearningDraft; onCreateRule: () => void }) {
  return (
    <div className="import-choice-notice" role="status">
      <CheckCircle2 size={18} aria-hidden />
      <span>
        Categoria aplicada a {choice.count} {choice.count === 1 ? "lançamento" : "lançamentos"}. O histórico aprenderá
        quando você confirmar.
      </span>
      <button type="button" className="text-button" onClick={onCreateRule}>
        Criar regra
      </button>
    </div>
  );
}

export function ImportReviewGroups({
  groups,
  categories,
  creditCard = false,
  onApply,
  undoChoice,
  onUndo,
}: {
  groups: CandidateGroup[];
  categories: Category[];
  creditCard?: boolean;
  onApply: (rows: number[], categoryId: string, representative: ImportCandidate) => Promise<void>;
  undoChoice?: ReviewUndoChoice;
  onUndo?: (choice: ReviewUndoChoice) => Promise<void>;
}) {
  const [applyingKey, setApplyingKey] = useState<string>();
  const [undoing, setUndoing] = useState(false);
  const [activeKey, setActiveKey] = useState<string>();
  const [error, setError] = useState("");
  const [announcement, setAnnouncement] = useState("");
  const restoreFocus = useRef(false);
  const nextKeyAfterApply = useRef<string | undefined>(undefined);
  const returnKeyAfterUndo = useRef<string | undefined>(undefined);
  const queueKeys = useRef(groups.map((group) => group.key));
  const rootRef = useRef<HTMLDivElement>(null);
  const preservedScroll = useRef<{ element: HTMLElement; top: number; left: number } | undefined>(undefined);
  const busy = Boolean(applyingKey) || undoing;

  useEffect(() => {
    if (groups.length === 0) {
      setActiveKey(undefined);
      return;
    }

    if (returnKeyAfterUndo.current && groups.some((group) => group.key === returnKeyAfterUndo.current)) {
      const returnKey = returnKeyAfterUndo.current;
      returnKeyAfterUndo.current = undefined;
      nextKeyAfterApply.current = undefined;
      setActiveKey(returnKey);
      return;
    }
    if (activeKey && groups.some((group) => group.key === activeKey)) return;
    const nextKey =
      (nextKeyAfterApply.current && groups.some((group) => group.key === nextKeyAfterApply.current)
        ? nextKeyAfterApply.current
        : undefined) ?? groups[0].key;
    nextKeyAfterApply.current = undefined;
    setActiveKey(nextKey);
  }, [activeKey, groups]);

  useLayoutEffect(() => {
    if (!restoreFocus.current) return;
    const focusTarget = rootRef.current?.querySelector<HTMLElement>(
      groups.length === 0 ? ".import-review-ready" : ".import-review-group button",
    );
    if (!focusTarget) return;

    restoreFocus.current = false;
    const position = preservedScroll.current;
    preservedScroll.current = undefined;
    if (position?.element.isConnected) {
      position.element.scrollTop = position.top;
      position.element.scrollLeft = position.left;
    }
    focusTarget.focus({ preventScroll: true });
  }, [activeKey, groups.length]);

  const activeGroup = groups.find((group) => group.key === activeKey) ?? groups[0];
  const ownAccountTransferCategory = categories.find((category) => category.id === "transfers");
  const cardPaymentCategory = categories.find((category) => category.id === "credit-card-payment");
  const queuePosition = Math.max(0, queueKeys.current.indexOf(activeGroup?.key));
  const queueTotal = Math.max(queueKeys.current.length, groups.length);
  const pendingCandidates = groups.reduce((total, group) => total + group.candidates.length, 0);

  function preserveScrollPosition() {
    const element =
      rootRef.current?.closest<HTMLElement>(".window-frame__content") ??
      (document.scrollingElement as HTMLElement | null);
    if (!element) return;
    preservedScroll.current = {
      element,
      top: element.scrollTop,
      left: element.scrollLeft,
    };
  }

  async function apply(group: CandidateGroup, categoryId: string) {
    if (busy) return;
    preserveScrollPosition();
    const currentIndex = groups.findIndex((item) => item.key === group.key);
    const remainingGroups = groups.filter((item) => item.key !== group.key);
    nextKeyAfterApply.current = remainingGroups[Math.min(Math.max(currentIndex, 0), remainingGroups.length - 1)]?.key;
    setApplyingKey(group.key);
    setError("");
    restoreFocus.current = true;
    try {
      await onApply(
        group.candidates.map((candidate) => candidate.sourceRow),
        categoryId,
        group.candidates[0],
      );
      setAnnouncement(
        `${group.label} categorizado. ${group.candidates.length} ${
          group.candidates.length === 1 ? "lançamento resolvido" : "lançamentos resolvidos"
        }.`,
      );
    } catch (reason) {
      nextKeyAfterApply.current = undefined;
      restoreFocus.current = false;
      preservedScroll.current = undefined;
      setError(`Não foi possível aplicar a categoria: ${readableError(reason)}`);
    } finally {
      setApplyingKey(undefined);
    }
  }

  async function undoLastChoice() {
    if (!undoChoice || !onUndo || busy) return;
    preserveScrollPosition();
    returnKeyAfterUndo.current = undoChoice.groupKey;
    setUndoing(true);
    setError("");
    restoreFocus.current = true;
    try {
      await onUndo(undoChoice);
      setAnnouncement(`${undoChoice.label} voltou para revisão. Escolha a categoria novamente.`);
    } catch (reason) {
      returnKeyAfterUndo.current = undefined;
      restoreFocus.current = false;
      preservedScroll.current = undefined;
      setError(`Não foi possível voltar à escolha anterior: ${readableError(reason)}`);
    } finally {
      setUndoing(false);
    }
  }

  return (
    <div className="import-review-groups" ref={rootRef} aria-busy={busy}>
      {groups.length === 0 ? (
        <div className="import-review-ready" tabIndex={-1}>
          <CheckCircle2 size={24} aria-hidden />
          <div>
            <strong>Tudo pronto para confirmar</strong>
            <p>Não há lançamentos incluídos aguardando categoria.</p>
          </div>
          {undoChoice && onUndo && (
            <button type="button" className="secondary import-review-undo" disabled={busy} onClick={undoLastChoice}>
              <ChevronLeft size={17} aria-hidden />
              {undoing ? "Voltando…" : "Voltar à escolha anterior"}
            </button>
          )}
        </div>
      ) : (
        <div className="import-review-intro">
          <Lightbulb size={18} aria-hidden />
          <div>
            <strong>Uma etapa por vez</strong>
            <p>
              Escolha uma categoria por estabelecimento. Cada PIX é revisado separadamente para evitar categorizações
              indevidas.
            </p>
          </div>
          <span className="import-review-intro-hint">Sugestões agilizam a revisão</span>
        </div>
      )}
      {error && (
        <p className="form-error import-review-error" role="alert">
          {error}
        </p>
      )}
      <p className="import-review-announcement" aria-live="polite">
        {announcement}
      </p>
      {activeGroup && (
        <div className="import-review-queue" role="region" aria-label="Fila guiada de revisão">
          <div className="import-review-queue-header">
            <div>
              <span className="import-review-action-label">Etapa atual</span>
              <strong>
                Grupo {queuePosition + 1} de {queueTotal}
              </strong>
              <small>
                {pendingCandidates} {pendingCandidates === 1 ? "lançamento" : "lançamentos"} pendentes · escolha uma vez
              </small>
            </div>
          </div>
          <div
            className="import-review-queue-track"
            role="progressbar"
            aria-label="Posição na fila de revisão"
            aria-valuemin={1}
            aria-valuemax={queueTotal}
            aria-valuenow={queuePosition + 1}
          >
            <i style={{ width: `${((queuePosition + 1) / queueTotal) * 100}%` }} />
          </div>
          <article
            className="import-review-group"
            key={activeGroup.key}
            tabIndex={-1}
            data-group-key={activeGroup.key}
            aria-labelledby="import-review-active-title"
          >
            {undoChoice && onUndo && (
              <div className="import-review-undo-row">
                <button type="button" className="secondary" disabled={busy} onClick={undoLastChoice}>
                  <ChevronLeft size={17} aria-hidden />
                  {undoing ? "Voltando…" : "Voltar à escolha anterior"}
                </button>
              </div>
            )}
            <div className="import-review-group-main">
              <div className="import-review-group-heading">
                <span>{activeGroup.isPix ? "LANÇAMENTO PIX" : "ESTABELECIMENTO"}</span>
                <h3 id="import-review-active-title">{activeGroup.label}</h3>
                <p className="import-review-group-summary">
                  {activeGroup.candidates.length} {activeGroup.candidates.length === 1 ? "lançamento" : "lançamentos"} ·{" "}
                  <strong>{money(activeGroup.totalInCents)}</strong>
                </p>
              </div>
              <div
                className={`import-review-group-actions${
                  activeGroup.suggestions.length === 0 ? " import-review-group-actions--manual-only" : ""
                }`}
              >
                {activeGroup.isOwnAccountPix && !creditCard && (
                  <div className="own-account-pix-guidance">
                    <div>
                      <span className="import-review-action-label">PIX PARA OUTRA CONTA SUA</span>
                      <strong>Como você quer representar esse caminho?</strong>
                      <p>
                        Se a outra conta também está no Lumen, use Transferência nas duas pontas e vincule-as após a
                        importação. Se ela foi apenas uma ponte e não será acompanhada, marque este valor como pagamento
                        de fatura.
                      </p>
                    </div>
                    <div className="own-account-pix-guidance__actions">
                      {ownAccountTransferCategory && (
                        <button
                          type="button"
                          className="secondary"
                          disabled={busy}
                          onClick={() => void apply(activeGroup, ownAccountTransferCategory.id)}
                        >
                          <CategoryIcon
                            name={ownAccountTransferCategory.icon}
                            kind={ownAccountTransferCategory.kind}
                            size={16}
                          />
                          Transferência entre minhas contas
                        </button>
                      )}
                      {cardPaymentCategory && (
                        <button
                          type="button"
                          className="secondary"
                          disabled={busy}
                          onClick={() => void apply(activeGroup, cardPaymentCategory.id)}
                        >
                          <CategoryIcon name={cardPaymentCategory.icon} kind={cardPaymentCategory.kind} size={16} />
                          Pagamento de fatura
                        </button>
                      )}
                    </div>
                  </div>
                )}
                {activeGroup.suggestions.length > 0 && (
                  <div className="import-review-quick-actions">
                    <>
                      <div className="import-review-action-heading">
                        <span className="import-review-action-label">Sugestões plausíveis</span>
                        <small>
                          {activeGroup.isPix ? "Escolha para este PIX" : "Aplicam-se a todos os lançamentos do grupo"}
                        </small>
                      </div>
                      <div className="import-suggestion-chips">
                        {activeGroup.suggestions.map((suggestion) => {
                          const category = categories.find((item) => item.id === suggestion.categoryId);
                          return (
                            <button
                              type="button"
                              className="secondary import-suggestion-chip"
                              data-kind={category?.kind}
                              key={suggestion.categoryId}
                              title={suggestion.reason}
                              disabled={busy}
                              aria-label={`Aplicar ${suggestion.categoryName} a ${activeGroup.candidates.length} ${
                                activeGroup.candidates.length === 1 ? "lançamento" : "lançamentos"
                              } de ${activeGroup.label}. ${suggestion.reason}`}
                              onClick={() => void apply(activeGroup, suggestion.categoryId)}
                            >
                              <span className="import-suggestion-chip-heading">
                                <span
                                  className="import-suggestion-chip-icon"
                                  style={category?.color ? { color: category.color } : undefined}
                                >
                                  <CategoryIcon name={category?.icon} kind={category?.kind} size={16} />
                                </span>
                                <span>{applyingKey === activeGroup.key ? "Aplicando…" : suggestion.categoryName}</span>
                              </span>
                              <small>
                                <strong>
                                  {activeGroup.isPix
                                    ? "Aplicar a este PIX"
                                    : `Aplicar a ${activeGroup.candidates.length}`}
                                </strong>{" "}
                                · {suggestion.reason}
                              </small>
                            </button>
                          );
                        })}
                      </div>
                    </>
                  </div>
                )}
                <div className="import-review-category-picker">
                  <div className="import-review-action-heading">
                    <span className="import-review-action-label">
                      {activeGroup.suggestions.length === 0 ? "Escolha uma categoria" : "Todas as categorias"}
                    </span>
                    <small>
                      {activeGroup.suggestions.length === 0
                        ? "Sem sugestão segura — procure na lista completa"
                        : "Ou procure outra opção"}
                    </small>
                  </div>
                  <CategorySelect
                    categories={categories}
                    kind={compatibleCategoryKinds(activeGroup.candidates[0], categories, creditCard)}
                    allowEmpty={false}
                    emptyLabel="Escolher categoria"
                    disabled={busy}
                    aria-label={`Escolher categoria para ${activeGroup.label}`}
                    onChange={(categoryId) => categoryId && void apply(activeGroup, categoryId)}
                  />
                </div>
              </div>
            </div>
            <details className="import-review-details">
              <summary>
                {activeGroup.candidates.length === 1
                  ? "Detalhes do lançamento"
                  : `${activeGroup.candidates.length} lançamentos deste grupo`}
              </summary>
              <div>
                {activeGroup.candidates.map((candidate) => (
                  <div className="import-review-detail-row" key={candidate.sourceRow}>
                    <span>{candidate.date}</span>
                    <span>{candidate.description}</span>
                    <strong>{money(candidate.amountInCents)}</strong>
                  </div>
                ))}
              </div>
            </details>
          </article>
          <p className="import-review-queue-hint">
            Ao categorizar, o próximo grupo entra em foco automaticamente. Use “Voltar à escolha anterior” se precisar
            corrigir o último grupo ou “Todas” para ajustar um lançamento isolado.
          </p>
        </div>
      )}
    </div>
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
  tutorialTarget,
}: {
  label: string;
  cards: { id: string; name: string }[];
  value: string;
  onChange: (id: string) => void;
  onCreate: () => void;
  required?: boolean;
  tutorialTarget?: string;
}) {
  const empty = cards.length === 0;
  return (
    <div className="card-picker" data-import-tutorial={tutorialTarget}>
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
