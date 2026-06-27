export type AccountType = "checking" | "savings" | "cash" | "credit_card";
export type Account = { id: string; name: string; kind: AccountType; balanceInCents: number };
export type Transaction = {
  id: string; accountId: string; date: string; description: string;
  amountInCents: number; categoryId?: string; category?: string;
  categorySource?: "manual" | "rule"; status: "cleared" | "pending";
};
export type CategoryKind = "income" | "expense" | "transfer";
export type Category = {
  id: string; parentId?: string; name: string; color?: string; icon?: string;
  kind: CategoryKind; sortOrder: number; isSystem: boolean;
};
export type RuleOperator = "contains" | "starts_with" | "regex";
export type MovementType = "any" | "income" | "expense" | "transfer";
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
  incomeInCents: number; expensesInCents: number; balanceInCents: number;
  transactionCount: number; byCategory: { category: string; amountInCents: number }[];
};
export type ImportCandidate = {
  sourceRow: number; date: string; description: string; normalizedDescription: string;
  amountInCents: number; externalId?: string; suggestedCategoryId?: string;
  suggestedCategoryName?: string; suggestedRuleId?: string; suggestedRuleName?: string;
  duplicateStatus: "new" | "probable" | "exact"; warnings: string[];
};
export type ImportPreview = { sessionId: string; fileName: string; candidates: ImportCandidate[] };
