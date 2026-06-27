import { invoke } from "@tauri-apps/api/core";
import type { Account, Category, CategorizationRule, DashboardSummary, ImportPreview, RuleImpact, RuleInput, Transaction } from "./types";

const demoTransactions: Transaction[] = [
  { id: "1", accountId: "demo", date: "2026-06-26", description: "Supermercado Aurora", amountInCents: -28490, categoryId: "groceries", category: "Supermercado", categorySource: "rule", status: "cleared" },
  { id: "2", accountId: "demo", date: "2026-06-25", description: "Salário", amountInCents: 780000, categoryId: "salary", category: "Salário", categorySource: "rule", status: "cleared" },
  { id: "3", accountId: "demo", date: "2026-06-23", description: "Energia elétrica", amountInCents: -18734, categoryId: "utilities", category: "Água, luz e gás", categorySource: "rule", status: "cleared" },
  { id: "4", accountId: "demo", date: "2026-06-21", description: "Café do Centro", amountInCents: -3250, categoryId: "food", category: "Alimentação", status: "cleared" }
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
export const api = {
  accounts: async (): Promise<Account[]> => isTauri() ? invoke("list_accounts") : [{ id: "demo", name: "Conta principal", kind: "checking", balanceInCents: 549526 }],
  transactions: async (): Promise<Transaction[]> => isTauri() ? invoke("list_transactions") : demoTransactions,
  summary: async (): Promise<DashboardSummary> => isTauri() ? invoke("dashboard_summary") : {
    incomeInCents: 780000, expensesInCents: 50374, balanceInCents: 729626, transactionCount: 4,
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
  bulkUpdateTransactionCategory: (transactionIds: string[], categoryId?: string): Promise<number> =>
    invoke("bulk_update_transaction_category", { transactionIds, categoryId: categoryId || null }),
  deleteTransactions: (transactionIds: string[]): Promise<number> =>
    invoke("delete_transactions", { transactionIds }),
  restoreTransactions: (transactionIds: string[]): Promise<number> =>
    invoke("restore_transactions", { transactionIds }),
  previewImport: (path: string, accountId: string): Promise<ImportPreview> => invoke("preview_import", { path, accountId }),
  setImportCategory: (sessionId: string, sourceRow: number, categoryId?: string): Promise<void> =>
    invoke("set_import_candidate_category", { sessionId, sourceRow, categoryId: categoryId || null }),
  commitImport: (sessionId: string): Promise<number> => invoke("commit_import", { sessionId })
};
