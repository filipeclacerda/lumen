export type AccountType = "checking" | "savings" | "cash" | "credit_card";
export type Account = { id: string; name: string; kind: AccountType; balanceInCents: number };
export type FinancialGoal = "organize" | "emergency_fund" | "pay_debt" | "save" | "invest";
export type UserProfile = {
  displayName: string;
  monthlyIncomeInCents?: number;
  incomeDay?: number;
  financialGoal?: FinancialGoal;
  onboardingCompletedAt: string;
};
export type OnboardingInput = {
  displayName: string;
  monthlyIncomeInCents?: number;
  incomeDay?: number;
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
  id: string; accountId: string; accountName: string; accountKind: AccountType;
  date: string; description: string;
  amountInCents: number; categoryId?: string; category?: string;
  categorySource?: "manual" | "rule"; status: "cleared" | "pending";
};
export type CategoryKind = "income" | "expense" | "transfer" | "investment";
export type Category = {
  id: string; parentId?: string; name: string; color?: string; icon?: string;
  kind: CategoryKind; sortOrder: number; isSystem: boolean;
};
export type RuleOperator = "contains" | "starts_with" | "regex";
export type MovementType = "any" | "income" | "expense" | "transfer" | "investment";
export type RuleCondition = {
  operator: RuleOperator; pattern: string; accountId?: string; movementType: MovementType;
  minAmountInCents?: number; maxAmountInCents?: number;
};
export type CategorizationRule = RuleCondition & {
  id: string; name: string; priority: number; enabled: boolean; categoryId: string;
  categoryName?: string; useCount: number; isSystem: boolean;
};
export type RuleInput = Omit<CategorizationRule, "id" | "categoryName" | "useCount" | "isSystem"> & { id?: string };
export type RuleImpact = {
  count: number;
  sample: { transactionId: string; date: string; description: string; currentCategory?: string; suggestedCategory: string }[];
};
export type DashboardSummary = {
  incomeInCents: number; expensesInCents: number; investmentsInCents: number; balanceInCents: number;
  transactionCount: number; byCategory: { category: string; amountInCents: number }[];
};
export type ImportCandidate = {
  sourceRow: number; date: string; description: string; normalizedDescription: string;
  amountInCents: number; externalId?: string; suggestedCategoryId?: string;
  suggestedCategoryName?: string; suggestedRuleId?: string; suggestedRuleName?: string;
  duplicateStatus: "new" | "probable" | "exact"; warnings: string[]; included: boolean;
};
export type ImportPreview = { sessionId: string; fileName: string; candidates: ImportCandidate[] };
export type CreditCardImportItem = {
  candidate: ImportCandidate;
  holder?: string;
  installment?: string;
  rawAmountInCents: number;
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
export type ReportSource = "all" | "bank" | "credit_card";
export type ReportFilter = { startMonth:string; endMonth:string; source:ReportSource; accountId?:string };
export type ReportSummary = {
  incomeInCents:number; expensesInCents:number; investmentsInCents:number; savingsInCents:number;
  incomeChangePercent?:number; expenseChangePercent?:number; savingsChangePercent?:number;
  savingsRatePercent?:number; dailyAverageInCents:number; projectedExpensesInCents:number;
};
export type MonthlyReportPoint = {
  month:string; incomeInCents:number; expensesInCents:number; investmentsInCents:number;
  savingsInCents:number; savingsRatePercent?:number;
};
export type CategoryReport = {
  categoryId?:string; category:string; color?:string; amountInCents:number; sharePercent:number;
};
export type MerchantReport = { merchant:string; amountInCents:number; transactionCount:number };
export type DailyReportPoint = { date:string; amountInCents:number; cumulativeInCents:number };
export type GoalProgress = {
  targetId:string; kind:"savings"|"category"; categoryId?:string; label:string;
  targetInCents:number; actualInCents:number; remainingInCents:number; progressPercent:number;
  projectedInCents:number; projectedToExceed:boolean;
};
export type FinancialTarget = {
  id:string; kind:"savings"|"category"; categoryId?:string; categoryName?:string;
  amountInCents:number; enabled:boolean;
  overrides:{month:string;amountInCents:number}[];
};
export type FinancialTargetInput = Omit<FinancialTarget,"id"|"categoryName"|"overrides">&{id?:string};
export type FinancialReport = {
  summary:ReportSummary; previousSummary:ReportSummary; monthly:MonthlyReportPoint[];
  categories:CategoryReport[]; merchants:MerchantReport[]; daily:DailyReportPoint[];
  sources:{source:"bank"|"credit_card";amountInCents:number;sharePercent:number}[];
  goals:GoalProgress[]; invoices:{openCount:number;paidCount:number;openTotalInCents:number};
  uncategorizedCount:number; uncategorizedInCents:number; highestSpendingDay?:DailyReportPoint;
  monthlyAverageInCents:number; cardSharePercent:number; alerts:string[];
};
