// @vitest-environment jsdom

import { beforeEach, describe, expect, it } from "vitest";
import { api } from "./api";
import type { BalanceCheckpointInput, InstallmentPlanInput } from "./types";

function todayIso() {
  const today = new Date();
  return `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
}

describe("stateful web fallback", () => {
  beforeEach(() => {
    delete (window as Window & { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;
  });

  it("upserts checkpoints and reflects the latest value in summary and preview", async () => {
    const input = {
      accountId: "demo",
      asOfDate: todayIso(),
      balanceInCents: 123_456,
      source: "reconciliation",
    } satisfies BalanceCheckpointInput;
    const first = await api.recordBalanceCheckpoint(input);
    const updated = await api.recordBalanceCheckpoint({ ...input, balanceInCents: 234_567 });

    expect(updated.id).toBe(first.id);
    expect((await api.accountBalanceSummaries()).find((item) => item.accountId === "demo")).toMatchObject({
      realizedBalanceInCents: 234_567,
      lastReconciledAt: input.asOfDate,
      needsReconciliation: false,
    });
    expect(await api.reconciliationPreview({ ...input, balanceInCents: 250_000 })).toMatchObject({
      calculatedBalanceInCents: 234_567,
      differenceInCents: 15_433,
      latestCheckpoint: { id: first.id, balanceInCents: 234_567 },
    });
  });

  it("creates exact negative installments with unique ids and clamped dates in listings", async () => {
    const installmentInput = {
      accountId: "card",
      firstDate: "2098-01-31",
      description: "Notebook",
      totalAmountInCents: 10_000,
      installmentCount: 3,
      categoryId: "shopping",
    } satisfies InstallmentPlanInput;
    const result = await api.createCreditCardInstallments(installmentInput);

    expect(new Set(result.transactionIds).size).toBe(3);
    const listed = await api.listTransactions({ startDate: "2098-01-01", endDate: "2098-03-31" });
    const installments = listed.items.filter((item) => result.transactionIds.includes(item.id));
    expect(installments.map((item) => item.date)).toEqual(["2098-01-31", "2098-02-28", "2098-03-31"]);
    expect(installments.map((item) => item.amountInCents)).toEqual([-3_334, -3_333, -3_333]);
    expect(installments.map((item) => item.description)).toEqual([
      "Notebook (1/3)",
      "Notebook (2/3)",
      "Notebook (3/3)",
    ]);
    expect((await api.accounts()).find((account) => account.id === "card")).toMatchObject({
      kind: "credit_card",
      name: "Cartão principal",
    });
  });

  it("rejects future checkpoint dates and invalid checkpoint sources", async () => {
    await expect(
      api.recordBalanceCheckpoint({
        accountId: "demo",
        asOfDate: "2999-01-01",
        balanceInCents: 100,
        source: "manual",
      }),
    ).rejects.toThrow("futuro");
    await expect(
      api.reconciliationPreview({
        accountId: "demo",
        asOfDate: todayIso(),
        balanceInCents: 100,
        source: "unknown" as BalanceCheckpointInput["source"],
      }),
    ).rejects.toThrow("Origem");
  });

  it("validates demo installments before mutating and rejects an identical plan", async () => {
    const base = {
      accountId: "card",
      firstDate: "2097-04-15",
      description: "Plano único fallback",
      totalAmountInCents: 9_000,
      installmentCount: 3,
      categoryId: "shopping",
    } satisfies InstallmentPlanInput;
    await expect(api.createCreditCardInstallments({ ...base, description: "   " })).rejects.toThrow("descrição");
    await expect(api.createCreditCardInstallments({ ...base, accountId: "demo" })).rejects.toThrow("cartão");
    await expect(api.createCreditCardInstallments({ ...base, categoryId: "salary" })).rejects.toThrow("categoria");

    await api.createCreditCardInstallments(base);
    await expect(api.createCreditCardInstallments(base)).rejects.toThrow("idêntico");
  });
});
