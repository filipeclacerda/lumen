const STORAGE_KEY = "financa-app-zoom";
const DEFAULT_ZOOM = 1;
const MIN_ZOOM = 0.8;
const MAX_ZOOM = 1.4;
const ZOOM_STEP = 0.1;

function clampZoom(value: number) {
  return Math.min(Math.max(value, MIN_ZOOM), MAX_ZOOM);
}

function normalizeZoom(value: number) {
  return Math.round(clampZoom(value) * 100) / 100;
}

export function getZoom() {
  const stored = Number(localStorage.getItem(STORAGE_KEY));
  return Number.isFinite(stored) ? normalizeZoom(stored) : DEFAULT_ZOOM;
}

export function applyZoom(zoom: number) {
  document.documentElement.style.setProperty("--app-zoom", String(normalizeZoom(zoom)));
}

export function setZoom(zoom: number) {
  const normalized = normalizeZoom(zoom);
  localStorage.setItem(STORAGE_KEY, String(normalized));
  applyZoom(normalized);
  return normalized;
}

function changeZoom(direction: 1 | -1) {
  return setZoom(getZoom() + direction * ZOOM_STEP);
}

function resetZoom() {
  return setZoom(DEFAULT_ZOOM);
}

function isZoomModifier(event: KeyboardEvent | WheelEvent) {
  return event.ctrlKey || event.metaKey;
}

function onKeyDown(event: KeyboardEvent) {
  if (!isZoomModifier(event)) return;
  const key = event.key.toLowerCase();
  const code = event.code;
  if (key === "+" || key === "=" || code === "Equal" || code === "NumpadAdd") {
    event.preventDefault();
    changeZoom(1);
  } else if (key === "-" || code === "Minus" || code === "NumpadSubtract") {
    event.preventDefault();
    changeZoom(-1);
  } else if (key === "0" || code === "Digit0" || code === "Numpad0") {
    event.preventDefault();
    resetZoom();
  }
}

function onWheel(event: WheelEvent) {
  if (!isZoomModifier(event) || event.deltaY === 0) return;
  event.preventDefault();
  changeZoom(event.deltaY < 0 ? 1 : -1);
}

/** Applies persisted zoom and enables app-level zoom shortcuts. */
export function initZoom() {
  applyZoom(getZoom());
  window.addEventListener("keydown", onKeyDown);
  window.addEventListener("wheel", onWheel, { passive: false });
}
