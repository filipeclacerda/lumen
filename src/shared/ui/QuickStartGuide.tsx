import {
  BarChart3,
  Check,
  ChevronLeft,
  ChevronRight,
  FileUp,
  HardDrive,
  LayoutDashboard,
  ListChecks,
  Repeat,
  Settings2,
  SlidersHorizontal,
  Sparkles,
  Tags,
  Wallet,
  WalletCards,
  X,
  type LucideIcon,
} from "lucide-react";
import { useEffect, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { completeGuideLessonIndex, completeGuideLessons, type GuideIconName } from "../guideLessons";
import { useQuickStartGuide } from "../quickStartGuide";
import { GuideCoachmark } from "./GuideCoachmark";
import { GuideLessonContent, GuideLessonProgress } from "./GuideLessonContent";

const lessonIcons: Record<GuideIconName, LucideIcon> = {
  accounts: WalletCards,
  backup: HardDrive,
  budget: Wallet,
  categories: Tags,
  dashboard: LayoutDashboard,
  file: FileUp,
  filters: SlidersHorizontal,
  recurring: Repeat,
  reports: BarChart3,
  review: ListChecks,
  rules: Settings2,
  transactions: ListChecks,
};

export function QuickStartGuide() {
  const navigate = useNavigate();
  const { activeGuide, mode, guides, resume, goToLesson, pause, dismiss, complete } = useQuickStartGuide();
  const lessonIndex = completeGuideLessonIndex(guides.complete.lessonId);
  const lesson = completeGuideLessons[lessonIndex];
  const invitation = mode === "invitation";
  const visible = mode !== "closed" && (invitation || activeGuide === "complete");

  useEffect(() => {
    if (mode !== "tour" || activeGuide !== "complete") return;
    navigate(lesson.route);
  }, [activeGuide, lesson.route, mode, navigate]);

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

  const Icon = invitation ? Sparkles : lessonIcons[lesson.icon];
  const title = invitation
    ? lessonIndex > 0
      ? "Continue de onde parou"
      : "Conheça o Lumen com seus próprios dados"
    : lesson.title;
  const summary = invitation
    ? lessonIndex > 0
      ? `Retome o guia na etapa ${lessonIndex + 1} de ${completeGuideLessons.length}: ${lesson.chapter}.`
      : "O guia percorre as áreas principais e explica o que observar antes de você agir."
    : lesson.summary;
  const points = invitation
    ? [
        "Você pode pausar a qualquer momento e retomar em Configurações.",
        "Os destaques não bloqueiam os controles nem executam ações por você.",
      ]
    : lesson.points;

  const startOrResume = () => resume("complete");

  const goToAdjacentLesson = (nextIndex: number) => {
    const nextLesson = completeGuideLessons[Math.min(Math.max(nextIndex, 0), completeGuideLessons.length - 1)];
    goToLesson(nextLesson.id);
  };

  return (
    <GuideCoachmark
      active
      target={invitation ? undefined : lesson.target}
      labelledBy="quick-start-guide-title"
      describedBy="quick-start-guide-description"
      focusKey={`${mode}-${lesson.id}`}
      focusOnOpen
      deferFallbackMs={invitation ? 0 : 800}
      revealAfterStableMs={invitation ? 0 : 500}
    >
      {(positionControl: ReactNode) => (
        <>
          <div className="quick-start-guide__header">
            <div className="quick-start-guide__icon" aria-hidden="true">
              <Icon size={19} />
            </div>
            <div>
              {!invitation && <span>GUIA DO LUMEN · ETAPA {lessonIndex + 1}</span>}
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
          <GuideLessonContent id="quick-start-guide-description" summary={summary} points={points} />
          {!invitation && (
            <GuideLessonProgress
              current={lessonIndex + 1}
              total={completeGuideLessons.length}
              chapter={lesson.chapter}
            />
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
                {lessonIndex > 0 ? "Continuar" : "Começar"} <ChevronRight size={16} />
              </button>
            ) : (
              <div>
                <button
                  className="secondary"
                  type="button"
                  onClick={() => goToAdjacentLesson(lessonIndex - 1)}
                  disabled={lessonIndex === 0}
                >
                  <ChevronLeft size={16} /> Voltar
                </button>
                {lessonIndex === completeGuideLessons.length - 1 ? (
                  <button type="button" onClick={() => complete("complete")}>
                    Concluir <Check size={16} />
                  </button>
                ) : (
                  <button type="button" onClick={() => goToAdjacentLesson(lessonIndex + 1)}>
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
