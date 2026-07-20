import { initializeUiPreferences, useUiPreferences } from "./uiPreferences";

export function getZoom() {
  return useUiPreferences.getState().zoom;
}

export function applyZoom(zoom: number) {
  document.documentElement.style.setProperty("--app-zoom", String(zoom));
}

export function setZoom(zoom: number) {
  return useUiPreferences.getState().setZoom(zoom);
}

/** Applies persisted zoom and enables app-level zoom shortcuts. */
export function initZoom() {
  initializeUiPreferences();
}
