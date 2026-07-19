export function isTauriRuntime() {
  return "__TAURI_INTERNALS__" in window;
}

export function isMacOsRuntime() {
  return /Macintosh|Mac OS X/i.test(navigator.userAgent);
}
