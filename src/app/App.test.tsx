// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "./App";
import { useMaintenanceRestart } from "../shared/maintenanceRestart";
import { disposeUiPreferences, initializeUiPreferences } from "../shared/uiPreferences";
import { ToastProvider } from "../shared/ui/toast";

const mocks = vi.hoisted(() => ({
  bootstrap: vi.fn(),
  syncRecurringTransactions: vi.fn(),
}));

vi.mock("../shared/api", () => ({
  api: {
    bootstrap: mocks.bootstrap,
    syncRecurringTransactions: mocks.syncRecurringTransactions,
  },
}));
vi.mock("../features/dashboard/Dashboard", () => ({ Dashboard: () => <div>Dashboard</div> }));
vi.mock("../features/transactions/Transactions", () => ({ Transactions: () => <div>Rota de transações lazy</div> }));
vi.mock("../shared/ui/CommandPalette", () => ({ CommandPalette: () => null }));
vi.mock("../shared/ui/UpdateNotice", () => ({ UpdateNotice: () => null }));
vi.mock("../shared/ui/BackupReminderNotice", () => ({ BackupReminderNotice: () => null }));
vi.mock("../shared/ui/QuickStartGuide", () => ({ QuickStartGuide: () => null }));

function renderApp(initialEntry = "/") {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <ToastProvider>
        <MemoryRouter initialEntries={[initialEntry]}>
          <App />
        </MemoryRouter>
      </ToastProvider>
    </QueryClientProvider>,
  );
}

describe("App sidebar", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    useMaintenanceRestart.getState().clearForTests();
    mocks.bootstrap.mockResolvedValue({ onboardingCompleted: true });
    mocks.syncRecurringTransactions.mockResolvedValue(0);
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      value: vi.fn().mockReturnValue({
        matches: false,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      }),
    });
    initializeUiPreferences();
  });

  afterEach(() => {
    cleanup();
    disposeUiPreferences();
  });

  it("renders grouped navigation and keeps settings in the utility footer", async () => {
    renderApp();

    const navigation = await screen.findByRole("navigation", { name: "Navegação principal" });
    expect(within(navigation).getByRole("heading", { name: "Acompanhar" })).toBeTruthy();
    expect(within(navigation).getByRole("heading", { name: "Gerenciar" })).toBeTruthy();
    expect(within(navigation).getByRole("heading", { name: "Planejar" })).toBeTruthy();
    expect(within(navigation).queryByRole("link", { name: "Configurações" })).toBeNull();
    expect(screen.getByRole("link", { name: "Configurações" })).toBeTruthy();
  });

  it("loads a feature route through the lazy route boundary", async () => {
    renderApp("/transactions");

    expect(await screen.findByText("Rota de transações lazy")).toBeTruthy();
    expect(screen.queryByText("Dashboard")).toBeNull();
  });

  it("offers a keyboard shortcut to the main content", async () => {
    renderApp();

    const shortcut = await screen.findByRole("link", { name: "Ir para o conteúdo principal" });
    const main = screen.getByRole("main");

    expect(shortcut.getAttribute("href")).toBe("#main-content");
    expect(main.id).toBe("main-content");
    expect(main.tabIndex).toBe(-1);
  });

  it("reports a recurring synchronization failure without an unhandled rejection", async () => {
    mocks.syncRecurringTransactions.mockRejectedValueOnce(new Error("falha interna"));
    renderApp();

    expect((await screen.findByRole("alert")).textContent).toContain(
      "Não foi possível atualizar os lançamentos recorrentes.",
    );
  });

  it("persists the collapsed preference and restores it after remounting", async () => {
    const firstRender = renderApp();
    fireEvent.click(await screen.findByRole("button", { name: "Recolher menu" }));

    expect(document.querySelector(".shell")?.classList.contains("collapsed")).toBe(true);
    expect(localStorage.getItem("financa-sidebar-collapsed")).toBe("true");
    expect(screen.getByRole("link", { name: "Visão geral" }).getAttribute("aria-label")).toBe("Visão geral");

    firstRender.unmount();
    renderApp();
    await waitFor(() => expect(screen.getByRole("button", { name: "Expandir menu" })).toBeTruthy());

    fireEvent.click(screen.getByRole("button", { name: "Expandir menu" }));
    expect(localStorage.getItem("financa-sidebar-collapsed")).toBe("false");
  });
});
