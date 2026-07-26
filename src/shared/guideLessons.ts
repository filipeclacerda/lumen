export type GuideIconName =
  | "accounts"
  | "backup"
  | "budget"
  | "categories"
  | "dashboard"
  | "file"
  | "filters"
  | "recurring"
  | "reports"
  | "review"
  | "rules"
  | "transactions";

export type CompleteGuideLesson = {
  id: string;
  chapter: string;
  route: string;
  target: string;
  title: string;
  summary: string;
  points: readonly string[];
  icon: GuideIconName;
};

export const completeGuideLessons = [
  {
    id: "import-source",
    chapter: "Importação",
    route: "/import",
    target: '[data-import-tutorial="choose"]',
    title: "Traga seus dados com segurança",
    summary: "Comece por um arquivo exportado pelo banco ou pelo cartão.",
    points: [
      "O Lumen aceita CSV, OFX e PDFs textuais compatíveis; você também pode selecionar vários arquivos para formar um lote.",
      "A leitura acontece neste computador e nada entra no histórico antes da confirmação final.",
    ],
    icon: "file",
  },
  {
    id: "transactions-list",
    chapter: "Transações",
    route: "/transactions",
    target: '[data-quick-guide="transactions-list"]',
    title: "Entenda cada lançamento",
    summary: "A lista reúne o que entrou, saiu ou ainda precisa ser confirmado.",
    points: [
      "Origem, conta, categoria e status explicam de onde veio cada valor e como ele participa dos saldos.",
      "Você pode corrigir a categoria na própria linha; transferências vinculadas usam ações próprias para preservar as duas pontas.",
    ],
    icon: "transactions",
  },
  {
    id: "transactions-filters",
    chapter: "Transações",
    route: "/transactions",
    target: '[data-quick-guide="transactions-filter-panel"]',
    title: "Encontre exatamente o que precisa",
    summary: "Combine filtros para localizar pendências ou investigar um recorte.",
    points: [
      "Período, origem, conta, categoria, status, tipo e valor podem ser usados juntos.",
      "Os filtros rápidos resolvem buscas frequentes; os chips mostram tudo o que está aplicado.",
    ],
    icon: "filters",
  },
  {
    id: "review-center",
    chapter: "Pendências",
    route: "/review",
    target: '[data-quick-guide="review-center"]',
    title: "Mantenha os dados confiáveis",
    summary: "Esta central reúne as conferências que melhoram saldos, relatórios e orçamento.",
    points: [
      "Você verá categorias ausentes, lançamentos pendentes, saldos a conferir e pagamentos de cartão a conciliar.",
      "Cada ação abre o contexto correto, e você não precisa resolver todas as pendências de uma vez.",
    ],
    icon: "review",
  },
  {
    id: "accounts-overview",
    chapter: "Contas e cartões",
    route: "/accounts",
    target: '[data-quick-guide="accounts-overview"]',
    title: "Separe saldo, crédito e conciliação",
    summary: "Contas bancárias e cartões representam partes diferentes da sua vida financeira.",
    points: [
      "Nas contas, compare o saldo realizado com a projeção e faça conferências periódicas.",
      "Nos cartões, acompanhe faturas e vincule o pagamento bancário à fatura correspondente.",
    ],
    icon: "accounts",
  },
  {
    id: "recurring-editor",
    chapter: "Recorrências",
    route: "/recurring",
    target: '[data-quick-guide="recurring-editor"]',
    title: "Cadastre uma vez, acompanhe todo mês",
    summary: "Recorrências geram lançamentos mensais previsíveis sem duplicar o cadastro.",
    points: [
      "Defina tipo, valor, dia, conta, categoria e período de vigência.",
      "Você pode gerar pendências agora, pausar uma recorrência ou reativá-la depois.",
    ],
    icon: "recurring",
  },
  {
    id: "budget-overview",
    chapter: "Orçamento",
    route: "/budget",
    target: '[data-quick-guide="budget-overview"]',
    title: "Transforme categorias em limites",
    summary: "O orçamento compara o que foi planejado com o gasto real de cada mês.",
    points: [
      "Orçado, gasto e disponível usam o mês selecionado e as categorias configuradas.",
      "Cada linha mostra consumo, restante ou excesso e, no mês atual, uma projeção até o fim do período.",
    ],
    icon: "budget",
  },
  {
    id: "categories-structure",
    chapter: "Categorias",
    route: "/categories?tab=categories",
    target: '[data-quick-guide="categories-structure"]',
    title: "Construa uma estrutura que faça sentido",
    summary: "Categorias organizam relatórios, orçamento e revisão de lançamentos.",
    points: [
      "O tipo define se a categoria representa receita, despesa, investimento ou transferência.",
      "Categorias principais e subcategorias formam a hierarquia; cor, ícone e ordem facilitam a leitura.",
    ],
    icon: "categories",
  },
  {
    id: "categories-rules",
    chapter: "Regras",
    route: "/categories?tab=rules",
    target: '[data-quick-guide="categories-rules"]',
    title: "Automatize somente padrões explícitos",
    summary: "Regras locais aplicam uma categoria quando os critérios definidos por você combinam.",
    points: [
      "Texto, conta, tipo e faixa de valor podem restringir a correspondência; teste o impacto antes de salvar.",
      "A prioridade decide qual regra vence. O histórico apenas aprende com escolhas confirmadas e continua revisável.",
    ],
    icon: "rules",
  },
  {
    id: "overview-month",
    chapter: "Visão geral",
    route: "/",
    target: '[data-quick-guide="overview"]',
    title: "Leia um mês de cada vez",
    summary: "Os indicadores resumem receitas, despesas, investimentos e sobra do período.",
    points: [
      "O navegador de mês atualiza todos os números e gráficos da tela.",
      "Use os atalhos dos cartões para chegar ao conjunto de transações que explica cada total.",
    ],
    icon: "dashboard",
  },
  {
    id: "reports-filters",
    chapter: "Relatórios",
    route: "/reports",
    target: '[data-quick-guide="reports-filters"]',
    title: "Defina primeiro o recorte",
    summary: "Período, conta e origem valem para todos os indicadores do relatório.",
    points: [
      "Compare apenas recortes equivalentes para evitar conclusões distorcidas.",
      "A exportação em PDF usa exatamente os filtros que estiverem selecionados.",
    ],
    icon: "reports",
  },
  {
    id: "reports-kpis",
    chapter: "Relatórios",
    route: "/reports",
    target: '[data-quick-guide="reports-kpis"]',
    title: "Comece pelos indicadores consolidados",
    summary: "Os cartões apresentam a dimensão geral antes dos gráficos detalhados.",
    points: [
      "Entradas, despesas, média mensal, investimentos e concentração ajudam a comparar o período.",
      "Leia valores e contexto juntos: quantidade de meses e variações mudam a interpretação.",
    ],
    icon: "reports",
  },
  {
    id: "reports-insights",
    chapter: "Relatórios",
    route: "/reports",
    target: '[data-quick-guide="reports-categories"]',
    title: "Investigue categorias e alertas",
    summary: "As abas detalham para onde o dinheiro foi e quais pontos merecem atenção.",
    points: [
      "Categorias, estabelecimentos e origem dos gastos explicam a composição dos totais.",
      "Alertas e valores clicáveis levam às transações que sustentam o achado.",
    ],
    icon: "reports",
  },
  {
    id: "settings-backup",
    chapter: "Backup",
    route: "/settings?section=data",
    target: '[data-quick-guide="backup"]',
    title: "Proteja seu histórico local",
    summary: "Crie um backup após importações e antes de mudanças importantes.",
    points: [
      "O backup é um arquivo local escolhido por você e a restauração substitui os dados atuais após confirmação.",
      "O banco e os backups ainda não são criptografados pelo Lumen; proteja o computador e os arquivos.",
    ],
    icon: "backup",
  },
] as const satisfies readonly CompleteGuideLesson[];

export type CompleteGuideLessonId = (typeof completeGuideLessons)[number]["id"];

export const DEFAULT_COMPLETE_GUIDE_LESSON_ID: CompleteGuideLessonId = completeGuideLessons[0].id;

export const legacyV2CompleteLessonIds = [
  "import-source",
  "transactions-filters",
  "overview-month",
  "reports-filters",
  "settings-backup",
] as const satisfies readonly CompleteGuideLessonId[];

const completeLessonIds = new Set<string>(completeGuideLessons.map((lesson) => lesson.id));

export function isCompleteGuideLessonId(value: unknown): value is CompleteGuideLessonId {
  return typeof value === "string" && completeLessonIds.has(value);
}

export function completeGuideLessonIndex(lessonId: CompleteGuideLessonId) {
  return Math.max(
    0,
    completeGuideLessons.findIndex((lesson) => lesson.id === lessonId),
  );
}

export type ImportGuidePhase = "choose" | "configure" | "review" | "confirm" | "success";

export const importGuideLessonIds = [
  "choose-files",
  "configure-destination",
  "configure-mapping-fields",
  "configure-mapping-sample",
  "configure-card-create",
  "configure-card-review",
  "batch-queue",
  "review-summary",
  "review-categories",
  "review-all",
  "review-confirm",
  "confirm-pending",
  "success-next",
] as const;

export type ImportGuideLessonId = (typeof importGuideLessonIds)[number];

export const defaultImportLessonByPhase: Record<ImportGuidePhase, ImportGuideLessonId> = {
  choose: "choose-files",
  configure: "configure-destination",
  review: "review-summary",
  confirm: "confirm-pending",
  success: "success-next",
};

const importLessonIds = new Set<string>(importGuideLessonIds);

export function isImportGuideLessonId(value: unknown): value is ImportGuideLessonId {
  return typeof value === "string" && importLessonIds.has(value);
}

export function importGuidePhaseForLesson(lessonId: ImportGuideLessonId): ImportGuidePhase {
  if (lessonId === "choose-files") return "choose";
  if (lessonId.startsWith("configure-")) return "configure";
  if (lessonId.startsWith("review-") || lessonId === "batch-queue") return "review";
  if (lessonId === "confirm-pending") return "confirm";
  return "success";
}
