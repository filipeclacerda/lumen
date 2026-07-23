import { createPortal } from "react-dom";
import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import {
  BarChart3,
  Check,
  ChevronLeft,
  ChevronRight,
  CreditCard,
  FileUp,
  LayoutDashboard,
  Repeat,
  Settings,
  Sparkles,
  Tags,
  Wallet,
  WalletCards,
  X,
} from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useQuickStartGuide } from "../quickStartGuide";

type TargetRect = { top: number; left: number; width: number; height: number; borderRadius: string };

const steps = [
  {
    route: "/import",
    target: '[data-tutorial="import"]',
    title: "Importe seu histórico",
    description: "Importe CSV, OFX ou PDF. Você revisa tudo antes de confirmar.",
    icon: FileUp,
  },
  {
    route: "/transactions",
    target: '[data-tutorial="transactions"]',
    title: "Organize suas transações",
    description: "Consulte lançamentos, ajuste categorias e registre receitas ou despesas manualmente.",
    icon: CreditCard,
  },
  {
    route: "/accounts",
    target: '[data-tutorial="accounts"]',
    title: "Acompanhe contas e cartões",
    description: "Mantenha saldos, limites e faturas organizados em um só lugar.",
    icon: WalletCards,
  },
  {
    route: "/recurring",
    target: '[data-tutorial="recurring"]',
    title: "Planeje recorrências",
    description: "Cadastre compromissos frequentes para não perder receitas e despesas futuras.",
    icon: Repeat,
  },
  {
    route: "/budget",
    target: '[data-tutorial="budget"]',
    title: "Defina seu orçamento",
    description: "Estabeleça limites por categoria e acompanhe o consumo ao longo do mês.",
    icon: Wallet,
  },
  {
    route: "/categories",
    target: '[data-tutorial="categories"]',
    title: "Personalize categorias e regras",
    description: "Organize seus lançamentos e automatize classificações que se repetem.",
    icon: Tags,
  },
  {
    route: "/",
    target: '[data-tutorial="overview"]',
    title: "Acompanhe sua visão geral",
    description: "Veja receitas, despesas, saldo e o ritmo financeiro do período.",
    icon: LayoutDashboard,
  },
  {
    route: "/reports",
    target: '[data-tutorial="reports"]',
    title: "Explore seus relatórios",
    description: "Compare períodos e entenda como seu dinheiro se distribui.",
    icon: BarChart3,
  },
  {
    route: "/settings",
    target: '[data-tutorial="settings"]',
    title: "Proteja seus dados",
    description: "Em Configurações, crie backups e ajuste o Lumen às suas preferências.",
    icon: Settings,
  },
] as const;

function visibleRect(element: Element): TargetRect | undefined {
  const rect = element.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0 || rect.bottom <= 0 || rect.top >= window.innerHeight) return undefined;
  const borderRadius = window.getComputedStyle(element).borderRadius;
  return {
    top: rect.top,
    left: rect.left,
    width: rect.width,
    height: rect.height,
    borderRadius: borderRadius === "0px" ? "var(--radius-lg)" : borderRadius,
  };
}

export function QuickStartGuide() {
  const navigate = useNavigate();
  const { activeGuide, mode, guides, resume, goToStep, pause, dismiss, complete } = useQuickStartGuide();
  const stepIndex = guides.complete.stepIndex;
  const [targetRect, setTargetRect] = useState<TargetRect>();
  const [cardPosition, setCardPosition] = useState<CSSProperties>();
  const cardRef = useRef<HTMLElement>(null);
  const scrolledStep = useRef<number | undefined>(undefined);
  const step = steps[stepIndex];

  useLayoutEffect(() => {
    document.body.classList.toggle("quick-start-guide-active", mode === "tour");
    return () => document.body.classList.remove("quick-start-guide-active");
  }, [mode]);

  useEffect(() => {
    if (mode !== "tour" || activeGuide !== "complete") return;
    navigate(step.route);
  }, [activeGuide, mode, navigate, step.route]);

  useEffect(() => {
    if (mode === "closed" || (mode === "tour" && activeGuide !== "complete")) return;
    cardRef.current?.focus({ preventScroll: true });
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      pause("complete");
    };
    document.addEventListener("keydown", onKeyDown, true);
    return () => document.removeEventListener("keydown", onKeyDown, true);
  }, [activeGuide, mode, pause, stepIndex]);

  useLayoutEffect(() => {
    if (mode !== "tour" || activeGuide !== "complete") {
      setTargetRect(undefined);
      setCardPosition(undefined);
      return;
    }

    let target: Element | null = null;
    let resizeObserver: ResizeObserver | undefined;
    const update = () => {
      const nextTarget = document.querySelector(step.target);
      if (nextTarget !== target) {
        resizeObserver?.disconnect();
        target = nextTarget;
        if (target && typeof ResizeObserver !== "undefined") {
          resizeObserver = new ResizeObserver(update);
          resizeObserver.observe(target);
        }
        if (target && scrolledStep.current !== stepIndex) {
          scrolledStep.current = stepIndex;
          const reduceMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
          target.scrollIntoView({ behavior: reduceMotion ? "auto" : "smooth", block: "center" });
        }
      }
      const rect = target ? visibleRect(target) : undefined;
      setTargetRect(rect);
      if (!rect || window.innerWidth <= 850 || !cardRef.current) {
        setCardPosition(undefined);
        return;
      }

      const card = cardRef.current.getBoundingClientRect();
      const gap = 14;
      const edge = 16;
      let left = rect.left + rect.width + gap;
      let top = rect.top;
      if (left + card.width > window.innerWidth - edge) left = rect.left - card.width - gap;
      if (left < edge) {
        left = Math.min(Math.max(rect.left, edge), window.innerWidth - card.width - edge);
        top = rect.top + rect.height + gap;
        if (top + card.height > window.innerHeight - edge) top = rect.top - card.height - gap;
      }
      setCardPosition({
        left: Math.max(edge, Math.min(left, window.innerWidth - card.width - edge)),
        top: Math.max(edge, Math.min(top, window.innerHeight - card.height - edge)),
        right: "auto",
        bottom: "auto",
      });
    };

    const mutationObserver = new MutationObserver(update);
    mutationObserver.observe(document.body, { childList: true, subtree: true });
    document.addEventListener("animationend", update, true);
    document.addEventListener("scroll", update, true);
    window.addEventListener("resize", update);
    update();

    return () => {
      mutationObserver.disconnect();
      resizeObserver?.disconnect();
      document.removeEventListener("animationend", update, true);
      document.removeEventListener("scroll", update, true);
      window.removeEventListener("resize", update);
    };
  }, [activeGuide, mode, step.target, stepIndex]);

  if (mode === "closed" || (mode === "tour" && activeGuide !== "complete")) return null;

  const invitation = mode === "invitation";
  const Icon = invitation ? Sparkles : step.icon;
  const title = invitation ? (stepIndex > 0 ? "Continue conhecendo o Lumen" : "Conheça o essencial") : step.title;
  const description = invitation
    ? stepIndex > 0
      ? `Retome o tutorial completo na etapa ${stepIndex + 1} de 9.`
      : "Veja em 9 passos como adicionar, organizar e acompanhar seu dinheiro."
    : step.description;

  return createPortal(
    <>
      {!invitation && targetRect && (
        <div
          className="quick-start-guide__highlight"
          aria-hidden="true"
          style={{
            top: targetRect.top,
            left: targetRect.left,
            width: targetRect.width,
            height: targetRect.height,
            borderRadius: targetRect.borderRadius,
          }}
        />
      )}
      <section
        ref={cardRef}
        className={`quick-start-guide${invitation ? " is-invitation" : ""}`}
        style={cardPosition}
        role="dialog"
        aria-modal="false"
        aria-labelledby="quick-start-guide-title"
        aria-describedby="quick-start-guide-description"
        tabIndex={-1}
      >
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
          <button className="icon-button" type="button" aria-label="Pausar guia" onClick={() => pause("complete")}>
            <X size={16} />
          </button>
        </div>
        <p id="quick-start-guide-description">{description}</p>
        {!invitation && (
          <div
            className="quick-start-guide__progress"
            aria-label={`Etapa ${stepIndex + 1} de ${steps.length}`}
            style={{ gridTemplateColumns: `repeat(${steps.length}, minmax(0, 1fr))` }}
          >
            {steps.map((item, index) => (
              <i key={`${item.route}-${index}`} className={index <= stepIndex ? "is-active" : ""} />
            ))}
          </div>
        )}
        <div className="quick-start-guide__actions">
          <button className="text-button" type="button" onClick={() => dismiss("complete")}>
            Pular guia
          </button>
          {invitation ? (
            <button type="button" onClick={() => resume("complete")}>
              {stepIndex > 0 ? "Continuar tutorial" : "Ver guia"} <ChevronRight size={16} />
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
      </section>
    </>,
    document.body,
  );
}
