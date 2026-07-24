import type { QueryClient } from "@tanstack/react-query";

async function invalidateKeys(client: QueryClient, keys: readonly string[]) {
  await Promise.all(keys.map((key) => client.invalidateQueries({ queryKey: [key] })));
}

export function invalidateTransactionDerivedQueries(client: QueryClient) {
  return invalidateKeys(client, [
    "transactions",
    "summary",
    "accounts",
    "account-balance-summaries",
    "financial-report",
    "net-worth-history",
    "data-quality-review",
    "budget-overview",
    "upcoming-items",
  ]);
}

export function invalidateCheckpointQueries(client: QueryClient) {
  return invalidateKeys(client, ["account-balance-summaries", "accounts", "net-worth-history"]);
}

export function invalidateCategoryMergeQueries(client: QueryClient) {
  return invalidateKeys(client, [
    "financial-report",
    "net-worth-history",
    "summary",
    "budget-overview",
    "upcoming-items",
  ]);
}

export function invalidateFinancialTargetQueries(client: QueryClient, includeProfile: boolean) {
  return invalidateKeys(client, ["financial-report", "financial-targets", ...(includeProfile ? ["profile"] : [])]);
}
