// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BACKUP_REMINDER_STORAGE_KEY, resetBackupReminderStore } from "../backupReminder";
import { BackupReminderNotice } from "./BackupReminderNotice";

const mocks = vi.hoisted(() => ({ save: vi.fn(), backupDatabase: vi.fn(), toast: vi.fn() }));

vi.mock("@tauri-apps/plugin-dialog", () => ({ save: mocks.save }));
vi.mock("../api", () => ({ api: { backupDatabase: mocks.backupDatabase } }));
vi.mock("./toast", () => ({ useToast: () => mocks.toast }));

function overdueState() {
  const now = Date.now();
  return JSON.stringify({
    trackingStartedAt: new Date(now - 15 * 24 * 60 * 60 * 1000).toISOString(),
    lastSuccessfulAt: null,
    reminderDays: 14,
    snoozedUntil: null,
  });
}

describe("BackupReminderNotice", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    resetBackupReminderStore();
    Object.defineProperty(window, "__TAURI_INTERNALS__", { configurable: true, value: {} });
    localStorage.setItem(BACKUP_REMINDER_STORAGE_KEY, overdueState());
    mocks.backupDatabase.mockResolvedValue(undefined);
  });

  afterEach(() => {
    cleanup();
    Reflect.deleteProperty(window, "__TAURI_INTERNALS__");
  });

  it("shows only after onboarding and snoozes globally for one day", async () => {
    const view = render(<BackupReminderNotice enabled={false} />);
    expect(screen.queryByLabelText("Lembrete de backup")).toBeNull();

    view.rerender(<BackupReminderNotice enabled />);
    expect(await screen.findByLabelText("Lembrete de backup")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Lembrar amanhã/ }));
    expect(screen.queryByLabelText("Lembrete de backup")).toBeNull();
  });

  it("records success only after a selected backup completes", async () => {
    mocks.save.mockResolvedValue("C:\\private\\lumen-backup.db");
    render(<BackupReminderNotice enabled />);
    await screen.findByLabelText("Lembrete de backup");

    await act(async () => fireEvent.click(screen.getByRole("button", { name: /Fazer backup/ })));
    await waitFor(() => expect(mocks.backupDatabase).toHaveBeenCalledWith("C:\\private\\lumen-backup.db"));
    expect(screen.queryByLabelText("Lembrete de backup")).toBeNull();
    expect(mocks.toast).toHaveBeenCalledWith("Backup salvo com sucesso!");
    expect(localStorage.getItem(BACKUP_REMINDER_STORAGE_KEY)).not.toContain("private");
  });

  it("does not initialize or write reminder state in the browser", () => {
    Reflect.deleteProperty(window, "__TAURI_INTERNALS__");
    localStorage.clear();
    render(<BackupReminderNotice enabled />);

    expect(screen.queryByLabelText("Lembrete de backup")).toBeNull();
    expect(localStorage.getItem(BACKUP_REMINDER_STORAGE_KEY)).toBeNull();
  });
});
