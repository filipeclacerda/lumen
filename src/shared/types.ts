export type AccountType = "checking" | "savings" | "cash" | "credit_card";
export type Account = { id: string; name: string; kind: AccountType; balanceInCents: number };
export type FinancialGoal = "organize" | "emergency_fund" | "pay_debt" | "save" | "invest";
export type IncomeDayRule = "fifth_business_day";
export type UserProfile = {
  displayName: string;
  monthlyIncomeInCents?: number;
  incomeDay?: number;
  incomeDayRule?: IncomeDayRule;
  financialGoal?: FinancialGoal;
  onboardingCompletedAt: string;
};
export type OnboardingInput = {
  displayName: string;
  monthlyIncomeInCents?: number;
  incomeDay?: number;
  incomeDayRule?: IncomeDayRule;
  financialGoal?: FinancialGoal;
  accountName: string;
  accountKind: Exclude<AccountType, "credit_card">;
  openingBalanceInCents?: number;
};
export type AppBootstrap = {
  profile?: UserProfile;
  onboardingCompleted: boolean;
  account?: Account;
  hasTransactions: boolean;
};
export type OnboardingResult = { profile: UserProfile; accountId: string };
export type Transaction = {
  id: string;
  accountId: string;
  accountName: string;
  accountKind: AccountType;
  date: string;
  description: string;
  amountInCents: number;
  categoryId?: string;
  category?: string;
  categorySource?: "manual" | "rule";
  status: "cleared" | "pending";
  isTransferLeg: boolean;
};
export type TransactionFilter = {
  month?: string;
  startMonth?: string;
  endMonth?: string;
  source?: ReportSource;
  accountId?: string;
  categoryId?: string;
  uncategorized?: boolean;
  search?: string;
  limit?: number;
  offset?: number;
  startDate?: string;
  endDate?: string;
  status?: "cleared" | "pending";
  movementType?: "income" | "expense" | "transfer" | "investment";
  minAbsAmountInCents?: number;
  maxAbsAmountInCents?: number;
  merchantKey?: string;
};
export type Page<T> = { items: T[]; totalCount: number };
export type TransactionPage = Page<Transaction>;
export type TransactionInput = {
  id?: string;
  accountId: string;
  date: string;
  description: string;
  amountInCents: number;
  categoryId?: string;
};
export type TransferInput = {
  fromAccountId: string;
  toAccountId: string;
  date: string;
  amountInCents: number;
  description?: string;
};
export type CategoryKind = "income" | "expense" | "transfer" | "investment";
export type Category = {
  id: string;
  parentId?: string;
  name: string;
  color?: string;
  icon?: string;
  kind: CategoryKind;
  sortOrder: number;
  isSystem: boolean;
};
export type RuleOperator = "contains" | "starts_with" | "regex";
export type MovementType = "any" | "income" | "expense" | "transfer";
export type RuleCondition = {
  operator: RuleOperator;
  pattern: string;
  accountId?: string;
  movementType: MovementType;
  minAmountInCents?: number;
  maxAmountInCents?: number;
};
export type CategorizationRule = RuleCondition & {
  id: string;
  name: string;
  priority: number;
  enabled: boolean;
  categoryId: string;
  categoryName?: string;
  useCount: number;
  isSystem: boolean;
};
export type RuleInput = Omit<CategorizationRule, "id" | "categoryName" | "useCount" | "isSystem"> & { id?: string };
export type RuleImpact = {
  count: number;
  sample: {
    transactionId: string;
    date: string;
    description: string;
    currentCategory?: string;
    suggestedCategory: string;
  }[];
};
export type DashboardSummary = {
  incomeInCents: number;
  expensesInCents: number;
  investmentsInCents: number;
  balanceInCents: number;
  transactionCount: number;
  byCategory: { category: string; amountInCents: number }[];
};
export type ImportCandidate = {
  sourceRow: number;
  date: string;
  description: string;
  normalizedDescription: string;
  amountInCents: number;
  externalId?: string;
  suggestedCategoryId?: string;
  suggestedCategoryName?: string;
  suggestedRuleId?: string;
  suggestedRuleName?: string;
  suggestionSource?: "rule" | "history";
  duplicateStatus: "new" | "probable" | "exact";
  warnings: string[];
  included: boolean;
};
export type ImportSourceKind = "bank" | "credit_card";
export type CsvColumnRole =
  | "ignore"
  | "date"
  | "description"
  | "signed_amount"
  | "debit_amount"
  | "credit_amount"
  | "external_id"
  | "balance"
  | "purchase_date"
  | "holder"
  | "installment"
  | "row_kind"
  | "due_date";
export type CsvColumnMapping = { index: number; header: string; role: CsvColumnRole };
export type CsvMappingDraft = {
  sourceKind: ImportSourceKind;
  delimiter: string;
  dateFormat?: string;
  decimalSeparator?: "comma" | "dot";
  defaultDueDate?: string;
  profileName?: string;
  columns: CsvColumnMapping[];
};
export type CsvMappingProfile = {
  id: string;
  name: string;
  sourceKind: ImportSourceKind;
  delimiter: string;
  dateFormat?: string;
  decimalSeparator?: "comma" | "dot";
  signature: string;
  columns: CsvColumnMapping[];
};
export type NormalizedImportRow = {
  sourceRow: number;
  sourceKind: ImportSourceKind;
  date: string;
  description: string;
  amountInCents: number;
  externalId?: string;
  rowKind?: string;
  holder?: string;
  installment?: string;
  dueDate?: string;
  warnings: string[];
};
export type ImportFileInspection = {
  fileName: string;
  detectedKind: "known_bank" | "known_credit_card" | "unknown_csv";
  delimiter?: string;
  headers: string[];
  sampleRows: string[][];
  matchedProfiles: CsvMappingProfile[];
  suggestedSourceKind?: ImportSourceKind;
};
export type TemplateKind = "bank" | "credit_card";
export type ImportPreview = { sessionId: string; fileName: string; candidates: ImportCandidate[] };
export type CreditCardLineKind = "purchase" | "refund" | "payment";
export type CreditCardImportItem = {
  candidate: ImportCandidate;
  holder?: string;
  installment?: string;
  rawAmountInCents: number;
  lineKind: CreditCardLineKind;
  included: boolean;
  isPayment: boolean;
};
export type CreditCardImportPreview = {
  sessionId: string;
  fileName: string;
  accountId: string;
  dueDate: string;
  purchasesInCents: number;
  creditsInCents: number;
  totalInCents: number;
  items: CreditCardImportItem[];
};
export type CreditCardInvoice = {
  id: string;
  accountId: string;
  accountName: string;
  dueDate: string;
  purchasesInCents: number;
  creditsInCents: number;
  totalInCents: number;
  status: "open" | "paid";
  paymentTransactionId?: string;
  paymentDescription?: string;
  paymentDate?: string;
};
export type CreditCardInvoicePage = Page<CreditCardInvoice>;
export type CreditCardInvoiceItem = {
  transactionId: string;
  date: string;
  description: string;
  amountInCents: number;
  categoryId?: string;
  categoryName?: string;
  holder?: string;
  installment?: string;
  sourceRow: number;
  lineKind: CreditCardLineKind;
  isPayment: boolean;
  isLinked: boolean;
};
export type PaymentMatchCandidate = {
  transactionId: string;
  accountName: string;
  date: string;
  description: string;
  amountInCents: number;
  distanceInDays: number;
};
export type TransactionLink = {
  id: string;
  debitTransactionId: string;
  creditTransactionId?: string;
  invoiceId?: string;
};
export type TransferCandidate = {
  debitTransactionId: string;
  debitAccountName: string;
  debitDate: string;
  debitDescription: string;
  creditTransactionId: string;
  creditAccountName: string;
  creditDate: string;
  creditDescription: string;
  amountInCents: number;
};
export type CommitImportResult = {
  count: number;
  batchId: string;
};
export type ReportSource = "all" | "bank" | "credit_card";
export type ReportFilter = { startMonth: string; endMonth: string; source: ReportSource; accountId?: string };
export type CategoryTrendFilter = {
  categoryId?: string;
  endMonth: string;
  source: ReportSource;
  accountId?: string;
  months: number;
};
export type ReportSummary = {
  incomeInCents: number;
  expensesInCents: number;
  investmentsInCents: number;
  savingsInCents: number;
  incomeChangePercent?: number;
  expenseChangePercent?: number;
  savingsChangePercent?: number;
  savingsRatePercent?: number;
  dailyAverageInCents: number;
  projectedExpensesInCents: number;
};
export type MonthlyReportPoint = {
  month: string;
  incomeInCents: number;
  expensesInCents: number;
  investmentsInCents: number;
  savingsInCents: number;
  savingsRatePercent?: number;
};
export type CategoryReport = {
  categoryId?: string;
  category: string;
  color?: string;
  amountInCents: number;
  sharePercent: number;
};
export type KindBreakdown = {
  kind: CategoryKind;
  totalInCents: number;
  categories: CategoryReport[];
};
export type MerchantReport = {
  /** Nome exibido; mantido para os rankings de relatórios. */
  merchant: string;
  merchantKey: string;
  originalName: string;
  alias?: string;
  amountInCents: number;
  transactionCount: number;
};
export type MerchantPageFilter = {
  search?: string;
  sort?: "transaction_count" | "name" | "amount";
  limit?: number;
  offset?: number;
};
export type MerchantPage = Page<MerchantReport>;
export type MerchantAlias = { id: string; merchantKey: string; displayName: string };
export type DailyReportPoint = { date: string; amountInCents: number; cumulativeInCents: number };
export type GoalProgress = {
  targetId: string;
  kind: "savings" | "category";
  categoryId?: string;
  label: string;
  targetInCents: number;
  actualInCents: number;
  remainingInCents: number;
  progressPercent: number;
  projectedInCents: number;
  projectedToExceed: boolean;
};
export type FinancialTarget = {
  id: string;
  kind: "savings" | "category";
  categoryId?: string;
  categoryName?: string;
  amountInCents: number;
  enabled: boolean;
  overrides: { month: string; amountInCents: number }[];
};
export type FinancialTargetInput = Omit<FinancialTarget, "id" | "categoryName" | "overrides"> & { id?: string };
export type CategoryTrendPoint = { month: string; amountInCents: number };
export type NetWorthKindAmount = { kind: AccountType; amountInCents: number };
export type NetWorthPoint = { month: string; totalInCents: number; perKind: NetWorthKindAmount[] };
export type UpcomingItem = { date: string; label: string; amountInCents: number; kind: "invoice" | "recurring" };
export type BudgetStatus = "ok" | "warning" | "over";
export type BudgetCategory = {
  targetId: string;
  categoryId: string;
  categoryName: string;
  categoryColor?: string;
  limitInCents: number;
  spentInCents: number;
  remainingInCents: number;
  progressPercent: number;
  projectedInCents: number;
  status: BudgetStatus;
};
export type BudgetOverview = { categories: BudgetCategory[]; totals: { limitInCents: number; spentInCents: number } };
export type RecurringTransaction = {
  id: string;
  accountId: string;
  accountName: string;
  categoryId?: string;
  categoryName?: string;
  description: string;
  amountInCents: number;
  dayOfMonth: number;
  startMonth: string;
  endMonth?: string;
  lastGeneratedMonth?: string;
  active: boolean;
};
export type RecurringTransactionInput = {
  id?: string;
  accountId: string;
  categoryId?: string;
  description: string;
  amountInCents: number;
  dayOfMonth: number;
  startMonth: string;
  endMonth?: string;
};
export type FinancialReport = {
  summary: ReportSummary;
  latestMonthSummary: ReportSummary;
  previousSummary: ReportSummary;
  currentInvestedInCents: number;
  monthly: MonthlyReportPoint[];
  categories: CategoryReport[];
  kindBreakdown: KindBreakdown[];
  merchants: MerchantReport[];
  daily: DailyReportPoint[];
  sources: { source: "bank" | "credit_card"; amountInCents: number; sharePercent: number }[];
  goals: GoalProgress[];
  invoices: { openCount: number; paidCount: number; openTotalInCents: number };
  uncategorizedCount: number;
  uncategorizedInCents: number;
  highestSpendingDay?: DailyReportPoint;
  monthlyAverageInCents: number;
  cardSharePercent: number;
  alerts: string[];
};
