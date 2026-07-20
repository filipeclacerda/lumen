import { UI_PREFERENCE_STORAGE_KEYS, useUiPreferences } from "./uiPreferences";

export function getSidebarCollapsed() {
  try {
    return localStorage.getItem(UI_PREFERENCE_STORAGE_KEYS.sidebarCollapsed) === "true";
  } catch {
    return useUiPreferences.getState().sidebar === "compact";
  }
}

export function setSidebarCollapsed(collapsed: boolean) {
  useUiPreferences.getState().setSidebar(collapsed ? "compact" : "expanded");
}
