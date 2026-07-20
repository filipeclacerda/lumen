// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "./api";
import {
  BACKUP_REMINDER_STORAGE_KEY,
  backupReminderDue,
  createVerifiedBackup,
  resetBackupReminderStore,
  useBackupReminder,
} from "./backupReminder";

const NOW = new Date("2026-07-20T12:00:00.000Z");
const daysBefore = (days: number) => new Date(NOW.getTime() - days * 24 * 60 * 60 * 1000).toISOString();

describe("backupReminder", () => {
  beforeEach(() => {
    localStorage.clear();
    resetBackupReminderStore();
    Object.defineProperty(window, "__TAURI_INTERNALS__", { configurable: true, value: {} });
  });

  afterEach(() => {
    Reflect.deleteProperty(window, "__TAURI_INTERNALS__");
    vi.restoreAllMocks();
  });

  it("starts a new device-local 14 day cycle on first desktop initialization", () => {
    useBackupReminder.getState().initialize(NOW);

    expect(useBackupReminder.getState().reminder).toEqual({
      trackingStartedAt: NOW.toISOString(),
      lastSuccessfulAt: null,
      reminderDays: 14,
      snoozedUntil: null,
    });
    expect(backupReminderDue(useBackupReminder.getState().reminder, NOW)).toBe(false);
  });

  it("becomes due at the exact deadline and snoozes for one day", () => {
    localStorage.setItem(
      BACKUP_REMINDER_STORAGE_KEY,
      JSON.stringify({
        trackingStartedAt: daysBefore(14),
        lastSuccessfulAt: null,
        reminderDays: 14,
        snoozedUntil: null,
      }),
    );
    useBackupReminder.getState().initialize(NOW);
    expect(backupReminderDue(useBackupReminder.getState().reminder, NOW)).toBe(true);

    useBackupReminder.getState().snoozeOneDay(NOW);
    expect(backupReminderDue(useBackupReminder.getState().reminder, NOW)).toBe(false);
    expect(
      backupReminderDue(useBackupReminder.getState().reminder, new Date(NOW.getTime() + 24 * 60 * 60 * 1000)),
    ).toBe(true);
  });

  it("records only after a verified backup resolves and never persists its path", async () => {
    useBackupReminder.getState().initialize(NOW);
    let finishBackup!: () => void;
    vi.spyOn(api, "backupDatabase").mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          finishBackup = resolve;
        }),
    );

    const operation = createVerifiedBackup("C:\\private\\backup.db");
    expect(useBackupReminder.getState().reminder?.lastSuccessfulAt).toBeNull();
    finishBackup();
    await operation;

    expect(useBackupReminder.getState().reminder?.lastSuccessfulAt).not.toBeNull();
    expect(localStorage.getItem(BACKUP_REMINDER_STORAGE_KEY)).not.toContain("private");
    expect(localStorage.getItem(BACKUP_REMINDER_STORAGE_KEY)).not.toContain("backup.db");
  });

  it("does not register a failed backup", async () => {
    useBackupReminder.getState().initialize(NOW);
    vi.spyOn(api, "backupDatabase").mockRejectedValue(new Error("disco indisponível"));

    await expect(createVerifiedBackup("backup.db")).rejects.toThrow("disco indisponível");
    expect(useBackupReminder.getState().reminder?.lastSuccessfulAt).toBeNull();
    expect(useBackupReminder.getState().isBackingUp).toBe(false);
  });

  it("does not create reminder state in the web fallback", () => {
    Reflect.deleteProperty(window, "__TAURI_INTERNALS__");
    useBackupReminder.getState().initialize(NOW);

    expect(useBackupReminder.getState().initialized).toBe(false);
    expect(localStorage.getItem(BACKUP_REMINDER_STORAGE_KEY)).toBeNull();
  });

  it("starts a fresh cycle when reminders are re-enabled", () => {
    useBackupReminder.getState().initialize(new Date(daysBefore(30)));
    useBackupReminder.getState().setReminderDays(null, new Date(daysBefore(20)));
    useBackupReminder.getState().setReminderDays(7, NOW);

    expect(useBackupReminder.getState().reminder?.trackingStartedAt).toBe(NOW.toISOString());
    expect(backupReminderDue(useBackupReminder.getState().reminder, NOW)).toBe(false);
  });

  it("starts a fresh dataset cycle without erasing the previous backup history", () => {
    const backupDate = new Date(daysBefore(2));
    useBackupReminder.getState().initialize(new Date(daysBefore(20)));
    useBackupReminder.getState().recordSuccessfulBackup(backupDate);

    useBackupReminder.getState().resetForFreshDataset(NOW);

    expect(useBackupReminder.getState().reminder?.trackingStartedAt).toBe(NOW.toISOString());
    expect(useBackupReminder.getState().reminder?.lastSuccessfulAt).toBe(backupDate.toISOString());
    expect(backupReminderDue(useBackupReminder.getState().reminder, NOW)).toBe(false);
  });
});
