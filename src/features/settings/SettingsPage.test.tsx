// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SettingsPage } from "./SettingsPage";

const mocks = vi.hoisted(() => ({
  open: vi.fn(),
  profile: vi.fn(),
  restoreDatabase: vi.fn(),
  relaunch: vi.fn(),
  toast: vi.fn(),
}));

vi.mock("@tauri-apps/plugin-dialog", () => ({ open: mocks.open, save: vi.fn() }));
vi.mock("@tauri-apps/plugin-process", () => ({ relaunch: mocks.relaunch }));
vi.mock("../../shared/api", () => ({
  api: {
    profile: mocks.profile,
    restoreDatabase: mocks.restoreDatabase,
  },
}));
vi.mock("../../shared/ui/toast", () => ({ useToast: () => mocks.toast }));
vi.mock("../../shared/updater", () => ({
  canCheckForUpdates: () => false,
  checkLumenUpdate: vi.fn(),
  clearDismissedUpdate: vi.fn(),
  requestUpdateNoticeRefresh: vi.fn(),
}));

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <SettingsPage />
    </QueryClientProvider>,
  );
}

async function openRestoreDialog() {
  mocks.open.mockResolvedValue("backup.db");
  fireEvent.click(screen.getByRole("button", { name: /Restaurar backup$/ }));
  return within(await screen.findByRole("dialog"));
}

describe("SettingsPage restore", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.profile.mockResolvedValue({ displayName: "", monthlyIncomeInCents: null });
    mocks.restoreDatabase.mockResolvedValue(undefined);
    mocks.relaunch.mockResolvedValue(undefined);
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("does not restore merely when a file is selected", async () => {
    renderPage();
    await openRestoreDialog();
    expect(mocks.restoreDatabase).not.toHaveBeenCalled();
  });

  it("enables confirmation only for the exact RESTAURAR text", async () => {
    renderPage();
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
    renderPage();
    const dialog = await openRestoreDialog();
    fireEvent.change(dialog.getByRole("textbox"), { target: { value: "RESTAURAR" } });
    fireEvent.click(dialog.getByRole("button", { name: /Restaurar backup$/ }));
    await waitFor(() => expect(mocks.restoreDatabase).toHaveBeenCalledWith("backup.db"));
    expect(mocks.relaunch).not.toHaveBeenCalled();
  });

  it("explains how to reopen when relaunch fails", async () => {
    mocks.relaunch.mockRejectedValue(new Error("relaunch indisponível"));
    renderPage();
    const dialog = await openRestoreDialog();
    fireEvent.change(dialog.getByRole("textbox"), { target: { value: "RESTAURAR" } });
    vi.useFakeTimers();
    await act(async () => {
      fireEvent.click(dialog.getByRole("button", { name: /Restaurar backup$/ }));
      await Promise.resolve();
      await vi.advanceTimersByTimeAsync(900);
    });
    vi.useRealTimers();
    expect(mocks.restoreDatabase).toHaveBeenCalled();
    expect(mocks.toast).toHaveBeenCalledWith(expect.stringContaining("Feche e abra o Lumen"), "error");
  });
});
