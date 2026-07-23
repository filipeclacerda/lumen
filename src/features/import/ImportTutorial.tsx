import { createPortal } from "react-dom";
import { useEffect, useLayoutEffect, useState, type CSSProperties } from "react";
import { CheckCircle2, FileSearch, FileUp, ListChecks, Settings2, X } from "lucide-react";
import { useNavigate } from "react-router-dom";
import {
  useQuickStartGuide,
  type ImportGuidePhase,
  type QuickStartGuideId,
  type QuickStartGuideMode,
  type QuickStartGuideStatus,
} from "../../shared/quickStartGuide";

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
    title: "Escolha seu arquivo",
    description: "Use um extrato ou uma fatura em CSV, OFX ou PDF. Tudo é processado somente neste computador.",
    icon: FileUp,
  },
  configure: {
    target: '[data-import-tutorial="configure"]',
    title: "Confira a configuração",
    description: "Escolha o destino e, quando necessário, indique como as colunas do arquivo devem ser interpretadas.",
    icon: Settings2,
  },
  review: {
    target: '[data-import-tutorial="review"]',
    title: "Revise antes de salvar",
    description: "Confira os lançamentos, categorias e duplicidades. Nada é gravado antes da sua confirmação.",
    icon: FileSearch,
  },
  confirm: {
    target: '[data-import-tutorial="confirm"]',
    title: "Confirme a importação",
    description: "Quando estiver satisfeito com a prévia, confirme para salvar os lançamentos de uma só vez.",
    icon: ListChecks,
  },
  success: {
    target: '[data-import-tutorial="success"]',
    title: "Importação concluída",
    description: "Seus lançamentos já estão disponíveis no Lumen.",
    icon: CheckCircle2,
  },
};

type TargetRect = Pick<CSSProperties, "top" | "left" | "width" | "height" | "borderRadius">;

export function ImportTutorial() {
  const navigate = useNavigate();
  const { activeGuide, guides, pause, dismiss, complete } = useQuickStartGuide();
  const phase = guides.import?.phase ?? "choose";
  const content = phaseContent[phase];
  const [targetRect, setTargetRect] = useState<TargetRect>();
  const [portalHost, setPortalHost] = useState<HTMLElement | null>(null);

  useLayoutEffect(() => {
    setPortalHost(document.getElementById("tutorial-host"));
  }, []);

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

  useLayoutEffect(() => {
    if (activeGuide !== "import") {
      setTargetRect(undefined);
      return;
    }

    const update = () => {
      const target = document.querySelector(content.target);
      if (!target) {
        setTargetRect(undefined);
        return;
      }
      const rect = target.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0 || rect.bottom <= 0 || rect.top >= window.innerHeight) {
        setTargetRect(undefined);
        return;
      }
      const borderRadius = window.getComputedStyle(target).borderRadius;
      setTargetRect({
        top: rect.top,
        left: rect.left,
        width: rect.width,
        height: rect.height,
        borderRadius: borderRadius === "0px" ? "var(--radius-lg)" : borderRadius,
      });
    };

    const observer = new MutationObserver(update);
    observer.observe(document.body, { childList: true, subtree: true });
    document.addEventListener("scroll", update, true);
    window.addEventListener("resize", update);
    update();
    return () => {
      observer.disconnect();
      document.removeEventListener("scroll", update, true);
      window.removeEventListener("resize", update);
    };
  }, [activeGuide, content.target, portalHost]);

  if (activeGuide !== "import") return null;
  const Icon = content.icon;
  return createPortal(
    <>
      {targetRect && <div className="quick-start-guide__highlight" aria-hidden="true" style={targetRect} />}
      <aside
        className={`quick-start-guide import-tutorial${portalHost ? " is-docked" : ""}`}
        role="region"
        aria-live="polite"
        aria-labelledby="import-tutorial-title"
        aria-describedby="import-tutorial-description"
      >
        <div className="quick-start-guide__header">
          <div className="quick-start-guide__icon" aria-hidden="true">
            <Icon size={19} />
          </div>
          <div>
            <span>AJUDA DE IMPORTAÇÃO</span>
            <h2 id="import-tutorial-title">{content.title}</h2>
          </div>
          <button
            className="icon-button"
            type="button"
            aria-label="Pausar ajuda de importação"
            onClick={() => pause("import")}
          >
            <X size={16} />
          </button>
        </div>
        <p id="import-tutorial-description">{content.description}</p>
        <div className="quick-start-guide__actions">
          {phase === "success" ? (
            <>
              <button className="text-button" type="button" onClick={() => complete("import")}>
                Fechar
              </button>
              <button
                type="button"
                onClick={() => {
                  complete("import");
                  navigate("/transactions");
                }}
              >
                Ver transações
              </button>
            </>
          ) : (
            <>
              <button className="text-button" type="button" onClick={() => dismiss("import")}>
                Sair do tutorial
              </button>
              <button className="secondary" type="button" onClick={() => pause("import")}>
                Continuar sem ajuda
              </button>
            </>
          )}
        </div>
      </aside>
    </>,
    portalHost ?? document.body,
  );
}
