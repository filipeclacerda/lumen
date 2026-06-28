export type Theme = "light" | "dark";

const STORAGE_KEY = "financa-theme";

export function getTheme(): Theme {
  const stored = localStorage.getItem(STORAGE_KEY);
  if (stored === "light" || stored === "dark") return stored;
  return window.matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

export function applyTheme(theme: Theme) {
  document.documentElement.setAttribute("data-theme", theme);
}

export function setTheme(theme: Theme) {
  localStorage.setItem(STORAGE_KEY, theme);
  applyTheme(theme);
}

/** Applies the persisted (or system) theme. Call once before rendering. */
export function initTheme() {
  applyTheme(getTheme());
}
