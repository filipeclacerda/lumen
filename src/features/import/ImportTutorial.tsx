import {
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Eye,
  EyeOff,
  FileSearch,
  FileUp,
  Layers3,
  ListChecks,
  Settings2,
  Tags,
  X,
  type LucideIcon,
} from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import {
  useQuickStartGuide,
  type ImportGuideLessonId,
  type ImportGuidePhase,
  type QuickStartGuideId,
  type QuickStartGuideMode,
  type QuickStartGuideStatus,
} from "../../shared/quickStartGuide";
import { GuideCoachmark } from "../../shared/ui/GuideCoachmark";
import { GuideLessonContent, GuideLessonProgress } from "../../shared/ui/GuideLessonContent";

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

type ImportLesson = {
  id: ImportGuideLessonId;
  target: string;
  title: string;
  summary: string;
  points: readonly string[];
  icon: LucideIcon;
  targetPadding?: number;
  initialPlacement?: "top" | "right" | "bottom" | "left";
};

type ConfigureKind = "bank" | "card" | "mapping";

const phaseLabels: Record<ImportGuidePhase, string> = {
  choose: "Seleção",
  configure: "Configuração",
  review: "Revisão",
  confirm: "Pendências",
  success: "Conclusão",
};

const importTutorialTargetPadding = 10;

function lessonsForPhase({
  phase,
  configureKind,
  hasCards,
  cardSelected,
  cardCreationOpen,
  batchMode,
  hasPreview,
  pendingCategoryCount,
}: {
  phase: ImportGuidePhase;
  configureKind?: ConfigureKind;
  hasCards: boolean;
  cardSelected: boolean;
  cardCreationOpen: boolean;
  batchMode: boolean;
  hasPreview: boolean;
  pendingCategoryCount: number;
}): ImportLesson[] {
  if (phase === "choose") {
    return [
      {
        id: "choose-files",
        target: '[data-import-tutorial="choose"]',
        title: "Escolha o arquivo exportado",
        summary: "Traga o extrato ou a fatura diretamente da instituição financeira.",
        points: [
          "O Lumen aceita CSV, OFX e PDFs textuais compatíveis; você pode selecionar vários arquivos para revisar em lote.",
          "A leitura acontece neste computador e nenhum lançamento é salvo antes da confirmação final.",
        ],
        icon: FileUp,
      },
    ];
  }

  if (phase === "configure") {
    if (cardCreationOpen) {
      return [
        {
          id: "configure-card-create",
          target: ".import-card-creation-dialog",
          title: "Cadastre o cartão correto",
          summary: "O cartão identifica a fatura, o limite e os pagamentos relacionados.",
          points: [
            "Use um nome fácil de reconhecer e salve o cartão antes de continuar.",
            "Depois do cadastro, confira o vencimento identificado no arquivo.",
          ],
          icon: Settings2,
          targetPadding: importTutorialTargetPadding,
        },
      ];
    }
    if (configureKind === "card") {
      return cardSelected
        ? [
            {
              id: "configure-card-review",
              target: '[data-import-tutorial="configure-card-review"]',
              title: "Confira os dados da fatura",
              summary: "Cartão e vencimento definem onde as compras serão organizadas.",
              points: [
                "O Lumen pode pré-selecionar o único cartão cadastrado e identificar o vencimento pelo arquivo.",
                "Confirme os dois campos antes de abrir a revisão das compras.",
              ],
              icon: Settings2,
              targetPadding: importTutorialTargetPadding,
              initialPlacement: "left",
            },
          ]
        : [
            {
              id: "configure-destination",
              target: '[data-import-tutorial="configure-card"]',
              title: hasCards ? "Selecione o cartão da fatura" : "Cadastre o cartão da fatura",
              summary: hasCards
                ? "Escolha o cartão ao qual este arquivo pertence."
                : "É necessário ter um cartão cadastrado antes de revisar a fatura.",
              points: hasCards
                ? [
                    "Confira o vencimento, pois ele define a fatura que receberá as compras.",
                    "Use Revisar fatura somente depois de confirmar o destino.",
                  ]
                : [
                    "Use o botão + para cadastrar o cartão sem perder o arquivo selecionado.",
                    "Depois, selecione o cartão, confira o vencimento e abra a revisão.",
                  ],
              icon: Settings2,
              initialPlacement: "left",
            },
          ];
    }
    if (configureKind === "mapping") {
      return [
        {
          id: "configure-mapping-fields",
          target: '[data-import-tutorial="configure-mapping-fields"]',
          title: "Diga o que cada coluna representa",
          summary: "O mapeamento transforma um CSV desconhecido em lançamentos consistentes.",
          points: [
            "Defina o tipo do arquivo, a conta ou cartão de destino e associe data, descrição e valor.",
            "Os campos marcados com * são obrigatórios; o perfil pode ser salvo para arquivos futuros com o mesmo layout.",
          ],
          icon: Settings2,
          targetPadding: importTutorialTargetPadding,
        },
        {
          id: "configure-mapping-sample",
          target: '[data-import-tutorial="configure-mapping-sample"]',
          title: "Valide o resultado na amostra",
          summary: "A grade mostra como as primeiras linhas serão interpretadas.",
          points: [
            "Confira se data, descrição e valores estão nas colunas esperadas.",
            "Se algo parecer deslocado, volte ao mapeamento antes de liberar a prévia.",
          ],
          icon: FileSearch,
          targetPadding: importTutorialTargetPadding,
        },
      ];
    }
    return [
      {
        id: "configure-destination",
        target: '[data-import-tutorial="configure-destination"]',
        title: "Escolha a conta de destino",
        summary: "O extrato precisa ser associado à conta que originou os lançamentos.",
        points: [
          "Selecione a mesma conta exibida no extrato para manter saldos e conciliações coerentes.",
          "A prévia será aberta somente depois que o destino estiver definido.",
        ],
        icon: Settings2,
        targetPadding: importTutorialTargetPadding,
      },
    ];
  }

  if (phase === "review") {
    const lessons: ImportLesson[] = [];
    if (batchMode) {
      lessons.push({
        id: "batch-queue",
        target: '[data-import-tutorial="batch-queue"]',
        title: "Acompanhe cada arquivo do lote",
        summary: "Cada arquivo é revisado separadamente antes da confirmação conjunta.",
        points: [
          "Arquivos prontos podem ser reabertos ou removidos; escolhas anteriores aparecem apenas como sugestões nos próximos.",
          "A validação final procura duplicidades entre os arquivos e nada é persistido antes da confirmação do lote.",
        ],
        icon: Layers3,
        targetPadding: importTutorialTargetPadding,
      });
    }
    if (hasPreview) {
      lessons.push(
        {
          id: "review-summary",
          target: '[data-import-tutorial="review-summary"]',
          title: "Entenda de onde vieram as categorias",
          summary: "Os contadores separam decisões automáticas, aprendidas e ainda pendentes.",
          points: [
            "Por regra vem de uma regra explícita; Pelo histórico reflete escolhas repetidas e já confirmadas.",
            "Escolhidas são correções desta prévia; Para revisar são itens incluídos, não duplicados e ainda sem categoria.",
            "Nada desta prévia altera seu histórico antes da confirmação.",
          ],
          icon: Tags,
          targetPadding: importTutorialTargetPadding,
        },
        {
          id: "review-all",
          target: '[data-import-tutorial="review-tabs"]',
          title: "Use “Todas” para a conferência fina",
          summary: "Revisar mostra pendências; Todas mostra o conteúdo completo do arquivo.",
          points: [
            "Na lista completa, você pode incluir ou excluir itens, corrigir valores e ajustar uma categoria individual.",
            "Duplicatas exatas ficam identificadas e não são importadas novamente.",
          ],
          icon: FileSearch,
          targetPadding: importTutorialTargetPadding,
        },
        {
          id: "review-categories",
          target: '[data-import-tutorial="review-category-group"], [data-import-tutorial="review-categories-ready"]',
          title: pendingCategoryCount > 0 ? "Resolva uma categoria por vez" : "Categorias resolvidas",
          summary:
            pendingCategoryCount > 0
              ? "A fila apresenta somente os lançamentos que ainda precisam de decisão."
              : "Todos os itens incluídos e não duplicados já possuem categoria.",
          points: [
            "Lançamentos semelhantes são agrupados por estabelecimento; cada PIX é revisado separadamente.",
            "As sugestões são atalhos, não decisões ocultas. Use Todas as categorias quando nenhuma opção fizer sentido.",
            "Ao escolher, o próximo grupo entra em foco e você pode voltar à escolha anterior.",
          ],
          icon: Tags,
          targetPadding: importTutorialTargetPadding,
          initialPlacement: "top",
        },
        {
          id: "review-confirm",
          target: '[data-import-tutorial="review-confirm"]',
          title: batchMode ? "Adicione este arquivo ao lote" : "Confirme somente depois da revisão",
          summary: batchMode
            ? "Esta ação prepara o arquivo atual; o lote ainda não será gravado."
            : "Esta é a ação que grava os lançamentos incluídos no histórico.",
          points: batchMode
            ? [
                "Somente itens incluídos e não duplicados entram na preparação.",
                "A importação definitiva acontece quando todos os arquivos prontos forem confirmados juntos.",
              ]
            : [
                "Somente itens incluídos e não duplicados serão importados.",
                "Se ainda houver categorias pendentes, o Lumen pedirá uma decisão explícita antes de continuar.",
              ],
          icon: ListChecks,
          targetPadding: importTutorialTargetPadding,
        },
      );
    } else if (batchMode) {
      lessons.push({
        id: "review-confirm",
        target: '[data-import-tutorial="review-confirm"]',
        title: "Faça a validação final do lote",
        summary: "A confirmação conjunta verifica os arquivos preparados antes de gravar qualquer lançamento.",
        points: [
          "Duplicidades entre arquivos precisam ser resolvidas antes da importação.",
          "Se houver categorias pendentes, o Lumen mostrará uma confirmação específica.",
        ],
        icon: ListChecks,
        targetPadding: importTutorialTargetPadding,
      });
    }
    return lessons;
  }

  if (phase === "confirm") {
    return [
      {
        id: "confirm-pending",
        target: '[data-import-tutorial="confirm-pending"]',
        title: "Decida o que fazer com as pendências",
        summary: "Há lançamentos incluídos que ainda não possuem categoria.",
        points: [
          "Continuar revisando volta à prévia para você completar as categorias.",
          "Importar com pendências salva os lançamentos mesmo assim; eles aparecerão em Transações e na central de Pendências.",
        ],
        icon: ListChecks,
        targetPadding: importTutorialTargetPadding,
      },
    ];
  }

  return [
    {
      id: "success-next",
      target: '[data-import-tutorial="success"]',
      title: "Importação concluída",
      summary: "Os lançamentos confirmados já fazem parte do seu histórico local.",
      points: [
        "Revise detalhes, status e exceções em Transações.",
        "Regras e histórico aprendem somente com escolhas que chegaram até esta confirmação.",
      ],
      icon: CheckCircle2,
    },
  ];
}

export function ImportTutorial({
  configureKind,
  hasCards = false,
  cardSelected = false,
  cardCreationOpen = false,
  batchMode = false,
  hasPreview = false,
  pendingCategoryCount = 0,
}: {
  configureKind?: ConfigureKind;
  hasCards?: boolean;
  cardSelected?: boolean;
  cardCreationOpen?: boolean;
  batchMode?: boolean;
  hasPreview?: boolean;
  pendingCategoryCount?: number;
}) {
  const navigate = useNavigate();
  const [categoryCardHidden, setCategoryCardHidden] = useState(false);
  const { activeGuide, guides, pause, dismiss, complete, goToLesson, goToImportLesson } = useQuickStartGuide();
  const phase = guides.import?.phase ?? "choose";
  const storedLessonId = guides.import?.lessonId;
  const lessons = lessonsForPhase({
    phase,
    configureKind,
    hasCards,
    cardSelected,
    cardCreationOpen,
    batchMode,
    hasPreview,
    pendingCategoryCount,
  });
  const lessonIndex = Math.max(
    0,
    lessons.findIndex((lesson) => lesson.id === storedLessonId),
  );
  const lesson = lessons[lessonIndex];
  const isReviewCategoryLesson = phase === "review" && lesson?.id === "review-categories";

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

  useEffect(() => {
    if (activeGuide !== "import" || !lesson || lesson.id === storedLessonId) return;
    goToImportLesson(lesson.id);
  }, [activeGuide, goToImportLesson, lesson, storedLessonId]);

  useEffect(() => {
    if (!isReviewCategoryLesson || pendingCategoryCount === 0) {
      setCategoryCardHidden(false);
    }
  }, [isReviewCategoryLesson, pendingCategoryCount]);

  useEffect(() => {
    if (activeGuide !== "import" || !isReviewCategoryLesson || pendingCategoryCount > 0) return;
    const confirmationLesson = lessons[lessonIndex + 1];
    if (confirmationLesson?.id === "review-confirm") {
      goToImportLesson(confirmationLesson.id);
    }
  }, [activeGuide, goToImportLesson, isReviewCategoryLesson, lessonIndex, lessons, pendingCategoryCount]);

  if (activeGuide !== "import" || !lesson) return null;
  const Icon = lesson.icon;

  const continueToTransactions = () => {
    complete("import");
    goToLesson("transactions-list");
    navigate("/transactions");
  };

  const moveLesson = (nextIndex: number) => {
    const nextLesson = lessons[Math.min(Math.max(nextIndex, 0), lessons.length - 1)];
    goToImportLesson(nextLesson.id);
  };

  const isLastLesson = lessonIndex === lessons.length - 1;
  const pendingCategoryMessage =
    pendingCategoryCount === 0
      ? "Categorias concluídas. Avance para conhecer a confirmação."
      : pendingCategoryCount === 1
        ? "Falta 1 lançamento para categorizar."
        : `Faltam ${pendingCategoryCount} lançamentos para categorizar.`;

  if (isReviewCategoryLesson && categoryCardHidden) {
    return (
      <button
        className="secondary import-tutorial__restore"
        type="button"
        aria-label={`Mostrar ajuda de categorização. ${pendingCategoryMessage}`}
        onClick={() => setCategoryCardHidden(false)}
      >
        <Eye size={17} aria-hidden />
        Mostrar ajuda
      </button>
    );
  }

  return (
    <GuideCoachmark
      active
      target={lesson.target}
      targetPadding={lesson.targetPadding ?? importTutorialTargetPadding}
      initialPlacement={lesson.initialPlacement}
      className="import-tutorial"
      role="region"
      labelledBy="import-tutorial-title"
      describedBy="import-tutorial-description"
      focusKey={lesson.id}
      deferFallbackMs={800}
      revealAfterStableMs={500}
    >
      {(positionControl: ReactNode) => (
        <>
          <div className="quick-start-guide__header">
            <div className="quick-start-guide__icon" aria-hidden="true">
              <Icon size={19} />
            </div>
            <div>
              <span>AJUDA DE IMPORTAÇÃO · {phaseLabels[phase]}</span>
              <h2 id="import-tutorial-title">{lesson.title}</h2>
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
          <GuideLessonContent id="import-tutorial-description" summary={lesson.summary} points={lesson.points} />
          <GuideLessonProgress current={lessonIndex + 1} total={lessons.length} chapter={phaseLabels[phase]} />
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
                {isReviewCategoryLesson && (
                  <button className="text-button" type="button" onClick={() => setCategoryCardHidden(true)}>
                    <EyeOff size={16} aria-hidden />
                    Ocultar ajuda
                  </button>
                )}
                <div>
                  {lessonIndex > 0 && (
                    <button className="secondary" type="button" onClick={() => moveLesson(lessonIndex - 1)}>
                      <ChevronLeft size={16} /> Voltar
                    </button>
                  )}
                  {isReviewCategoryLesson ? (
                    <>
                      <span
                        className="quick-start-guide__continue-hint"
                        id="import-tutorial-category-status"
                        role="status"
                        aria-live="polite"
                      >
                        {pendingCategoryMessage}
                      </span>
                      {pendingCategoryCount === 0 && (
                        <button
                          type="button"
                          aria-describedby="import-tutorial-category-status"
                          onClick={() => moveLesson(lessonIndex + 1)}
                        >
                          Avançar <ChevronRight size={16} />
                        </button>
                      )}
                    </>
                  ) : !isLastLesson ? (
                    <button type="button" onClick={() => moveLesson(lessonIndex + 1)}>
                      Avançar <ChevronRight size={16} />
                    </button>
                  ) : (
                    <span className="quick-start-guide__continue-hint">Continue na tela para seguir</span>
                  )}
                </div>
              </>
            )}
          </div>
        </>
      )}
    </GuideCoachmark>
  );
}
