// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { FinancialReport } from "../../shared/types";
import { Reports } from "./Reports";

const mocks = vi.hoisted(() => ({
  accounts: vi.fn(),
  categories: vi.fn(),
  profile: vi.fn(),
  financialReport: vi.fn(),
  financialTargets: vi.fn(),
  netWorthHistory: vi.fn(),
  deleteFinancialTarget: vi.fn(),
}));

vi.mock("../../shared/api", () => ({ api: mocks }));
vi.mock("../../shared/ui/toast", () => ({ useToast: () => vi.fn() }));
vi.mock("../../shared/ui/Charts", () => ({
  CumulativeExpensesChart: () => null,
  CategoryBarsChart: () => null,
  NetWorthHistoryChart: () => <div>Gráfico de patrimônio</div>,
  SourceComparisonChart: () => null,
  SpendingBarsChart: () => null,
}));
vi.mock("./CategoryDonut", () => ({ CategoryDonut: () => null, UNCATEGORIZED_CATEGORY_KEY: "uncategorized" }));
vi.mock("./CategoryTrendChart", () => ({ CategoryTrendChart: () => null }));

const zeroSummary = {
  incomeInCents: 0,
  expensesInCents: 0,
  investmentsInCents: 0,
  savingsInCents: 0,
  dailyAverageInCents: 0,
  projectedExpensesInCents: 0,
};
const report = {
  summary: zeroSummary,
  latestMonthSummary: zeroSummary,
  previousSummary: zeroSummary,
  currentInvestedInCents: 0,
  monthly: [{ month: "2026-07", ...zeroSummary }],
  categories: [],
  kindBreakdown: [],
  merchants: [],
  daily: [],
  sources: [],
  goals: [],
  invoices: { openCount: 0, paidCount: 0, openTotalInCents: 0 },
  uncategorizedCount: 0,
  uncategorizedInCents: 0,
  monthlyAverageInCents: 0,
  cardSharePercent: 0,
  alerts: [],
} satisfies FinancialReport;

function renderReports() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <MemoryRouter>
      <QueryClientProvider client={client}>
        <Reports />
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

describe("Reports deferred net worth", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.accounts.mockResolvedValue([]);
    mocks.categories.mockResolvedValue([]);
    mocks.profile.mockResolvedValue(null);
    mocks.financialReport.mockResolvedValue(report);
    mocks.financialTargets.mockResolvedValue([]);
    mocks.netWorthHistory.mockResolvedValue([
      { month: "2026-07", totalInCents: 100, assetsInCents: 120, liabilitiesInCents: -20, perKind: [] },
    ]);
  });

  afterEach(cleanup);

  it("requests net worth only after the Patrimônio tab becomes active", async () => {
    renderReports();
    await screen.findByRole("tab", { name: "Patrimônio" });
    expect(mocks.netWorthHistory).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("tab", { name: "Patrimônio" }));
    await waitFor(() => expect(mocks.netWorthHistory).toHaveBeenCalledWith(13));
    expect(await screen.findByText("Gráfico de patrimônio")).toBeTruthy();
  });

  it("keeps the type immutable when editing an existing target", async () => {
    mocks.financialReport.mockResolvedValue({
      ...report,
      goals: [
        {
          targetId: "target-1",
          kind: "savings",
          label: "Economia mensal",
          targetInCents: 10_000,
          actualInCents: 5_000,
          remainingInCents: 5_000,
          progressPercent: 50,
          projectedInCents: 8_000,
          projectedToExceed: false,
        },
      ],
    } satisfies FinancialReport);
    mocks.financialTargets.mockResolvedValue([
      {
        id: "target-1",
        kind: "savings",
        amountInCents: 10_000,
        enabled: true,
        includeDescendants: false,
        overrides: [],
      },
    ]);
    renderReports();

    fireEvent.click(await screen.findByRole("tab", { name: "Metas" }));
    fireEvent.click(screen.getByRole("button", { name: "Editar" }));
    expect((await screen.findByRole("combobox", { name: "Tipo" })).hasAttribute("disabled")).toBe(true);
  });
});
