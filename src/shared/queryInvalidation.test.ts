import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";
import {
  invalidateCategoryMergeQueries,
  invalidateCheckpointQueries,
  invalidateFinancialTargetQueries,
  invalidateTransactionDerivedQueries,
} from "./queryInvalidation";

function invalidatedKeys(run: (client: QueryClient) => Promise<unknown>) {
  const client = new QueryClient();
  const invalidate = vi.spyOn(client, "invalidateQueries").mockResolvedValue(undefined);
  return run(client).then(() => invalidate.mock.calls.map(([filters]) => filters?.queryKey?.[0]));
}

describe("query invalidation contracts", () => {
  it("refreshes every transaction-derived financial view", async () => {
    expect(await invalidatedKeys(invalidateTransactionDerivedQueries)).toEqual([
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
  });

  it("refreshes net worth after checkpoints and category merges", async () => {
    expect(await invalidatedKeys(invalidateCheckpointQueries)).toContain("net-worth-history");
    expect(await invalidatedKeys(invalidateCategoryMergeQueries)).toEqual([
      "financial-report",
      "net-worth-history",
      "summary",
      "budget-overview",
      "upcoming-items",
    ]);
  });

  it("refreshes profile only when a savings target can change its mirror", async () => {
    expect(await invalidatedKeys((client) => invalidateFinancialTargetQueries(client, true))).toContain("profile");
    expect(await invalidatedKeys((client) => invalidateFinancialTargetQueries(client, false))).not.toContain("profile");
  });
});
