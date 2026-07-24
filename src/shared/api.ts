import { invoke } from "@tauri-apps/api/core";
import type {
  Account,
  AccountBalanceSummary,
  AccountType,
  AppBootstrap,
  BudgetOverview,
  BalanceCheckpoint,
  BalanceCheckpointInput,
  Category,
  CategoryMergeImpact,
  CardPaymentReconciliation,
  CategorizationRule,
  CategoryTrendFilter,
  CategoryTrendPoint,
  CommitImportResult,
  CreditCardImportCommitResult,
  CreditCardImportPreview,
  CreditCardInvoice,
  CreditCardInvoicePage,
  CreditCardInvoiceItem,
  CsvMappingDraft,
  CsvMappingProfile,
  DashboardSummary,
  DataQualityReview,
  FinancialReport,
  FinancialTarget,
  FinancialTargetInput,
  ImportFileInspection,
  ImportPreview,
  InstallmentPlanInput,
  InstallmentPlanResult,
  MerchantAlias,
  MerchantPage,
  MerchantPageFilter,
  NetWorthPoint,
  OnboardingInput,
  OnboardingResult,
  ProfileInput,
  PaymentMatchCandidate,
  RecurringTransaction,
  RecurringTransactionInput,
  ReconciliationPreview,
  ReportFilter,
  RuleImpact,
  RuleInput,
  TemplateKind,
  Transaction,
  TransactionFilter,
  TransactionInput,
  TransactionLink,
  TransactionPage,
  TransferCandidate,
  TransferDetails,
  TransferInput,
  UpcomingItem,
  UserProfile,
} from "./types";
import { addMonthsClamped, splitInstallmentCents } from "./installments";

const demoTransactions: Transaction[] = [
  {
    id: "1",
    accountId: "card",
    accountName: "Cartão principal",
    accountKind: "credit_card",
    date: "2026-06-26",
    description: "Supermercado Aurora",
    amountInCents: -28490,
    categoryId: "groceries",
    category: "Supermercado",
    categorySource: "rule",
    status: "cleared",
    isTransferLeg: false,
  },
  {
    id: "2",
    accountId: "demo",
    accountName: "Conta principal",
    accountKind: "checking",
    date: "2026-06-25",
    description: "Salário",
    amountInCents: 780000,
    categoryId: "salary",
    category: "Salário",
    categorySource: "rule",
    status: "cleared",
    isTransferLeg: false,
  },
  {
    id: "3",
    accountId: "demo",
    accountName: "Conta principal",
    accountKind: "checking",
    date: "2026-06-23",
    description: "Energia elétrica",
    amountInCents: -18734,
    categoryId: "utilities",
    category: "Água, luz e gás",
    categorySource: "rule",
    status: "cleared",
    isTransferLeg: false,
  },
  {
    id: "4",
    accountId: "card",
    accountName: "Cartão principal",
    accountKind: "credit_card",
    date: "2026-06-21",
    description: "Café do Centro",
    amountInCents: -3250,
    categoryId: "food",
    category: "Alimentação",
    status: "cleared",
    isTransferLeg: false,
  },
];
const demoCheckpoints = new Map<string, BalanceCheckpoint>();
let demoSequence = 0;
const nextDemoId = (prefix: string) => `${prefix}-${Date.now()}-${++demoSequence}`;
const demoAccountBaseBalances: Record<string, number> = { demo: 549526, card: -31740 };
const demoAccounts: Account[] = [
  { id: "demo", name: "Conta principal", kind: "checking", balanceInCents: 549526 },
  { id: "card", name: "Cartão principal", kind: "credit_card", balanceInCents: -31740 },
];

function normalizeDemoDescription(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleUpperCase("pt-BR")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function localTodayIso() {
  const today = new Date();
  return `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
}

function validateDemoCheckpoint(input: BalanceCheckpointInput) {
  const parsed = /^\d{4}-\d{2}-\d{2}$/.test(input.asOfDate)
    ? new Date(`${input.asOfDate}T00:00:00Z`)
    : new Date(Number.NaN);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== input.asOfDate)
    throw new Error("Data de conciliação inválida.");
  if (input.asOfDate > localTodayIso()) throw new Error("A data de conciliação não pode estar no futuro.");
  if (!["manual", "import", "reconciliation"].includes(input.source))
    throw new Error("Origem do saldo informado inválida.");
  if (!demoAccounts.some((account) => account.id === input.accountId)) throw new Error("Conta não encontrada.");
}

function latestDemoCheckpoint(accountId: string, asOfDate?: string) {
  return [...demoCheckpoints.values()]
    .filter((checkpoint) => checkpoint.accountId === accountId && (!asOfDate || checkpoint.asOfDate <= asOfDate))
    .sort((left, right) => right.asOfDate.localeCompare(left.asOfDate))[0];
}

const demoCategories: Category[] = [
  { id: "income", name: "Receitas", color: "#22835f", kind: "income", sortOrder: 10, isSystem: true },
  {
    id: "salary",
    parentId: "income",
    name: "Salário",
    color: "#22835f",
    kind: "income",
    sortOrder: 11,
    isSystem: true,
  },
  {
    id: "other-income",
    parentId: "income",
    name: "Outras receitas",
    color: "#22835f",
    kind: "income",
    sortOrder: 12,
    isSystem: true,
  },
  { id: "food", name: "Alimentação", color: "#e5a142", kind: "expense", sortOrder: 20, isSystem: true },
  {
    id: "groceries",
    parentId: "food",
    name: "Supermercado",
    color: "#e5a142",
    kind: "expense",
    sortOrder: 21,
    isSystem: true,
  },
  {
    id: "restaurants",
    parentId: "food",
    name: "Restaurantes",
    color: "#e5a142",
    kind: "expense",
    sortOrder: 22,
    isSystem: true,
  },
  { id: "housing", name: "Moradia", color: "#728bba", kind: "expense", sortOrder: 30, isSystem: true },
  {
    id: "rent",
    parentId: "housing",
    name: "Aluguel e condomínio",
    color: "#728bba",
    kind: "expense",
    sortOrder: 31,
    isSystem: true,
  },
  {
    id: "utilities",
    parentId: "housing",
    name: "Água, luz e gás",
    color: "#728bba",
    kind: "expense",
    sortOrder: 32,
    isSystem: true,
  },
  { id: "transport", name: "Transporte", color: "#9165a4", kind: "expense", sortOrder: 40, isSystem: true },
  {
    id: "fuel",
    parentId: "transport",
    name: "Combustível",
    color: "#9165a4",
    kind: "expense",
    sortOrder: 41,
    isSystem: true,
  },
  { id: "health", name: "Saúde", color: "#d66d68", kind: "expense", sortOrder: 50, isSystem: true },
  { id: "shopping", name: "Compras", color: "#c97f9e", kind: "expense", sortOrder: 90, isSystem: true },
  { id: "personal-care", name: "Cuidados pessoais", color: "#c97f9e", kind: "expense", sortOrder: 95, isSystem: true },
  { id: "leisure", name: "Lazer", color: "#4c94a8", kind: "expense", sortOrder: 100, isSystem: true },
  { id: "investments", name: "Investimentos", color: "#1a5b82", kind: "investment", sortOrder: 130, isSystem: true },
  { id: "transfers", name: "Transferências", color: "#6d7d78", kind: "transfer", sortOrder: 120, isSystem: true },
  {
    id: "credit-card-payment",
    parentId: "transfers",
    name: "Pagamento de fatura",
    color: "#6d7d78",
    kind: "transfer",
    sortOrder: 121,
    isSystem: true,
  },
];
const demoRules: CategorizationRule[] = [
  {
    id: "default-salary",
    name: "Salário identificado",
    priority: 1000,
    enabled: true,
    operator: "contains",
    pattern: "SALARIO",
    movementType: "income",
    categoryId: "salary",
    categoryName: "Salário",
    useCount: 1,
    isSystem: true,
  },
  {
    id: "default-supermarket",
    name: "Supermercado",
    priority: 1010,
    enabled: true,
    operator: "contains",
    pattern: "SUPERMERC",
    movementType: "expense",
    categoryId: "groceries",
    categoryName: "Supermercado",
    useCount: 1,
    isSystem: true,
  },
];

function paginateDemo<T>(items: T[], limit = 25, offset = 0) {
  const safeLimit = Math.max(1, limit);
  const safeOffset = Math.max(0, offset);
  return { items: items.slice(safeOffset, safeOffset + safeLimit), totalCount: items.length };
}

const demoMerchants: MerchantPage["items"] = Object.values(
  demoTransactions.reduce<Record<string, MerchantPage["items"][number]>>((groups, transaction) => {
    if (transaction.amountInCents >= 0) return groups;
    const key = transaction.description.toUpperCase();
    const current = groups[key] ?? {
      merchant: transaction.description,
      merchantKey: key,
      originalName: key,
      amountInCents: 0,
      transactionCount: 0,
    };
    current.amountInCents += Math.abs(transaction.amountInCents);
    current.transactionCount += 1;
    groups[key] = current;
    return groups;
  }, {}),
).sort((a, b) => b.transactionCount - a.transactionCount || a.originalName.localeCompare(b.originalName));

const isTauri = () => "__TAURI_INTERNALS__" in window;
const demoProfile = (): UserProfile | null => {
  const stored = localStorage.getItem("financa-demo-profile");
  return stored ? (JSON.parse(stored) as UserProfile) : null;
};
export const api = {
  bootstrap: async (): Promise<AppBootstrap> => {
    if (isTauri()) return invoke("get_app_bootstrap");
    const profile = demoProfile();
    return {
      profile,
      onboardingCompleted: Boolean(profile),
      account: { id: "demo", name: "Conta principal", kind: "checking", balanceInCents: 0 },
      hasTransactions: false,
      hasImports: false,
    };
  },
  profile: async (): Promise<UserProfile | null> => (isTauri() ? invoke("get_profile") : demoProfile()),
  completeOnboarding: async (input: OnboardingInput): Promise<OnboardingResult> => {
    if (isTauri()) return invoke("complete_onboarding", { input });
    const profile: UserProfile = {
      displayName: input.displayName,
      monthlyIncomeInCents: null,
      monthlyTargetInCents: input.monthlyTargetInCents ?? null,
      incomeDay: null,
      incomeDayRule: null,
      financialGoal: input.financialGoal,
      onboardingStartMode: input.onboardingStartMode,
      onboardingCompletedAt: new Date().toISOString(),
    };
    localStorage.setItem("financa-demo-profile", JSON.stringify(profile));
    return { profile, accountId: "demo" };
  },
  saveProfile: async (input: ProfileInput): Promise<UserProfile> => {
    if (isTauri()) return invoke("save_profile", { input });
    const current = demoProfile();
    const profile: UserProfile = {
      displayName: input.displayName,
      monthlyIncomeInCents: input.monthlyIncomeInCents ?? null,
      monthlyTargetInCents: input.monthlyTargetInCents ?? null,
      incomeDay: input.incomeDay ?? null,
      incomeDayRule: input.incomeDayRule ?? null,
      financialGoal: input.financialGoal ?? null,
      onboardingStartMode: current?.onboardingStartMode ?? null,
      onboardingCompletedAt: current?.onboardingCompletedAt ?? new Date().toISOString(),
    };
    localStorage.setItem("financa-demo-profile", JSON.stringify(profile));
    return profile;
  },
  accounts: async (): Promise<Account[]> => (isTauri() ? invoke("list_accounts") : demoAccounts),
  accountBalanceSummaries: async (): Promise<AccountBalanceSummary[]> => {
    if (isTauri()) return invoke("list_account_balance_summaries");
    return ["demo"].map((accountId) => {
      const checkpoint = latestDemoCheckpoint(accountId);
      const balance = checkpoint?.balanceInCents ?? demoAccountBaseBalances[accountId];
      return {
        accountId,
        realizedBalanceInCents: balance,
        pendingBalanceInCents: balance,
        forecastBalanceInCents: balance,
        minimumBalanceInCents: balance,
        minimumBalanceDate: null,
        scheduledCount: 0,
        lastReconciledAt: checkpoint?.asOfDate ?? null,
        needsReconciliation: !checkpoint,
      };
    });
  },
  dataQualityReview: async (): Promise<DataQualityReview> =>
    isTauri()
      ? invoke("get_data_quality_review")
      : {
          totalCount: 0,
          uncategorized: { totalCount: 0, items: [] },
          pendingTransactions: { totalCount: 0, items: [] },
          accountReconciliations: { totalCount: 0, items: [] },
          cardPaymentReconciliations: { totalCount: 0, items: [] },
        },
  reconciliationPreview: async (input: BalanceCheckpointInput): Promise<ReconciliationPreview> => {
    if (isTauri()) return invoke("get_reconciliation_preview", { input });
    validateDemoCheckpoint(input);
    const latestCheckpoint = latestDemoCheckpoint(input.accountId, input.asOfDate);
    const calculatedBalanceInCents = latestCheckpoint?.balanceInCents ?? demoAccountBaseBalances[input.accountId] ?? 0;
    return {
      accountId: input.accountId,
      asOfDate: input.asOfDate,
      reportedBalanceInCents: input.balanceInCents,
      calculatedBalanceInCents,
      differenceInCents: input.balanceInCents - calculatedBalanceInCents,
      latestCheckpoint: latestCheckpoint ?? null,
    };
  },
  recordBalanceCheckpoint: async (input: BalanceCheckpointInput): Promise<BalanceCheckpoint> => {
    if (isTauri()) return invoke("record_balance_checkpoint", { input });
    validateDemoCheckpoint(input);
    const key = `${input.accountId}:${input.asOfDate}`;
    const checkpoint: BalanceCheckpoint = {
      ...input,
      id: demoCheckpoints.get(key)?.id ?? nextDemoId("demo-checkpoint"),
      createdAt: new Date().toISOString(),
    };
    demoCheckpoints.set(key, checkpoint);
    return checkpoint;
  },
  transactions: async (month?: string): Promise<Transaction[]> => {
    if (isTauri()) return invoke("list_transactions", { month: month || null });
    return month ? demoTransactions.filter((transaction) => transaction.date.startsWith(month)) : demoTransactions;
  },
  listTransactions: async (filter: TransactionFilter): Promise<TransactionPage> => {
    if (isTauri()) return invoke("list_transactions_page", { filter });
    const items = demoTransactions.filter(
      (t) =>
        (!filter.search || t.description.toLowerCase().includes(filter.search.toLowerCase())) &&
        (!filter.startDate || t.date >= filter.startDate) &&
        (!filter.endDate || t.date <= filter.endDate) &&
        (!filter.startMonth || t.date.slice(0, 7) >= filter.startMonth) &&
        (!filter.endMonth || t.date.slice(0, 7) <= filter.endMonth) &&
        (!filter.accountId || t.accountId === filter.accountId) &&
        (!filter.categoryId || t.categoryId === filter.categoryId) &&
        (!filter.uncategorized || !t.categoryId) &&
        (!filter.status || t.status === filter.status) &&
        (!filter.source ||
          filter.source === "all" ||
          (filter.source === "credit_card" ? t.accountKind === "credit_card" : t.accountKind !== "credit_card")) &&
        (!filter.movementType ||
          (filter.movementType === "income"
            ? t.amountInCents > 0
            : filter.movementType === "expense"
              ? t.amountInCents < 0
              : filter.movementType === "investment"
                ? t.category === "Investimentos"
                : t.category === "Transferências")) &&
        (!filter.minAbsAmountInCents || Math.abs(t.amountInCents) >= filter.minAbsAmountInCents) &&
        (!filter.maxAbsAmountInCents || Math.abs(t.amountInCents) <= filter.maxAbsAmountInCents) &&
        (!filter.merchantKey || t.description.toUpperCase() === filter.merchantKey),
    );
    return paginateDemo(items, filter.limit, filter.offset);
  },
  summary: async (month?: string): Promise<DashboardSummary> =>
    isTauri()
      ? invoke("dashboard_summary", { month: month || null })
      : {
          incomeInCents: 780000,
          expensesInCents: 50374,
          investmentsInCents: 20000,
          balanceInCents: 729626,
          transactionCount: 4,
          byCategory: [
            { category: "Alimentação", amountInCents: 31740 },
            { category: "Moradia", amountInCents: 18734 },
          ],
        },
  categories: async (): Promise<Category[]> => (isTauri() ? invoke("list_categories") : demoCategories),
  saveCategory: (input: Partial<Category>): Promise<string> => invoke("save_category", { input }),
  archiveCategory: (id: string): Promise<void> => invoke("archive_category", { id }),
  previewCategoryMerge: (sourceCategoryId: string, targetCategoryId: string): Promise<CategoryMergeImpact> =>
    invoke("preview_category_merge", { sourceCategoryId, targetCategoryId }),
  mergeCategory: (sourceCategoryId: string, targetCategoryId: string): Promise<CategoryMergeImpact> =>
    invoke("merge_category", { sourceCategoryId, targetCategoryId }),
  rules: async (): Promise<CategorizationRule[]> => (isTauri() ? invoke("list_rules") : demoRules),
  listMerchantsPage: async (filter: MerchantPageFilter): Promise<MerchantPage> => {
    if (isTauri()) return invoke("list_merchants_page", { filter });
    const search = filter.search?.trim().toLocaleLowerCase("pt-BR");
    const filtered = demoMerchants
      .filter(
        (merchant) =>
          !search ||
          merchant.originalName.toLocaleLowerCase("pt-BR").includes(search) ||
          merchant.alias?.toLocaleLowerCase("pt-BR").includes(search),
      )
      .sort((left, right) => {
        if (filter.sort === "name")
          return (left.alias ?? left.originalName).localeCompare(right.alias ?? right.originalName, "pt-BR");
        if (filter.sort === "amount") return right.amountInCents - left.amountInCents;
        return (
          right.transactionCount - left.transactionCount ||
          (left.alias ?? left.originalName).localeCompare(right.alias ?? right.originalName, "pt-BR")
        );
      });
    return paginateDemo(filtered, filter.limit, filter.offset);
  },
  saveRule: (input: RuleInput): Promise<string> => invoke("save_rule", { input }),
  archiveRule: (id: string): Promise<void> => invoke("archive_rule", { id }),
  reorderRules: (ids: string[]): Promise<void> => invoke("reorder_rules", { ids }),
  previewRule: (input: RuleInput, overwriteManual = false): Promise<RuleImpact> =>
    invoke("preview_rule", { input, overwriteManual }),
  previewAllRules: (overwriteManual = false): Promise<RuleImpact> =>
    invoke("preview_rules_retroactive", { overwriteManual }),
  applyRules: (overwriteManual = false): Promise<number> => invoke("apply_rules_retroactive", { overwriteManual }),
  updateTransactionCategory: (transactionId: string, categoryId?: string): Promise<void> =>
    invoke("update_transaction_category", { transactionId, categoryId: categoryId || null }),
  updateTransactionAmount: (transactionId: string, amountInCents: number): Promise<void> =>
    invoke("update_transaction_amount", { transactionId, amountInCents }),
  setTransactionStatus: (transactionId: string, status: "pending" | "cleared"): Promise<void> =>
    invoke("set_transaction_status", { transactionId, status }),
  bulkUpdateTransactionCategory: (transactionIds: string[], categoryId?: string): Promise<number> =>
    invoke("bulk_update_transaction_category", { transactionIds, categoryId: categoryId || null }),
  deleteTransactions: (transactionIds: string[]): Promise<number> => invoke("delete_transactions", { transactionIds }),
  restoreTransactions: (transactionIds: string[]): Promise<number> =>
    invoke("restore_transactions", { transactionIds }),
  createTransaction: (input: TransactionInput): Promise<string> => invoke("create_transaction", { input }),
  createCreditCardInstallments: async (input: InstallmentPlanInput): Promise<InstallmentPlanResult> => {
    if (isTauri()) return invoke("create_credit_card_installments", { input });
    const description = input.description.trim();
    if (Array.from(description).length < 1 || Array.from(description).length > 190)
      throw new Error("A descrição deve ter entre 1 e 190 caracteres.");
    const parts = splitInstallmentCents(input.totalAmountInCents, input.installmentCount);
    if (parts.length !== input.installmentCount) throw new Error("Parcelamento inválido.");
    const account = demoAccounts.find((candidate) => candidate.id === input.accountId);
    if (!account || account.kind !== "credit_card") throw new Error("Selecione uma conta de cartão de crédito.");
    const category = input.categoryId
      ? demoCategories.find((candidate) => candidate.id === input.categoryId)
      : undefined;
    if (input.categoryId && (!category || !["expense", "investment"].includes(category.kind)))
      throw new Error("A categoria não é compatível com este lançamento.");

    const generated = parts.map((amount, index) => {
      const date = addMonthsClamped(input.firstDate, index);
      if (!date) throw new Error("Data da primeira parcela inválida.");
      return {
        date,
        amountInCents: -amount,
        description: `${description} (${index + 1}/${input.installmentCount})`,
      };
    });
    const duplicate = generated.some((candidate) =>
      demoTransactions.some(
        (transaction) =>
          transaction.accountId === account.id &&
          transaction.date === candidate.date &&
          normalizeDemoDescription(transaction.description) === normalizeDemoDescription(candidate.description) &&
          transaction.amountInCents === candidate.amountInCents,
      ),
    );
    if (duplicate) throw new Error("Já existe um parcelamento idêntico neste cartão.");

    const planId = nextDemoId("demo-installments");
    const transactionIds = generated.map((candidate) => {
      const id = nextDemoId("demo-installment");
      demoTransactions.push({
        id,
        accountId: account.id,
        accountName: account.name,
        accountKind: account.kind,
        ...candidate,
        categoryId: input.categoryId,
        category: category?.name,
        categorySource: input.categoryId ? "manual" : undefined,
        status: "cleared",
        isTransferLeg: false,
      });
      return id;
    });
    return { planId, transactionIds };
  },
  createTransfer: (input: TransferInput): Promise<string[]> => invoke("create_transfer", { input }),
  getTransferDetails: (transactionId: string): Promise<TransferDetails> =>
    invoke("get_transfer_details", { transactionId }),
  updateTransfer: (transactionId: string, input: TransferInput): Promise<void> =>
    invoke("update_transfer", { transactionId, input }),
  unlinkTransfer: (transactionId: string): Promise<void> => invoke("unlink_transfer", { transactionId }),
  setTransferDeleted: (transactionId: string, deleted: boolean): Promise<number> =>
    invoke("set_transfer_deleted", { transactionId, deleted }),
  detectTransferCandidates: (batchId?: string): Promise<TransferCandidate[]> =>
    invoke("detect_transfer_candidates", { batchId: batchId || null }),
  linkTransferPair: (debitTransactionId: string, creditTransactionId: string): Promise<void> =>
    invoke("link_transfer_pair", { debitTransactionId, creditTransactionId }),
  updateTransaction: (input: TransactionInput): Promise<void> => invoke("update_transaction", { input }),
  createAccount: (name: string, kind: AccountType): Promise<string> => invoke("create_account", { name, kind }),
  renameAccount: (id: string, name: string): Promise<void> => invoke("rename_account", { id, name }),
  archiveAccount: (id: string): Promise<void> => invoke("archive_account", { id }),
  exportTransactionsCsv: (path: string, filter: TransactionFilter = {}): Promise<number> =>
    invoke("export_transactions_csv", { path, filter }),
  exportTransactionsOfx: (path: string, filter: TransactionFilter = {}): Promise<number> =>
    invoke("export_transactions_ofx", { path, filter }),
  exportTransactionsPdf: (path: string, filter: TransactionFilter = {}): Promise<number> =>
    invoke("export_transactions_pdf", { path, filter }),
  exportFinancialReportPdf: (path: string, filter: ReportFilter): Promise<number> =>
    invoke("export_financial_report_pdf", { path, filter }),
  backupDatabase: (path: string): Promise<void> => invoke("backup_database", { path }),
  restoreDatabase: (path: string): Promise<void> => invoke("restore_database", { path }),
  resetDatabase: (): Promise<void> => invoke("reset_database"),
  inspectImportFile: (path: string): Promise<ImportFileInspection> => invoke("inspect_import_file", { path }),
  csvMappingProfiles: (): Promise<CsvMappingProfile[]> => invoke("list_csv_mapping_profiles"),
  saveCsvMappingProfile: (mapping: CsvMappingDraft): Promise<string> => invoke("save_csv_mapping_profile", { mapping }),
  deleteCsvMappingProfile: (profileId: string): Promise<void> => invoke("delete_csv_mapping_profile", { profileId }),
  exportImportTemplate: (path: string, templateKind: TemplateKind): Promise<void> =>
    invoke("export_import_template", { path, templateKind }),
  previewImport: (path: string, accountId: string): Promise<ImportPreview> =>
    invoke("preview_import", { path, accountId }),
  previewMappedBankImport: (path: string, accountId: string, mapping: CsvMappingDraft): Promise<ImportPreview> =>
    invoke("preview_mapped_bank_import", { path, accountId, mapping }),
  updateImportCandidate: (
    sessionId: string,
    sourceRow: number,
    amountInCents: number,
    included: boolean,
  ): Promise<ImportPreview["candidates"][number]> =>
    invoke("update_import_candidate", { sessionId, sourceRow, amountInCents, included }),
  setImportCategory: (sessionId: string, sourceRow: number, categoryId?: string): Promise<void> =>
    invoke("set_import_candidate_category", { sessionId, sourceRow, categoryId: categoryId || null }),
  setImportCategories: (sessionId: string, sourceRows: number[], categoryId?: string): Promise<ImportPreview> =>
    invoke("set_import_candidates_category", { sessionId, sourceRows, categoryId: categoryId || null }),
  commitImport: (sessionId: string): Promise<CommitImportResult> => invoke("commit_import", { sessionId }),
  detectImportKind: (path: string): Promise<"known_bank" | "known_credit_card" | "unknown_csv"> =>
    invoke("detect_import_kind", { path }),
  createCreditCardAccount: (name: string): Promise<string> => invoke("create_credit_card_account", { name }),
  previewCreditCardImport: (path: string, accountId: string, dueDate?: string): Promise<CreditCardImportPreview> =>
    invoke("preview_credit_card_import", { path, accountId, dueDate: dueDate || null }),
  previewMappedCreditCardImport: (
    path: string,
    accountId: string,
    mapping: CsvMappingDraft,
  ): Promise<CreditCardImportPreview> => invoke("preview_mapped_credit_card_import", { path, accountId, mapping }),
  updateCreditCardImport: (
    sessionId: string,
    sourceRow: number,
    included: boolean,
    categoryId?: string,
    dueDate?: string,
  ): Promise<CreditCardImportPreview> =>
    invoke("update_credit_card_import", {
      sessionId,
      sourceRow,
      included,
      categoryId: categoryId || null,
      dueDate: dueDate || null,
    }),
  updateCreditCardImportCategories: (
    sessionId: string,
    sourceRows: number[],
    categoryId?: string,
  ): Promise<CreditCardImportPreview> =>
    invoke("update_credit_card_import_categories", { sessionId, sourceRows, categoryId: categoryId || null }),
  commitCreditCardImport: (sessionId: string): Promise<CreditCardImportCommitResult> =>
    invoke("commit_credit_card_import", { sessionId }),
  creditCardInvoices: async (): Promise<CreditCardInvoice[]> => (isTauri() ? invoke("list_credit_card_invoices") : []),
  creditCardInvoicesPage: async (filter: { limit?: number; offset?: number }): Promise<CreditCardInvoicePage> => {
    if (isTauri()) return invoke("list_credit_card_invoices_page", { filter });
    return paginateDemo([], filter.limit, filter.offset);
  },
  creditCardInvoiceItems: (invoiceId: string): Promise<CreditCardInvoiceItem[]> =>
    invoke("get_credit_card_invoice_items", { invoiceId }),
  cardPaymentReconciliations: async (): Promise<CardPaymentReconciliation[]> =>
    isTauri() ? invoke("list_card_payment_reconciliations") : [],
  reconcileCardPayment: (
    paymentTransactionId: string,
    invoiceId?: string,
    bankTransactionId?: string,
  ): Promise<TransactionLink> =>
    invoke("reconcile_card_payment", {
      paymentTransactionId,
      invoiceId: invoiceId || null,
      bankTransactionId: bankTransactionId || null,
    }),
  invoicePaymentMatches: (invoiceId: string): Promise<PaymentMatchCandidate[]> =>
    invoke("find_invoice_payment_matches", { invoiceId }),
  cardPaymentMatches: (creditTransactionId: string): Promise<PaymentMatchCandidate[]> =>
    invoke("find_card_payment_matches", { creditTransactionId }),
  linkInvoicePayment: (invoiceId: string, bankTransactionId: string): Promise<TransactionLink> =>
    invoke("link_invoice_payment", { invoiceId, bankTransactionId }),
  unlinkInvoicePayment: (invoiceId: string): Promise<void> => invoke("unlink_invoice_payment", { invoiceId }),
  linkCardPayment: (creditTransactionId: string, bankTransactionId: string): Promise<TransactionLink> =>
    invoke("link_card_payment", { creditTransactionId, bankTransactionId }),
  unlinkCardPayment: (creditTransactionId: string): Promise<void> =>
    invoke("unlink_card_payment", { creditTransactionId }),
  setCreditCardInvoiceDeleted: (invoiceId: string, deleted: boolean): Promise<void> =>
    invoke("set_credit_card_invoice_deleted", { invoiceId, deleted }),
  setInvoiceStatus: (invoiceId: string, status: "paid" | "open"): Promise<void> =>
    invoke("set_invoice_status", { invoiceId, status }),
  financialReport: async (filter: ReportFilter): Promise<FinancialReport> => {
    if (isTauri()) return invoke("generate_financial_report", { filter });
    const monthly = [
      {
        month: "2026-01",
        incomeInCents: 720000,
        expensesInCents: 438000,
        investmentsInCents: 40000,
        savingsInCents: 282000,
        savingsRatePercent: 39,
      },
      {
        month: "2026-02",
        incomeInCents: 720000,
        expensesInCents: 482000,
        investmentsInCents: 45000,
        savingsInCents: 238000,
        savingsRatePercent: 33,
      },
      {
        month: "2026-03",
        incomeInCents: 760000,
        expensesInCents: 451000,
        investmentsInCents: 50000,
        savingsInCents: 309000,
        savingsRatePercent: 41,
      },
      {
        month: "2026-04",
        incomeInCents: 760000,
        expensesInCents: 526000,
        investmentsInCents: 50000,
        savingsInCents: 234000,
        savingsRatePercent: 31,
      },
      {
        month: "2026-05",
        incomeInCents: 780000,
        expensesInCents: 498000,
        investmentsInCents: 60000,
        savingsInCents: 282000,
        savingsRatePercent: 36,
      },
      {
        month: "2026-06",
        incomeInCents: 780000,
        expensesInCents: 503740,
        investmentsInCents: 60000,
        savingsInCents: 276260,
        savingsRatePercent: 35,
      },
    ];
    return {
      summary: {
        incomeInCents: 4520000,
        expensesInCents: 2898740,
        investmentsInCents: 305000,
        savingsInCents: 1621260,
        savingsRatePercent: 35.9,
        dailyAverageInCents: 16104,
        projectedExpensesInCents: 503740,
      },
      latestMonthSummary: {
        incomeInCents: 780000,
        expensesInCents: 503740,
        investmentsInCents: 60000,
        savingsInCents: 276260,
        incomeChangePercent: 0,
        expenseChangePercent: 1.2,
        savingsChangePercent: -2,
        savingsRatePercent: 35,
        dailyAverageInCents: 16791,
        projectedExpensesInCents: 503740,
      },
      previousSummary: {
        incomeInCents: 780000,
        expensesInCents: 498000,
        investmentsInCents: 60000,
        savingsInCents: 282000,
        dailyAverageInCents: 16064,
        projectedExpensesInCents: 498000,
      },
      currentInvestedInCents: 485000,
      monthly,
      categories: [
        { categoryId: "food", category: "Alimentação", color: "#e5a142", amountInCents: 168000, sharePercent: 33 },
        { categoryId: "housing", category: "Moradia", color: "#728bba", amountInCents: 142000, sharePercent: 28 },
        { categoryId: "transport", category: "Transporte", color: "#a778ba", amountInCents: 82000, sharePercent: 16 },
        { categoryId: "health", category: "Saúde", color: "#d66d68", amountInCents: 61000, sharePercent: 12 },
      ],
      kindBreakdown: [
        {
          kind: "income",
          totalInCents: 4520000,
          categories: [
            { categoryId: "salary", category: "Salário", color: "#22835f", amountInCents: 4520000, sharePercent: 100 },
          ],
        },
        {
          kind: "expense",
          totalInCents: 2898740,
          categories: [
            { categoryId: "food", category: "Alimentação", color: "#e5a142", amountInCents: 168000, sharePercent: 33 },
            { categoryId: "housing", category: "Moradia", color: "#728bba", amountInCents: 142000, sharePercent: 28 },
            {
              categoryId: "transport",
              category: "Transporte",
              color: "#a778ba",
              amountInCents: 82000,
              sharePercent: 16,
            },
            { categoryId: "health", category: "Saúde", color: "#d66d68", amountInCents: 61000, sharePercent: 12 },
          ],
        },
        {
          kind: "investment",
          totalInCents: 305000,
          categories: [
            {
              categoryId: "investments",
              category: "Investimentos",
              color: "#1a5b82",
              amountInCents: 305000,
              sharePercent: 100,
            },
          ],
        },
      ],
      merchants: [
        {
          merchant: "SUPERMERCADOS BH",
          merchantKey: "SUPERMERCADOS BH",
          originalName: "SUPERMERCADOS BH",
          amountInCents: 92300,
          transactionCount: 4,
        },
        {
          merchant: "MERCADOLIVRE",
          merchantKey: "MERCADOLIVRE",
          originalName: "MERCADOLIVRE",
          amountInCents: 79139,
          transactionCount: 2,
        },
      ],
      daily: [
        { date: "2026-06-05", amountInCents: 68000, cumulativeInCents: 68000 },
        { date: "2026-06-12", amountInCents: 94000, cumulativeInCents: 162000 },
        { date: "2026-06-20", amountInCents: 121000, cumulativeInCents: 283000 },
        { date: "2026-06-30", amountInCents: 220740, cumulativeInCents: 503740 },
      ],
      sources: [
        { source: "bank", amountInCents: 198000, sharePercent: 39 },
        { source: "credit_card", amountInCents: 305740, sharePercent: 61 },
      ],
      goals: [],
      invoices: { openCount: 1, paidCount: 2, openTotalInCents: 106477 },
      uncategorizedCount: 2,
      uncategorizedInCents: 2690,
      highestSpendingDay: { date: "2026-06-20", amountInCents: 121000, cumulativeInCents: 283000 },
      monthlyAverageInCents: 483123,
      cardSharePercent: 61,
      alerts: ["As despesas subiram 1% em relação ao mês anterior.", "2 transações ainda estão sem categoria."],
    };
  },
  financialTargets: async (): Promise<FinancialTarget[]> => (isTauri() ? invoke("list_financial_targets") : []),
  saveFinancialTarget: (input: FinancialTargetInput): Promise<string> =>
    invoke("save_financial_target", {
      input: { ...input, includeDescendants: input.includeDescendants ?? false },
    }),
  saveFinancialTargetOverride: (targetId: string, month: string, amountInCents: number): Promise<void> =>
    invoke("save_financial_target_override", { targetId, month, amountInCents }),
  deleteFinancialTarget: (id: string): Promise<void> => invoke("delete_financial_target", { id }),
  categoryTrend: (filter: CategoryTrendFilter): Promise<CategoryTrendPoint[]> => {
    if (isTauri()) return invoke("category_trend", { filter: { ...filter, categoryId: filter.categoryId || null } });
    const end = filter.endMonth;
    const base = [
      { month: "2026-01", amountInCents: 71000 },
      { month: "2026-02", amountInCents: 83000 },
      { month: "2026-03", amountInCents: 64500 },
      { month: "2026-04", amountInCents: 93000 },
      { month: "2026-05", amountInCents: 78500 },
      { month: end, amountInCents: filter.categoryId ? 88000 : 2690 },
    ];
    return Promise.resolve(base.slice(-Math.max(1, Math.min(filter.months, 24))));
  },
  recurringTransactions: async (): Promise<RecurringTransaction[]> =>
    isTauri() ? invoke("list_recurring_transactions") : [],
  saveRecurringTransaction: (input: RecurringTransactionInput): Promise<string> =>
    invoke("save_recurring_transaction", { input }),
  setRecurringTransactionActive: (id: string, active: boolean): Promise<void> =>
    invoke("set_recurring_transaction_active", { id, active }),
  archiveRecurringTransaction: (id: string): Promise<void> => invoke("archive_recurring_transaction", { id }),
  syncRecurringTransactions: (): Promise<number> =>
    isTauri() ? invoke("sync_recurring_transactions") : Promise.resolve(0),
  merchantAliases: (): Promise<MerchantAlias[]> =>
    isTauri()
      ? invoke("list_merchant_aliases")
      : Promise.resolve(
          demoMerchants
            .filter((merchant) => merchant.alias)
            .map((merchant) => ({
              id: `demo-${merchant.merchantKey}`,
              merchantKey: merchant.merchantKey,
              displayName: merchant.alias!,
            })),
        ),
  saveMerchantAlias: async (merchantKey: string, displayName: string): Promise<string> => {
    if (isTauri()) return invoke("save_merchant_alias", { input: { merchantKey, displayName } });
    const merchant = demoMerchants.find((item) => item.merchantKey === merchantKey);
    if (merchant) {
      merchant.alias = displayName;
      merchant.merchant = displayName;
    }
    return `demo-${merchantKey}`;
  },
  deleteMerchantAlias: async (id: string): Promise<void> => {
    if (isTauri()) return invoke("delete_merchant_alias", { id });
    const merchant = demoMerchants.find((item) => `demo-${item.merchantKey}` === id);
    if (merchant) {
      merchant.alias = undefined;
      merchant.merchant = merchant.originalName;
    }
  },
  netWorthHistory: async (months = 12): Promise<NetWorthPoint[]> => {
    if (isTauri()) return invoke("net_worth_history", { months });
    const base = 300000;
    return Array.from({ length: months }, (_, i) => {
      const totalInCents = base + i * 45000;
      const liabilitiesInCents = -80_000 - i * 2_000;
      const assetsInCents = totalInCents - liabilitiesInCents;
      const monthDate = new Date();
      monthDate.setDate(1);
      monthDate.setMonth(monthDate.getMonth() - months + i + 1);
      return {
        month: `${monthDate.getFullYear()}-${String(monthDate.getMonth() + 1).padStart(2, "0")}`,
        totalInCents,
        assetsInCents,
        liabilitiesInCents,
        perKind: [
          { kind: "checking" as AccountType, amountInCents: assetsInCents },
          { kind: "credit_card" as AccountType, amountInCents: liabilitiesInCents },
        ],
      };
    });
  },
  upcomingItems: async (days = 15): Promise<UpcomingItem[]> => {
    if (isTauri()) return invoke("upcoming_items", { days });
    return [];
  },
  budgetOverview: async (month: string): Promise<BudgetOverview> => {
    if (isTauri()) return invoke("budget_overview", { month });
    return { categories: [], totals: { limitInCents: 0, spentInCents: 0 }, hasOverlappingScopes: false };
  },
};
