import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { Copy, Minus, Square, X } from "lucide-react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { isMacOsRuntime, isTauriRuntime } from "../runtime";
import { BrandLogo } from "./BrandLogo";

export function WindowFrame({ children }: { children: ReactNode }) {
  if (!isTauriRuntime()) return children;

  const macOs = isMacOsRuntime();
  return (
    <div className="window-frame">
      <WindowTitleBar macOs={macOs} />
      <div className="window-frame__content">{children}</div>
    </div>
  );
}

function WindowTitleBar({ macOs }: { macOs: boolean }) {
  const appWindow = useMemo(() => getCurrentWindow(), []);
  const [maximized, setMaximized] = useState(false);

  const refreshMaximized = useCallback(async () => {
    setMaximized(await appWindow.isMaximized());
  }, [appWindow]);

  useEffect(() => {
    let disposed = false;
    let unlisten: (() => void) | undefined;

    void refreshMaximized();
    void appWindow
      .onResized(() => void refreshMaximized())
      .then((stopListening) => {
        if (disposed) stopListening();
        else unlisten = stopListening;
      });

    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [appWindow, refreshMaximized]);

  const toggleMaximize = async () => {
    await appWindow.toggleMaximize();
    await refreshMaximized();
  };

  return (
    <div className={`window-titlebar${macOs ? " window-titlebar--macos" : ""}`} role="banner">
      <div className="window-titlebar__drag" data-tauri-drag-region>
        <div className="window-titlebar__identity" aria-label="Lumen">
          <BrandLogo size={18} decorative />
          <span>Lumen</span>
        </div>
      </div>
      {!macOs && (
        <div className="window-titlebar__controls">
          <button type="button" aria-label="Minimizar" title="Minimizar" onClick={() => void appWindow.minimize()}>
            <Minus size={16} strokeWidth={1.7} aria-hidden="true" />
          </button>
          <button
            type="button"
            aria-label={maximized ? "Restaurar" : "Maximizar"}
            title={maximized ? "Restaurar" : "Maximizar"}
            onClick={() => void toggleMaximize()}
          >
            {maximized ? (
              <Copy size={13} strokeWidth={1.7} aria-hidden="true" />
            ) : (
              <Square size={13} strokeWidth={1.7} aria-hidden="true" />
            )}
          </button>
          <button
            type="button"
            className="window-titlebar__close"
            aria-label="Fechar"
            title="Fechar"
            onClick={() => void appWindow.close()}
          >
            <X size={16} strokeWidth={1.7} aria-hidden="true" />
          </button>
        </div>
      )}
    </div>
  );
}
