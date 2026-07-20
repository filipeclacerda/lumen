import { initializeUiPreferences, useUiPreferences, type ResolvedTheme } from "./uiPreferences";

export type Theme = ResolvedTheme;

export function getTheme(): Theme {
  return useUiPreferences.getState().resolvedTheme;
}

export function applyTheme(theme: Theme) {
  document.documentElement.setAttribute("data-theme", theme);
}

export function setTheme(theme: Theme) {
  useUiPreferences.getState().setThemePreference(theme);
}

/** Applies the persisted (or system) theme. Call once before rendering. */
export function initTheme() {
  initializeUiPreferences();
}
