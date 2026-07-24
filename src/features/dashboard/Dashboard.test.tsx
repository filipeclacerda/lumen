// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Dashboard } from "./Dashboard";

const mocks = vi.hoisted(() => ({
  summary: vi.fn(),
  transactions: vi.fn(),
  profile: vi.fn(),
  financialReport: vi.fn(),
  upcomingItems: vi.fn(),
  budgetOverview: vi.fn(),
}));

vi.mock("../../shared/api", () => ({ api: mocks }));
vi.mock("../../shared/ui/Charts", () => ({ CategoryBarsChart: () => null }));
vi.mock("./CashFlowChart", () => ({ CashFlowChart: () => null }));
vi.mock("./MonthlySurplusChart", () => ({ MonthlySurplusChart: () => null }));
vi.mock("../transactions/TransactionForm", () => ({ TransactionForm: () => null }));

function renderDashboard() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <MemoryRouter>
      <QueryClientProvider client={client}>
        <Dashboard />
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

describe("Dashboard upcoming kinds", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.summary.mockResolvedValue({
      incomeInCents: 0,
      expensesInCents: 0,
      investmentsInCents: 0,
      balanceInCents: 0,
      transactionCount: 0,
      byCategory: [],
    });
    mocks.transactions.mockResolvedValue([]);
    mocks.profile.mockResolvedValue(null);
    mocks.financialReport.mockReturnValue(new Promise(() => {}));
    mocks.budgetOverview.mockResolvedValue({
      categories: [],
      totals: { limitInCents: 0, spentInCents: 0 },
      hasOverlappingScopes: false,
    });
    mocks.upcomingItems.mockResolvedValue([
      { date: "2026-07-10", label: "Fatura julho", amountInCents: 100, kind: "invoice" },
      { date: "2026-07-11", label: "Notebook (2/3)", amountInCents: -200, kind: "installment" },
      { date: "2026-07-12", label: "Aluguel", amountInCents: -300, kind: "recurring" },
    ]);
  });

  afterEach(cleanup);

  it("shows loading and error states in the upcoming region and retries", async () => {
    mocks.upcomingItems.mockReturnValueOnce(new Promise(() => {}));
    const first = renderDashboard();
    const heading = await screen.findByRole("heading", { name: "Próximos vencimentos" });
    const panel = heading.closest("article")!;
    expect(within(panel).getByRole("status").textContent).toContain("Carregando próximos vencimentos");
    expect(within(panel).queryByText("Nada vence nos próximos 15 dias.")).toBeNull();
    first.unmount();

    mocks.upcomingItems.mockRejectedValueOnce(new Error("indisponível")).mockResolvedValueOnce([]);
    renderDashboard();
    const retry = await screen.findByRole("button", { name: "Tentar novamente" });
    expect(retry.closest("article")?.textContent).toContain("Não foi possível carregar os próximos vencimentos");
    fireEvent.click(retry);
    expect(await screen.findByText("Nada vence nos próximos 15 dias.")).toBeTruthy();
    expect(mocks.upcomingItems).toHaveBeenCalledTimes(3);
  });

  it("shows loading and error states in latest transactions and only then renders empty", async () => {
    mocks.transactions.mockReturnValueOnce(new Promise(() => {}));
    const first = renderDashboard();
    const firstHeading = await screen.findByRole("heading", { name: "Últimas transações" });
    const firstPanel = firstHeading.closest("article")!;
    expect(within(firstPanel).getByRole("status").textContent).toContain("Carregando últimas transações");
    expect(within(firstPanel).queryByText("Nenhuma transação neste mês ainda.")).toBeNull();
    first.unmount();

    mocks.transactions.mockRejectedValueOnce(new Error("indisponível")).mockResolvedValueOnce([]);
    renderDashboard();
    const heading = await screen.findByRole("heading", { name: "Últimas transações" });
    const panel = heading.closest("article")!;
    const retry = await within(panel).findByRole("button", { name: "Tentar novamente" });
    expect(panel.textContent).toContain("Não foi possível carregar as últimas transações");
    expect(within(panel).queryByText("Nenhuma transação neste mês ainda.")).toBeNull();
    fireEvent.click(retry);
    expect(await within(panel).findByText("Nenhuma transação neste mês ainda.")).toBeTruthy();
    expect(mocks.transactions).toHaveBeenCalledTimes(3);
  });

  it("renders the exhaustive icon and label mapping, including Parcela", async () => {
    renderDashboard();
    const heading = await screen.findByRole("heading", { name: "Próximos vencimentos" });
    const panel = heading.closest("article")!;

    expect(within(panel).getByText(/10\/07\/2026 · Fatura/)).toBeTruthy();
    expect(within(panel).getByText(/11\/07\/2026 · Parcela/)).toBeTruthy();
    expect(within(panel).getByText(/12\/07\/2026 · Recorrente/)).toBeTruthy();
    expect(panel.querySelector(".lucide-credit-card")).toBeTruthy();
    expect(panel.querySelector(".lucide-receipt")).toBeTruthy();
    expect(panel.querySelector(".lucide-repeat")).toBeTruthy();
  });
});
