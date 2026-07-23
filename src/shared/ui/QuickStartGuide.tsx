import {
  BarChart3,
  Check,
  ChevronLeft,
  ChevronRight,
  FileUp,
  LayoutDashboard,
  ListChecks,
  Settings,
  Sparkles,
  X,
} from "lucide-react";
import { useEffect, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { useQuickStartGuide } from "../quickStartGuide";
import { GuideCoachmark } from "./GuideCoachmark";

const steps = [
  {
    route: "/import",
    target: '[data-import-tutorial="choose"]',
    title: "Comece pelo arquivo exportado",
    description:
      "Selecione um CSV, OFX ou PDF exportado pelo banco ou cartão. O arquivo é processado neste computador e nenhum lançamento é salvo antes da sua confirmação.",
    icon: FileUp,
  },
  {
    route: "/transactions",
    target: '[data-quick-guide="transactions-filters"]',
    title: "Corrija e encontre pendências",
    description:
      "Use busca e filtros para localizar lançamentos. A categoria pode ser alterada diretamente; padrões recorrentes podem ser automatizados em Categorias e regras.",
    icon: ListChecks,
  },
  {
    route: "/",
    target: '[data-quick-guide="overview"]',
    title: "Leia um mês de cada vez",
    description:
      "Confira receitas, despesas, investimentos e saldo do mês selecionado. O navegador de período atualiza todos os indicadores.",
    icon: LayoutDashboard,
  },
  {
    route: "/reports",
    target: '[data-quick-guide="reports-filters"]',
    title: "Compare usando o mesmo recorte",
    description:
      "Defina período, conta e origem antes de comparar totais e categorias. Pontos de atenção levam às pendências que precisam de revisão.",
    icon: BarChart3,
  },
  {
    route: "/settings?section=data",
    target: '[data-quick-guide="backup"]',
    title: "Proteja seu histórico local",
    description:
      "Crie um backup após importar e antes de mudanças importantes. O banco e os backups ainda não são criptografados; proteja o computador e o arquivo.",
    icon: Settings,
  },
] as const;

export function QuickStartGuide({ hasTransactions }: { hasTransactions: boolean }) {
  const navigate = useNavigate();
  const { activeGuide, mode, guides, resume, goToStep, pause, dismiss, complete } = useQuickStartGuide();
  const stepIndex = Math.min(guides.complete.stepIndex, steps.length - 1);
  const step = steps[stepIndex];
  const invitation = mode === "invitation";
  const visible = mode !== "closed" && (invitation || activeGuide === "complete");

  useEffect(() => {
    if (mode !== "tour" || activeGuide !== "complete") return;
    navigate(step.route);
  }, [activeGuide, mode, navigate, step.route]);

  useEffect(() => {
    if (!visible) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      pause("complete");
    };
    document.addEventListener("keydown", onKeyDown, true);
    return () => document.removeEventListener("keydown", onKeyDown, true);
  }, [pause, visible]);

  useEffect(() => {
    document.body.classList.toggle("quick-start-guide-active", mode === "tour" && activeGuide === "complete");
    return () => document.body.classList.remove("quick-start-guide-active");
  }, [activeGuide, mode]);

  if (!visible) return null;

  const Icon = invitation ? Sparkles : step.icon;
  const title = invitation
    ? stepIndex > 0
      ? "Continue de onde parou"
      : "Aprenda com seus próprios dados"
    : step.title;
  const description = invitation
    ? stepIndex > 0
      ? `Retome a orientação na etapa ${stepIndex + 1} de ${steps.length}.`
      : "O guia acompanha sua primeira importação, a revisão dos lançamentos e a leitura do mês. Você pode pausar a qualquer momento."
    : step.description;

  const startOrResume = () => resume("complete");

  const startImport = () => {
    resume("import");
    navigate("/import?action=choose");
  };

  return (
    <GuideCoachmark
      active
      target={invitation ? undefined : step.target}
      labelledBy="quick-start-guide-title"
      describedBy="quick-start-guide-description"
      focusKey={`${mode}-${stepIndex}`}
      focusOnOpen
    >
      {(positionControl: ReactNode) => (
        <>
          <div className="quick-start-guide__header">
            <div className="quick-start-guide__icon" aria-hidden="true">
              <Icon size={19} />
            </div>
            <div>
              {!invitation && (
                <span>
                  Etapa {stepIndex + 1} de {steps.length}
                </span>
              )}
              <h2 id="quick-start-guide-title">{title}</h2>
            </div>
            <div className="quick-start-guide__header-actions">
              {positionControl}
              <button
                className="icon-button"
                type="button"
                aria-label="Pausar tutorial"
                title="Pausar tutorial"
                onClick={() => pause("complete")}
              >
                <X size={16} />
              </button>
            </div>
          </div>
          <p id="quick-start-guide-description">{description}</p>
          {!invitation && (
            <div
              className="quick-start-guide__progress"
              aria-label={`Etapa ${stepIndex + 1} de ${steps.length}`}
              style={{ gridTemplateColumns: `repeat(${steps.length}, minmax(0, 1fr))` }}
            >
              {steps.map((item, index) => (
                <i key={item.route} className={index <= stepIndex ? "is-active" : ""} />
              ))}
            </div>
          )}
          <div className="quick-start-guide__actions">
            <button
              className="text-button"
              type="button"
              onClick={() => (invitation ? pause("complete") : dismiss("complete"))}
            >
              {invitation ? "Agora não" : "Encerrar tutorial"}
            </button>
            {invitation ? (
              <button type="button" onClick={startOrResume}>
                {stepIndex > 0 ? "Continuar" : "Começar"} <ChevronRight size={16} />
              </button>
            ) : stepIndex === 0 && !hasTransactions ? (
              <button type="button" onClick={startImport}>
                Começar importação <ChevronRight size={16} />
              </button>
            ) : (
              <div>
                <button
                  className="secondary"
                  type="button"
                  onClick={() => goToStep(stepIndex - 1)}
                  disabled={stepIndex === 0}
                >
                  <ChevronLeft size={16} /> Voltar
                </button>
                {stepIndex === steps.length - 1 ? (
                  <button type="button" onClick={() => complete("complete")}>
                    Concluir <Check size={16} />
                  </button>
                ) : (
                  <button type="button" onClick={() => goToStep(stepIndex + 1)}>
                    Avançar <ChevronRight size={16} />
                  </button>
                )}
              </div>
            )}
          </div>
        </>
      )}
    </GuideCoachmark>
  );
}
