import { invoke } from "@tauri-apps/api/core";
import type { Account, AppBootstrap, Category, CategorizationRule, CreditCardImportPreview, CreditCardInvoice, CreditCardInvoiceItem, DashboardSummary, ImportPreview, OnboardingInput, OnboardingResult, PaymentMatchCandidate, RuleImpact, RuleInput, Transaction, TransactionLink, UserProfile } from "./types";

const demoTransactions: Transaction[] = [
  { id: "1", accountId: "card", accountName:"Cartão principal", accountKind:"credit_card", date: "2026-06-26", description: "Supermercado Aurora", amountInCents: -28490, categoryId: "groceries", category: "Supermercado", categorySource: "rule", status: "cleared" },
  { id: "2", accountId: "demo", accountName:"Conta principal", accountKind:"checking", date: "2026-06-25", description: "Salário", amountInCents: 780000, categoryId: "salary", category: "Salário", categorySource: "rule", status: "cleared" },
  { id: "3", accountId: "demo", accountName:"Conta principal", accountKind:"checking", date: "2026-06-23", description: "Energia elétrica", amountInCents: -18734, categoryId: "utilities", category: "Água, luz e gás", categorySource: "rule", status: "cleared" },
  { id: "4", accountId: "card", accountName:"Cartão principal", accountKind:"credit_card", date: "2026-06-21", description: "Café do Centro", amountInCents: -3250, categoryId: "food", category: "Alimentação", status: "cleared" }
];
const demoCategories: Category[] = [
  { id:"income",name:"Receitas",color:"#22835f",kind:"income",sortOrder:0,isSystem:true },
  { id:"salary",parentId:"income",name:"Salário",color:"#22835f",kind:"income",sortOrder:10,isSystem:true },
  { id:"food",name:"Alimentação",color:"#e5a142",kind:"expense",sortOrder:20,isSystem:true },
  { id:"groceries",parentId:"food",name:"Supermercado",color:"#e5a142",kind:"expense",sortOrder:30,isSystem:true },
  { id:"housing",name:"Moradia",color:"#728bba",kind:"expense",sortOrder:40,isSystem:true },
  { id:"utilities",parentId:"housing",name:"Água, luz e gás",color:"#728bba",kind:"expense",sortOrder:50,isSystem:true },
  { id:"transfers",name:"Transferências",color:"#6d7d78",kind:"transfer",sortOrder:140,isSystem:true }
];
const demoRules: CategorizationRule[] = [
  { id:"default-salary",name:"Salário identificado",priority:1000,enabled:true,operator:"contains",pattern:"SALARIO",movementType:"income",categoryId:"salary",categoryName:"Salário",useCount:1,isSystem:true },
  { id:"default-supermarket",name:"Supermercado",priority:1010,enabled:true,operator:"contains",pattern:"SUPERMERC",movementType:"expense",categoryId:"groceries",categoryName:"Supermercado",useCount:1,isSystem:true }
];

const isTauri = () => "__TAURI_INTERNALS__" in window;
const demoProfile = (): UserProfile | undefined => {
  const stored = localStorage.getItem("financa-demo-profile");
  return stored ? JSON.parse(stored) as UserProfile : undefined;
};
export const api = {
  bootstrap: async (): Promise<AppBootstrap> => {
    if (isTauri()) return invoke("get_app_bootstrap");
    const profile = demoProfile();
    return { profile, onboardingCompleted: Boolean(profile), account: { id:"demo",name:"Conta principal",kind:"checking",balanceInCents:0 }, hasTransactions:false };
  },
  profile: async (): Promise<UserProfile | undefined> => isTauri() ? invoke("get_profile") : demoProfile(),
  completeOnboarding: async (input: OnboardingInput): Promise<OnboardingResult> => {
    if (isTauri()) return invoke("complete_onboarding", { input });
    const profile: UserProfile = {
      displayName:input.displayName,monthlyIncomeInCents:input.monthlyIncomeInCents,
      incomeDay:input.incomeDay,financialGoal:input.financialGoal,onboardingCompletedAt:new Date().toISOString()
    };
    localStorage.setItem("financa-demo-profile", JSON.stringify(profile));
    return { profile, accountId:"demo" };
  },
  saveProfile: async (input: Omit<UserProfile,"onboardingCompletedAt">): Promise<UserProfile> => {
    if (isTauri()) return invoke("save_profile", { input });
    const profile={...input,onboardingCompletedAt:demoProfile()?.onboardingCompletedAt??new Date().toISOString()};
    localStorage.setItem("financa-demo-profile",JSON.stringify(profile)); return profile;
  },
  accounts: async (): Promise<Account[]> => isTauri() ? invoke("list_accounts") : [{ id: "demo", name: "Conta principal", kind: "checking", balanceInCents: 549526 }],
  transactions: async (month?: string): Promise<Transaction[]> => isTauri() ? invoke("list_transactions", { month: month || null }) : demoTransactions,
  summary: async (month?: string): Promise<DashboardSummary> => isTauri() ? invoke("dashboard_summary", { month: month || null }) : {
    incomeInCents: 780000, expensesInCents: 50374, investmentsInCents: 20000, balanceInCents: 729626, transactionCount: 4,
    byCategory: [{ category: "Alimentação", amountInCents: 31740 }, { category: "Moradia", amountInCents: 18734 }]
  },
  categories: async (): Promise<Category[]> => isTauri() ? invoke("list_categories") : demoCategories,
  saveCategory: (input: Partial<Category>): Promise<string> => invoke("save_category", { input }),
  archiveCategory: (id: string): Promise<void> => invoke("archive_category", { id }),
  rules: async (): Promise<CategorizationRule[]> => isTauri() ? invoke("list_rules") : demoRules,
  saveRule: (input: RuleInput): Promise<string> => invoke("save_rule", { input }),
  archiveRule: (id: string): Promise<void> => invoke("archive_rule", { id }),
  reorderRules: (ids: string[]): Promise<void> => invoke("reorder_rules", { ids }),
  previewRule: (input: RuleInput, overwriteManual = false): Promise<RuleImpact> => invoke("preview_rule", { input, overwriteManual }),
  previewAllRules: (overwriteManual = false): Promise<RuleImpact> => invoke("preview_rules_retroactive", { overwriteManual }),
  applyRules: (overwriteManual = false): Promise<number> => invoke("apply_rules_retroactive", { overwriteManual }),
  updateTransactionCategory: (transactionId: string, categoryId?: string): Promise<void> =>
    invoke("update_transaction_category", { transactionId, categoryId: categoryId || null }),
  updateTransactionAmount: (transactionId: string, amountInCents: number): Promise<void> =>
    invoke("update_transaction_amount", { transactionId, amountInCents }),
  bulkUpdateTransactionCategory: (transactionIds: string[], categoryId?: string): Promise<number> =>
    invoke("bulk_update_transaction_category", { transactionIds, categoryId: categoryId || null }),
  deleteTransactions: (transactionIds: string[]): Promise<number> =>
    invoke("delete_transactions", { transactionIds }),
  restoreTransactions: (transactionIds: string[]): Promise<number> =>
    invoke("restore_transactions", { transactionIds }),
  previewImport: (path: string, accountId: string): Promise<ImportPreview> => invoke("preview_import", { path, accountId }),
  updateImportCandidate: (sessionId: string, sourceRow: number, amountInCents: number, included: boolean): Promise<ImportPreview["candidates"][number]> =>
    invoke("update_import_candidate", { sessionId, sourceRow, amountInCents, included }),
  setImportCategory: (sessionId: string, sourceRow: number, categoryId?: string): Promise<void> =>
    invoke("set_import_candidate_category", { sessionId, sourceRow, categoryId: categoryId || null }),
  commitImport: (sessionId: string): Promise<number> => invoke("commit_import", { sessionId })
  ,
  detectImportKind: (path: string): Promise<"bank" | "credit_card"> => invoke("detect_import_kind", { path }),
  createCreditCardAccount: (name: string): Promise<string> => invoke("create_credit_card_account", { name }),
  previewCreditCardImport: (path: string, accountId: string, dueDate?: string): Promise<CreditCardImportPreview> =>
    invoke("preview_credit_card_import", { path, accountId, dueDate: dueDate || null }),
  updateCreditCardImport: (
    sessionId: string, sourceRow: number, included: boolean, categoryId?: string, dueDate?: string
  ): Promise<CreditCardImportPreview> =>
    invoke("update_credit_card_import", { sessionId, sourceRow, included, categoryId: categoryId || null, dueDate: dueDate || null }),
  commitCreditCardImport: (sessionId: string): Promise<string> =>
    invoke("commit_credit_card_import", { sessionId }),
  creditCardInvoices: async (): Promise<CreditCardInvoice[]> =>
    isTauri() ? invoke("list_credit_card_invoices") : [],
  creditCardInvoiceItems: (invoiceId: string): Promise<CreditCardInvoiceItem[]> =>
    invoke("get_credit_card_invoice_items", { invoiceId }),
  invoicePaymentMatches: (invoiceId: string): Promise<PaymentMatchCandidate[]> =>
    invoke("find_invoice_payment_matches", { invoiceId }),
  cardPaymentMatches: (creditTransactionId: string): Promise<PaymentMatchCandidate[]> =>
    invoke("find_card_payment_matches", { creditTransactionId }),
  linkInvoicePayment: (invoiceId: string, bankTransactionId: string): Promise<TransactionLink> =>
    invoke("link_invoice_payment", { invoiceId, bankTransactionId }),
  unlinkInvoicePayment: (invoiceId: string): Promise<void> =>
    invoke("unlink_invoice_payment", { invoiceId }),
  linkCardPayment: (creditTransactionId: string, bankTransactionId: string): Promise<TransactionLink> =>
    invoke("link_card_payment", { creditTransactionId, bankTransactionId }),
  unlinkCardPayment: (creditTransactionId: string): Promise<void> =>
    invoke("unlink_card_payment", { creditTransactionId }),
  setCreditCardInvoiceDeleted: (invoiceId: string, deleted: boolean): Promise<void> =>
    invoke("set_credit_card_invoice_deleted", { invoiceId, deleted })
};
