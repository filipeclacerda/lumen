// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useBackupReminder } from "../../shared/backupReminder";
import { useUiPreferences } from "../../shared/uiPreferences";
import { useMaintenanceRestart } from "../../shared/maintenanceRestart";
import type { UserProfile } from "../../shared/types";
import { SettingsPage } from "./SettingsPage";

const mocks = vi.hoisted(() => ({
  chooseBackupToRestore: vi.fn(),
  exportTransactions: vi.fn(),
  createDatabaseBackup: vi.fn(),
  profile: vi.fn(),
  saveProfile: vi.fn(),
  restoreDatabase: vi.fn(),
  resetDatabase: vi.fn(),
  openUrl: vi.fn(),
  restartGuide: vi.fn(),
  restartImportGuide: vi.fn(),
  toast: vi.fn(),
}));

vi.mock("../../shared/api", () => ({
  api: {
    profile: mocks.profile,
    saveProfile: mocks.saveProfile,
    restoreDatabase: mocks.restoreDatabase,
    resetDatabase: mocks.resetDatabase,
  },
}));
vi.mock("../../shared/ui/toast", () => ({ useToast: () => mocks.toast }));
vi.mock("../../shared/quickStartGuide", () => ({
  restartQuickStartGuide: mocks.restartGuide,
  restartImportGuide: mocks.restartImportGuide,
}));
vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: mocks.openUrl }));
vi.mock("../../shared/updater", () => ({
  isTauriRuntime: () => true,
  canCheckForUpdates: () => false,
  checkLumenUpdate: vi.fn(),
  clearDismissedUpdate: vi.fn(),
  requestUpdateNoticeRefresh: vi.fn(),
}));
vi.mock("./desktopDataOperations", () => ({
  chooseBackupToRestore: mocks.chooseBackupToRestore,
  exportTransactions: mocks.exportTransactions,
  createDatabaseBackup: mocks.createDatabaseBackup,
  prepareDatabaseRestore: mocks.restoreDatabase,
  prepareDatabaseReset: mocks.resetDatabase,
}));

function LocationProbe() {
  const location = useLocation();
  return (
    <>
      <output data-testid="location">{location.search}</output>
      <output data-testid="pathname">{location.pathname}</output>
    </>
  );
}

function renderPage(entry = "/settings") {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[entry]}>
        <LocationProbe />
        <SettingsPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

async function openRestoreDialog() {
  mocks.chooseBackupToRestore.mockResolvedValue({
    status: "success",
    value: { path: "backup.db", fileName: "backup.db" },
  });
  fireEvent.click(screen.getByRole("button", { name: /Escolher backup/ }));
  return within(await screen.findByRole("dialog"));
}

describe("SettingsPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.profile.mockResolvedValue({
      displayName: "Filipe",
      monthlyIncomeInCents: 600000,
      monthlyTargetInCents: null,
      incomeDay: null,
      incomeDayRule: null,
      financialGoal: null,
      onboardingStartMode: null,
      onboardingCompletedAt: "2026-01-01",
    } satisfies UserProfile);
    mocks.saveProfile.mockImplementation(async (input) => ({ ...input, onboardingCompletedAt: "2026-01-01" }));
    mocks.restoreDatabase.mockResolvedValue(undefined);
    mocks.resetDatabase.mockResolvedValue(undefined);
    useUiPreferences.setState({ themePreference: "system", resolvedTheme: "light", zoom: 1, sidebar: "expanded" });
    useBackupReminder.setState({ reminder: null, initialized: false, isBackingUp: false });
    useMaintenanceRestart.getState().clearForTests();
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it("uses Geral as fallback and keeps the selected section in the URL", async () => {
    renderPage("/settings?section=not-real");
    expect(await screen.findByRole("heading", { name: "Perfil financeiro" })).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: /Aparência/ }));
    expect(await screen.findByRole("heading", { name: "Aparência e acessibilidade" })).toBeTruthy();
    expect(screen.getByTestId("location").textContent).toBe("?section=appearance");
  });

  it("opens the project page in the default browser from the desktop app", async () => {
    renderPage("/settings?section=about");
    fireEvent.click(await screen.findByRole("link", { name: /Ver no GitHub/ }));
    expect(mocks.openUrl).toHaveBeenCalledWith("https://github.com/filipeclacerda/lumen");
  });

  it("restarts the complete tour from the about section", async () => {
    renderPage("/settings?section=about");
    fireEvent.click(await screen.findByRole("button", { name: /Refazer tour completo/ }));
    expect(mocks.restartGuide).toHaveBeenCalledOnce();
  });

  it("restarts import help and navigates to the import page", async () => {
    renderPage("/settings?section=about");
    fireEvent.click(await screen.findByRole("button", { name: /Rever ajuda de importação/ }));
    expect(mocks.restartImportGuide).toHaveBeenCalledOnce();
    await waitFor(() => expect(screen.getByTestId("pathname").textContent).toBe("/import"));
  });

  it("saves a profile only after edits and allows discarding the draft", async () => {
    renderPage();
    const name = await screen.findByRole("textbox", { name: "Nome" });
    await waitFor(() => expect((name as HTMLInputElement).value).toBe("Filipe"));
    expect(screen.queryByRole("button", { name: /Salvar alterações/ })).toBeNull();

    fireEvent.change(name, { target: { value: "Outro nome" } });
    fireEvent.click(screen.getByRole("button", { name: "Descartar" }));
    expect((name as HTMLInputElement).value).toBe("Filipe");

    fireEvent.change(name, { target: { value: "Nome salvo" } });
    fireEvent.click(screen.getByRole("button", { name: /Salvar alterações/ }));
    await waitFor(() =>
      expect(mocks.saveProfile).toHaveBeenCalledWith(expect.objectContaining({ displayName: "Nome salvo" })),
    );
  });

  it("does not restore merely when a file is selected", async () => {
    renderPage("/settings?section=data");
    await openRestoreDialog();
    expect(mocks.restoreDatabase).not.toHaveBeenCalled();
  });

  it("enables restore confirmation only for the exact RESTAURAR text", async () => {
    renderPage("/settings?section=data");
    const dialog = await openRestoreDialog();
    const input = dialog.getByRole("textbox");
    const confirm = dialog.getByRole("button", { name: /Restaurar backup$/ });
    expect((confirm as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(input, { target: { value: "RESTAURAR " } });
    expect((confirm as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(input, { target: { value: "RESTAURAR" } });
    expect((confirm as HTMLButtonElement).disabled).toBe(false);
  });

  it("does not relaunch when the backend restore fails", async () => {
    mocks.restoreDatabase.mockRejectedValue(new Error("backup inválido"));
    renderPage("/settings?section=data");
    const dialog = await openRestoreDialog();
    fireEvent.change(dialog.getByRole("textbox"), { target: { value: "RESTAURAR" } });
    fireEvent.click(dialog.getByRole("button", { name: /Restaurar backup$/ }));
    await waitFor(() => expect(mocks.restoreDatabase).toHaveBeenCalledWith("backup.db"));
    expect(useMaintenanceRestart.getState().reason).toBeNull();
  });

  it("does not reset data if the requested pre-reset backup is cancelled", async () => {
    mocks.createDatabaseBackup.mockResolvedValue({ status: "cancelled" });
    renderPage("/settings?section=danger");
    fireEvent.click(await screen.findByRole("button", { name: /Apagar dados financeiros/ }));
    const dialog = within(await screen.findByRole("dialog"));
    fireEvent.change(dialog.getByRole("textbox"), { target: { value: "APAGAR" } });
    fireEvent.click(dialog.getByRole("button", { name: /Apagar dados financeiros/ }));
    await waitFor(() => expect(mocks.createDatabaseBackup).toHaveBeenCalled());
    expect(mocks.resetDatabase).not.toHaveBeenCalled();
  });

  it("does not reset data if the requested pre-reset backup fails", async () => {
    mocks.createDatabaseBackup.mockRejectedValue(new Error("disco indisponível"));
    renderPage("/settings?section=danger");
    fireEvent.click(await screen.findByRole("button", { name: /Apagar dados financeiros/ }));
    const dialog = within(await screen.findByRole("dialog"));
    fireEvent.change(dialog.getByRole("textbox"), { target: { value: "APAGAR" } });
    fireEvent.click(dialog.getByRole("button", { name: /Apagar dados financeiros/ }));

    await waitFor(() => expect(mocks.createDatabaseBackup).toHaveBeenCalled());
    expect(mocks.resetDatabase).not.toHaveBeenCalled();
    expect(useMaintenanceRestart.getState().reason).toBeNull();
  });

  it("backs up before reset and raises the global safety lock in order", async () => {
    const order: string[] = [];
    mocks.createDatabaseBackup.mockImplementation(async () => {
      order.push("backup");
      return { status: "success", value: { reminderRecorded: true } };
    });
    mocks.resetDatabase.mockImplementation(async () => {
      order.push("reset");
    });
    renderPage("/settings?section=danger");
    fireEvent.click(await screen.findByRole("button", { name: /Apagar dados financeiros/ }));
    const dialog = within(await screen.findByRole("dialog"));
    fireEvent.change(dialog.getByRole("textbox"), { target: { value: "APAGAR" } });
    fireEvent.click(dialog.getByRole("button", { name: /Apagar dados financeiros/ }));

    await waitFor(() => expect(useMaintenanceRestart.getState().reason).toBe("reset"));
    expect(order).toEqual(["backup", "reset"]);
  });

  it("exports the selected format through the centralized operation", async () => {
    mocks.exportTransactions.mockResolvedValue({ status: "success", value: 4 });
    renderPage("/settings?section=data");
    fireEvent.click(await screen.findByRole("button", { name: "Exportar" }));
    await waitFor(() => expect(mocks.exportTransactions).toHaveBeenCalledWith("csv"));
    expect(mocks.toast).toHaveBeenCalledWith("4 transações exportadas em CSV.");
  });

  it("raises the global safety lock after a restore is prepared", async () => {
    renderPage("/settings?section=data");
    const dialog = await openRestoreDialog();
    fireEvent.change(dialog.getByRole("textbox"), { target: { value: "RESTAURAR" } });
    fireEvent.click(dialog.getByRole("button", { name: /Restaurar backup$/ }));
    await waitFor(() => expect(useMaintenanceRestart.getState().reason).toBe("restore"));
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("validates the complete profile name constraint before saving", async () => {
    renderPage();
    const name = await screen.findByRole("textbox", { name: "Nome" });
    await waitFor(() => expect((name as HTMLInputElement).value).toBe("Filipe"));
    fireEvent.change(name, { target: { value: "A" } });
    expect(screen.getByRole("alert").textContent).toContain("entre 2 e 80 caracteres");
    expect((screen.getByRole("button", { name: /Salvar alterações/ }) as HTMLButtonElement).disabled).toBe(true);
  });
});
