import { create } from "zustand";
import { api } from "./api";
import { runExclusiveDataOperation } from "./dataOperationLock";
import { isTauriRuntime } from "./runtime";

export type BackupReminderDays = 7 | 14 | 30 | null;

export type BackupReminderState = {
  trackingStartedAt: string;
  lastSuccessfulAt: string | null;
  reminderDays: BackupReminderDays;
  snoozedUntil: string | null;
};

type BackupReminderStore = {
  reminder: BackupReminderState | null;
  initialized: boolean;
  isBackingUp: boolean;
  initialize: (now?: Date) => void;
  setReminderDays: (days: BackupReminderDays, now?: Date) => void;
  snoozeOneDay: (now?: Date) => void;
  recordSuccessfulBackup: (now?: Date) => boolean;
  resetForFreshDataset: (now?: Date) => void;
};

export const BACKUP_REMINDER_STORAGE_KEY = "lumen-backup-reminder-v1";
export const DEFAULT_BACKUP_REMINDER_DAYS = 14;
const DAY_MS = 24 * 60 * 60 * 1000;
const FUTURE_TOLERANCE_MS = 5 * 60 * 1000;
const MAX_SNOOZE_MS = 25 * 60 * 60 * 1000;

function defaultReminder(now: Date): BackupReminderState {
  return {
    trackingStartedAt: now.toISOString(),
    lastSuccessfulAt: null,
    reminderDays: DEFAULT_BACKUP_REMINDER_DAYS,
    snoozedUntil: null,
  };
}

function validTimestamp(value: unknown) {
  if (typeof value !== "string") return null;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : null;
}

function sanitizeReminder(value: unknown, now: Date): BackupReminderState {
  if (!value || typeof value !== "object") return defaultReminder(now);
  const candidate = value as Partial<BackupReminderState>;
  const nowMs = now.getTime();
  const trackingTimestamp = validTimestamp(candidate.trackingStartedAt);
  const successfulTimestamp = validTimestamp(candidate.lastSuccessfulAt);
  const snoozedTimestamp = validTimestamp(candidate.snoozedUntil);
  const reminderDays: BackupReminderDays =
    candidate.reminderDays === null ||
    candidate.reminderDays === 7 ||
    candidate.reminderDays === 14 ||
    candidate.reminderDays === 30
      ? candidate.reminderDays
      : DEFAULT_BACKUP_REMINDER_DAYS;
  return {
    trackingStartedAt:
      trackingTimestamp === null || trackingTimestamp > nowMs + FUTURE_TOLERANCE_MS
        ? now.toISOString()
        : new Date(trackingTimestamp).toISOString(),
    lastSuccessfulAt:
      successfulTimestamp === null ? null : new Date(Math.min(successfulTimestamp, nowMs)).toISOString(),
    reminderDays,
    snoozedUntil:
      snoozedTimestamp !== null && snoozedTimestamp > nowMs && snoozedTimestamp <= nowMs + MAX_SNOOZE_MS
        ? new Date(snoozedTimestamp).toISOString()
        : null,
  };
}

function readReminder(now: Date) {
  try {
    const stored = localStorage.getItem(BACKUP_REMINDER_STORAGE_KEY);
    return sanitizeReminder(stored ? JSON.parse(stored) : null, now);
  } catch {
    return defaultReminder(now);
  }
}

function persistReminder(reminder: BackupReminderState) {
  try {
    localStorage.setItem(BACKUP_REMINDER_STORAGE_KEY, JSON.stringify(reminder));
    return true;
  } catch {
    return false;
  }
}

function reminderBaseTimestamp(reminder: BackupReminderState) {
  const tracking = Date.parse(reminder.trackingStartedAt);
  const successful = reminder.lastSuccessfulAt ? Date.parse(reminder.lastSuccessfulAt) : tracking;
  return Math.max(tracking, successful);
}

export function backupReminderDue(reminder: BackupReminderState | null, now = new Date()) {
  if (!reminder || reminder.reminderDays === null) return false;
  const dueAt = reminderBaseTimestamp(reminder) + reminder.reminderDays * DAY_MS;
  const snoozedUntil = reminder.snoozedUntil ? Date.parse(reminder.snoozedUntil) : 0;
  return now.getTime() >= dueAt && (!snoozedUntil || now.getTime() >= snoozedUntil);
}

export const useBackupReminder = create<BackupReminderStore>((set, get) => ({
  reminder: null,
  initialized: false,
  isBackingUp: false,
  initialize: (now = new Date()) => {
    if (!isTauriRuntime()) return;
    const reminder = readReminder(now);
    set({ reminder, initialized: true });
    persistReminder(reminder);
  },
  setReminderDays: (days, now = new Date()) => {
    const current = get().reminder;
    if (!current) return;
    const reminder = {
      ...current,
      trackingStartedAt: current.reminderDays === null && days !== null ? now.toISOString() : current.trackingStartedAt,
      reminderDays: days,
      snoozedUntil: null,
    };
    set({ reminder });
    persistReminder(reminder);
  },
  snoozeOneDay: (now = new Date()) => {
    const current = get().reminder;
    if (!backupReminderDue(current, now) || !current) return;
    const reminder = { ...current, snoozedUntil: new Date(now.getTime() + DAY_MS).toISOString() };
    set({ reminder });
    persistReminder(reminder);
  },
  recordSuccessfulBackup: (now = new Date()) => {
    if (!isTauriRuntime()) return false;
    const current = get().reminder ?? defaultReminder(now);
    const reminder = { ...current, lastSuccessfulAt: now.toISOString(), snoozedUntil: null };
    set({ reminder, initialized: true });
    return persistReminder(reminder);
  },
  resetForFreshDataset: (now = new Date()) => {
    const current = get().reminder;
    if (!current) return;
    const reminder = {
      ...current,
      trackingStartedAt: now.toISOString(),
      snoozedUntil: null,
    };
    set({ reminder });
    persistReminder(reminder);
  },
}));

export async function createVerifiedBackup(path: string) {
  if (!isTauriRuntime()) throw new Error("Backup disponível somente no aplicativo desktop.");
  if (useBackupReminder.getState().isBackingUp) throw new Error("Já existe um backup em andamento.");
  return runExclusiveDataOperation("backup", async () => {
    useBackupReminder.setState({ isBackingUp: true });
    try {
      await api.backupDatabase(path);
      return { reminderRecorded: useBackupReminder.getState().recordSuccessfulBackup() };
    } finally {
      useBackupReminder.setState({ isBackingUp: false });
    }
  });
}

export function resetBackupReminderStore() {
  useBackupReminder.setState({ reminder: null, initialized: false, isBackingUp: false });
}
