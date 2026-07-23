import { CheckCircle2, FileSearch, FileUp, ListChecks, Settings2, X } from "lucide-react";
import { useEffect, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import {
  useQuickStartGuide,
  type ImportGuidePhase,
  type QuickStartGuideId,
  type QuickStartGuideMode,
  type QuickStartGuideStatus,
} from "../../shared/quickStartGuide";
import { GuideCoachmark } from "../../shared/ui/GuideCoachmark";

export function shouldAutoStartImportGuide({
  hasImports,
  importStatus,
  completeStatus,
  activeGuide,
  mode = "closed",
}: {
  hasImports: boolean;
  importStatus?: QuickStartGuideStatus;
  completeStatus: QuickStartGuideStatus;
  activeGuide: QuickStartGuideId | null;
  mode?: QuickStartGuideMode;
}) {
  return (
    !hasImports &&
    importStatus !== "completed" &&
    importStatus !== "dismissed" &&
    mode !== "invitation" &&
    activeGuide !== "complete" &&
    completeStatus !== "active"
  );
}

const phaseContent: Record<
  ImportGuidePhase,
  {
    target: string;
    title: string;
    description: string;
    icon: typeof FileUp;
  }
> = {
  choose: {
    target: '[data-import-tutorial="choose"]',
    title: "Comece pelo arquivo exportado",
    description:
      "Selecione um CSV, OFX ou PDF exportado pelo banco ou cartão. O arquivo é processado neste computador e nenhum lançamento é salvo antes da sua confirmação.",
    icon: FileUp,
  },
  configure: {
    target: '[data-import-tutorial="configure"]',
    title: "Confirme como o arquivo será lido",
    description:
      "Escolha a conta ou o cartão de destino e confira data, descrição e valor. A prévia aparece quando os campos obrigatórios estiverem completos.",
    icon: Settings2,
  },
  review: {
    target: '[data-import-tutorial="review"]',
    title: "Revise o que vai entrar",
    description:
      "Confira lançamentos, categorias, itens excluídos e duplicidades. As correções feitas aqui ainda não alteram seu histórico.",
    icon: FileSearch,
  },
  confirm: {
    target: '[data-import-tutorial="confirm"]',
    title: "Confirme só depois da conferência",
    description:
      "O Lumen importa apenas os itens incluídos. Ele avisa sobre lançamentos sem categoria e não grava duplicatas identificadas.",
    icon: ListChecks,
  },
  success: {
    target: '[data-import-tutorial="success"]',
    title: "Importação concluída",
    description: "Seus lançamentos já estão no Lumen. Agora faça a revisão fina em Transações.",
    icon: CheckCircle2,
  },
};

export function ImportTutorial() {
  const navigate = useNavigate();
  const { activeGuide, guides, pause, dismiss, complete, goToStep } = useQuickStartGuide();
  const phase = guides.import?.phase ?? "choose";
  const content = phaseContent[phase];

  useEffect(() => {
    if (activeGuide !== "import") return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      pause("import");
    };
    document.addEventListener("keydown", onKeyDown, true);
    return () => document.removeEventListener("keydown", onKeyDown, true);
  }, [activeGuide, pause]);

  if (activeGuide !== "import") return null;
  const Icon = content.icon;

  const continueToTransactions = () => {
    complete("import");
    goToStep(1);
    navigate("/transactions");
  };

  return (
    <GuideCoachmark
      active
      target={content.target}
      className="import-tutorial"
      role="region"
      labelledBy="import-tutorial-title"
      describedBy="import-tutorial-description"
      focusKey={phase}
    >
      {(positionControl: ReactNode) => (
        <>
          <div className="quick-start-guide__header">
            <div className="quick-start-guide__icon" aria-hidden="true">
              <Icon size={19} />
            </div>
            <div>
              <span>AJUDA DE IMPORTAÇÃO</span>
              <h2 id="import-tutorial-title">{content.title}</h2>
            </div>
            <div className="quick-start-guide__header-actions">
              {positionControl}
              <button
                className="icon-button"
                type="button"
                aria-label="Pausar ajuda de importação"
                title="Pausar ajuda de importação"
                onClick={() => pause("import")}
              >
                <X size={16} />
              </button>
            </div>
          </div>
          <p id="import-tutorial-description">{content.description}</p>
          <div className="quick-start-guide__actions">
            {phase === "success" ? (
              <>
                <button className="text-button" type="button" onClick={() => complete("import")}>
                  Fechar
                </button>
                <button type="button" onClick={continueToTransactions}>
                  Ver transações
                </button>
              </>
            ) : (
              <>
                <button className="text-button" type="button" onClick={() => dismiss("import")}>
                  Encerrar ajuda
                </button>
                <button className="secondary" type="button" onClick={() => pause("import")}>
                  Pausar ajuda
                </button>
              </>
            )}
          </div>
        </>
      )}
    </GuideCoachmark>
  );
}
