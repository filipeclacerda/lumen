import { create } from "zustand";

export type ThemePreference = "system" | "light" | "dark";
export type ResolvedTheme = "light" | "dark";
export type SidebarPreference = "expanded" | "compact";

export type UiPreferences = {
  themePreference: ThemePreference;
  resolvedTheme: ResolvedTheme;
  zoom: number;
  sidebar: SidebarPreference;
};

export type EditableUiPreferences = Pick<UiPreferences, "themePreference" | "zoom" | "sidebar">;

type UiPreferencesStore = UiPreferences & {
  initialized: boolean;
  applyPreferences: (preferences: EditableUiPreferences) => void;
  setThemePreference: (preference: ThemePreference) => void;
  setZoom: (zoom: number) => number;
  changeZoom: (direction: 1 | -1) => number;
  resetZoom: () => number;
  setSidebar: (sidebar: SidebarPreference) => void;
  toggleSidebar: () => void;
};

export const UI_PREFERENCE_STORAGE_KEYS = {
  theme: "financa-theme",
  zoom: "financa-app-zoom",
  sidebarCollapsed: "financa-sidebar-collapsed",
} as const;

export const DEFAULT_ZOOM = 1;
export const MIN_ZOOM = 0.8;
export const MAX_ZOOM = 1.4;
export const ZOOM_STEP = 0.1;

let preferenceCleanup: (() => void) | undefined;
let systemThemeMedia: MediaQueryList | undefined;

function safeGetItem(key: string) {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function safeSetItem(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Preferences remain active for this session when storage is unavailable.
  }
}

function safeRemoveItem(key: string) {
  try {
    localStorage.removeItem(key);
  } catch {
    // Preferences remain active for this session when storage is unavailable.
  }
}

function normalizeZoom(value: number) {
  const finite = Number.isFinite(value) ? value : DEFAULT_ZOOM;
  return Math.round(Math.min(Math.max(finite, MIN_ZOOM), MAX_ZOOM) * 100) / 100;
}

function systemTheme(): ResolvedTheme {
  return systemThemeMedia?.matches || window.matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function resolveTheme(preference: ThemePreference): ResolvedTheme {
  return preference === "system" ? systemTheme() : preference;
}

function readPreferences(): UiPreferences {
  const storedTheme = safeGetItem(UI_PREFERENCE_STORAGE_KEYS.theme);
  const themePreference: ThemePreference = storedTheme === "light" || storedTheme === "dark" ? storedTheme : "system";
  const storedZoom = safeGetItem(UI_PREFERENCE_STORAGE_KEYS.zoom);
  const parsedZoom = storedZoom === null || storedZoom.trim() === "" ? DEFAULT_ZOOM : Number(storedZoom);
  return {
    themePreference,
    resolvedTheme: resolveTheme(themePreference),
    zoom: normalizeZoom(parsedZoom),
    sidebar: safeGetItem(UI_PREFERENCE_STORAGE_KEYS.sidebarCollapsed) === "true" ? "compact" : "expanded",
  };
}

function applyToDocument(preferences: Pick<UiPreferences, "resolvedTheme" | "zoom">) {
  document.documentElement.setAttribute("data-theme", preferences.resolvedTheme);
  document.documentElement.style.setProperty("--app-zoom", String(preferences.zoom));
}

function persistPreferences(preferences: EditableUiPreferences) {
  if (preferences.themePreference === "system") safeRemoveItem(UI_PREFERENCE_STORAGE_KEYS.theme);
  else safeSetItem(UI_PREFERENCE_STORAGE_KEYS.theme, preferences.themePreference);
  safeSetItem(UI_PREFERENCE_STORAGE_KEYS.zoom, String(preferences.zoom));
  safeSetItem(UI_PREFERENCE_STORAGE_KEYS.sidebarCollapsed, String(preferences.sidebar === "compact"));
}

function commitPreferences(preferences: EditableUiPreferences, persist = true) {
  const normalized: UiPreferences = {
    ...preferences,
    zoom: normalizeZoom(preferences.zoom),
    resolvedTheme: resolveTheme(preferences.themePreference),
  };
  useUiPreferences.setState({ ...normalized, initialized: true });
  applyToDocument(normalized);
  if (persist) persistPreferences(normalized);
  return normalized;
}

const initialPreferences: UiPreferences = {
  themePreference: "system",
  resolvedTheme: "light",
  zoom: DEFAULT_ZOOM,
  sidebar: "expanded",
};

export const useUiPreferences = create<UiPreferencesStore>((_set, get) => ({
  ...initialPreferences,
  initialized: false,
  applyPreferences: (preferences) => {
    commitPreferences(preferences);
  },
  setThemePreference: (themePreference) => {
    const current = get();
    commitPreferences({ themePreference, zoom: current.zoom, sidebar: current.sidebar });
  },
  setZoom: (zoom) => {
    const current = get();
    return commitPreferences({ themePreference: current.themePreference, zoom, sidebar: current.sidebar }).zoom;
  },
  changeZoom: (direction) => get().setZoom(get().zoom + direction * ZOOM_STEP),
  resetZoom: () => get().setZoom(DEFAULT_ZOOM),
  setSidebar: (sidebar) => {
    const current = get();
    commitPreferences({ themePreference: current.themePreference, zoom: current.zoom, sidebar });
  },
  toggleSidebar: () => get().setSidebar(get().sidebar === "compact" ? "expanded" : "compact"),
}));

function isZoomModifier(event: KeyboardEvent | WheelEvent) {
  return event.ctrlKey || event.metaKey;
}

function onKeyDown(event: KeyboardEvent) {
  if (!isZoomModifier(event)) return;
  const key = event.key.toLowerCase();
  const code = event.code;
  if (key === "+" || key === "=" || code === "Equal" || code === "NumpadAdd") {
    event.preventDefault();
    useUiPreferences.getState().changeZoom(1);
  } else if (key === "-" || code === "Minus" || code === "NumpadSubtract") {
    event.preventDefault();
    useUiPreferences.getState().changeZoom(-1);
  } else if (key === "0" || code === "Digit0" || code === "Numpad0") {
    event.preventDefault();
    useUiPreferences.getState().resetZoom();
  }
}

function onWheel(event: WheelEvent) {
  if (!isZoomModifier(event) || event.deltaY === 0) return;
  event.preventDefault();
  useUiPreferences.getState().changeZoom(event.deltaY < 0 ? 1 : -1);
}

function onSystemThemeChange(event: MediaQueryListEvent) {
  const current = useUiPreferences.getState();
  if (current.themePreference !== "system") return;
  const resolvedTheme: ResolvedTheme = event.matches ? "dark" : "light";
  useUiPreferences.setState({ resolvedTheme });
  applyToDocument({ resolvedTheme, zoom: current.zoom });
}

function onStorage(event: StorageEvent) {
  if (event.storageArea !== localStorage) return;
  if (!Object.values(UI_PREFERENCE_STORAGE_KEYS).includes(event.key as never)) return;
  commitPreferences(readPreferences(), false);
}

/** Hydrates preferences before React renders and installs global UI listeners once. */
export function initializeUiPreferences() {
  if (!systemThemeMedia) systemThemeMedia = window.matchMedia?.("(prefers-color-scheme: dark)");
  commitPreferences(readPreferences(), false);
  if (preferenceCleanup) return preferenceCleanup;

  systemThemeMedia?.addEventListener("change", onSystemThemeChange);
  window.addEventListener("keydown", onKeyDown);
  window.addEventListener("wheel", onWheel, { passive: false });
  window.addEventListener("storage", onStorage);
  preferenceCleanup = () => {
    systemThemeMedia?.removeEventListener("change", onSystemThemeChange);
    window.removeEventListener("keydown", onKeyDown);
    window.removeEventListener("wheel", onWheel);
    window.removeEventListener("storage", onStorage);
    preferenceCleanup = undefined;
    systemThemeMedia = undefined;
  };
  return preferenceCleanup;
}

export function disposeUiPreferences() {
  preferenceCleanup?.();
}
