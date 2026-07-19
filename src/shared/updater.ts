import { check, type Update } from "@tauri-apps/plugin-updater";
import { isTauriRuntime } from "./runtime";

export { isTauriRuntime } from "./runtime";

export type LumenUpdate = {
  update: Update;
  currentVersion: string;
  latestVersion: string;
  date?: string;
  notes?: string;
};

const dismissedUpdateKey = "lumen-dismissed-update-version";
export const forceUpdateCheckEvent = "lumen:force-update-check";

export const canCheckForUpdates = () => isTauriRuntime() && !import.meta.env.DEV;

export function isUpdateDismissed(version: string) {
  return localStorage.getItem(dismissedUpdateKey) === version;
}

export function dismissUpdate(version: string) {
  localStorage.setItem(dismissedUpdateKey, version);
}

export function clearDismissedUpdate(version: string) {
  if (isUpdateDismissed(version)) localStorage.removeItem(dismissedUpdateKey);
}

export function requestUpdateNoticeRefresh() {
  window.dispatchEvent(new Event(forceUpdateCheckEvent));
}

export async function checkLumenUpdate(): Promise<LumenUpdate | null> {
  if (!canCheckForUpdates()) return null;
  const update = await check();
  if (!update) return null;
  return {
    update,
    currentVersion: update.currentVersion,
    latestVersion: update.version,
    date: update.date,
    notes: update.body,
  };
}
