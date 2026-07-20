// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  disposeUiPreferences,
  initializeUiPreferences,
  UI_PREFERENCE_STORAGE_KEYS,
  useUiPreferences,
} from "./uiPreferences";

type ThemeListener = (event: MediaQueryListEvent) => void;

describe("uiPreferences", () => {
  let darkMode = false;
  let themeListener: ThemeListener | undefined;

  beforeEach(() => {
    disposeUiPreferences();
    localStorage.clear();
    darkMode = false;
    themeListener = undefined;
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      value: vi.fn().mockImplementation(() => ({
        get matches() {
          return darkMode;
        },
        addEventListener: (_event: string, listener: ThemeListener) => {
          themeListener = listener;
        },
        removeEventListener: vi.fn(),
      })),
    });
  });

  afterEach(() => {
    disposeUiPreferences();
    vi.restoreAllMocks();
  });

  it("starts at 100% zoom when the legacy key is absent", () => {
    initializeUiPreferences();

    expect(useUiPreferences.getState().zoom).toBe(1);
    expect(document.documentElement.style.getPropertyValue("--app-zoom")).toBe("1");
  });

  it("hydrates all legacy keys and clamps malformed zoom values", () => {
    localStorage.setItem(UI_PREFERENCE_STORAGE_KEYS.theme, "dark");
    localStorage.setItem(UI_PREFERENCE_STORAGE_KEYS.zoom, "9");
    localStorage.setItem(UI_PREFERENCE_STORAGE_KEYS.sidebarCollapsed, "true");

    initializeUiPreferences();

    expect(useUiPreferences.getState()).toMatchObject({
      themePreference: "dark",
      resolvedTheme: "dark",
      zoom: 1.4,
      sidebar: "compact",
    });
    expect(document.documentElement.dataset.theme).toBe("dark");
  });

  it("uses the system theme reactively and removes the legacy key for system", () => {
    darkMode = true;
    initializeUiPreferences();
    expect(useUiPreferences.getState().resolvedTheme).toBe("dark");

    darkMode = false;
    themeListener?.({ matches: false } as MediaQueryListEvent);
    expect(useUiPreferences.getState().resolvedTheme).toBe("light");
    expect(document.documentElement.dataset.theme).toBe("light");

    useUiPreferences.getState().setThemePreference("dark");
    themeListener?.({ matches: false } as MediaQueryListEvent);
    expect(useUiPreferences.getState().resolvedTheme).toBe("dark");
    expect(localStorage.getItem(UI_PREFERENCE_STORAGE_KEYS.theme)).toBe("dark");

    useUiPreferences.getState().setThemePreference("system");
    expect(localStorage.getItem(UI_PREFERENCE_STORAGE_KEYS.theme)).toBeNull();
  });

  it("keeps shortcuts reactive without installing duplicate listeners", () => {
    const addEventListener = vi.spyOn(window, "addEventListener");
    initializeUiPreferences();
    initializeUiPreferences();

    const zoomKey = new KeyboardEvent("keydown", { key: "+", code: "Equal", ctrlKey: true, cancelable: true });
    window.dispatchEvent(zoomKey);
    expect(zoomKey.defaultPrevented).toBe(true);
    expect(useUiPreferences.getState().zoom).toBe(1.1);
    expect(localStorage.getItem(UI_PREFERENCE_STORAGE_KEYS.zoom)).toBe("1.1");
    expect(addEventListener.mock.calls.filter(([event]) => event === "keydown")).toHaveLength(1);
  });

  it("updates sidebar state and its existing boolean storage key together", () => {
    initializeUiPreferences();
    useUiPreferences.getState().toggleSidebar();

    expect(useUiPreferences.getState().sidebar).toBe("compact");
    expect(localStorage.getItem(UI_PREFERENCE_STORAGE_KEYS.sidebarCollapsed)).toBe("true");
  });
});
