import { useCallback, useEffect, useLayoutEffect, useMemo, useState, type ReactNode } from "react";
import { ChevronLeft, ChevronRight, Copy, Minus, Search, Square, X } from "lucide-react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useLocation, useNavigate, useNavigationType } from "react-router-dom";
import { isMacOsRuntime, isTauriRuntime } from "../runtime";
import { BrandLogo } from "./BrandLogo";
import { OPEN_COMMAND_PALETTE_EVENT } from "./CommandPalette";

export function WindowFrame({ children }: { children: ReactNode }) {
  if (!isTauriRuntime()) return children;

  return <DesktopWindowFrame>{children}</DesktopWindowFrame>;
}

function DesktopWindowFrame({ children }: { children: ReactNode }) {
  const macOs = isMacOsRuntime();

  useLayoutEffect(() => {
    const targets = [document.documentElement, document.body, document.getElementById("root")].filter(
      (target): target is HTMLElement => target instanceof HTMLElement,
    );
    const resetOuterScroll = () => {
      for (const target of targets) {
        if (target.scrollTop !== 0) target.scrollTop = 0;
        if (target.scrollLeft !== 0) target.scrollLeft = 0;
      }
    };

    resetOuterScroll();
    for (const target of targets) target.addEventListener("scroll", resetOuterScroll, { passive: true });
    window.addEventListener("scroll", resetOuterScroll, { passive: true });
    return () => {
      for (const target of targets) target.removeEventListener("scroll", resetOuterScroll);
      window.removeEventListener("scroll", resetOuterScroll);
    };
  }, []);

  return (
    <div className="window-frame">
      <WindowTitleBar macOs={macOs} />
      <div className="window-frame__content">{children}</div>
    </div>
  );
}

function WindowTitleBar({ macOs }: { macOs: boolean }) {
  const appWindow = useMemo(() => getCurrentWindow(), []);
  const location = useLocation();
  const navigate = useNavigate();
  const navigationType = useNavigationType();
  const [maximized, setMaximized] = useState(false);
  const historyIndex = Number(window.history.state?.idx ?? 0);
  const [maxHistoryIndex, setMaxHistoryIndex] = useState(historyIndex);

  useEffect(() => {
    setMaxHistoryIndex((current) => (navigationType === "PUSH" ? historyIndex : Math.max(current, historyIndex)));
  }, [historyIndex, location.key, navigationType]);

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
        {!macOs && (
          <div className="window-titlebar__identity" aria-label="Lumen">
            <BrandLogo size={18} decorative />
            <span className="window-titlebar__product-name">Lumen</span>
          </div>
        )}
        <div className="window-titlebar__navigation" aria-label="Navegação">
          <button
            type="button"
            aria-label="Voltar"
            title="Voltar"
            disabled={historyIndex <= 0}
            onClick={() => navigate(-1)}
          >
            <ChevronLeft size={17} aria-hidden="true" />
          </button>
          <button
            type="button"
            aria-label="Avançar"
            title="Avançar"
            disabled={historyIndex >= maxHistoryIndex}
            onClick={() => navigate(1)}
          >
            <ChevronRight size={17} aria-hidden="true" />
          </button>
        </div>
      </div>
      <div className="window-titlebar__local-status" aria-label="Armazenamento local">
        <i aria-hidden="true" />
        Configuração local
      </div>
      <button
        type="button"
        className="window-titlebar__search"
        aria-label="Abrir busca rápida"
        aria-keyshortcuts="Control+K Meta+K"
        onClick={() => window.dispatchEvent(new Event(OPEN_COMMAND_PALETTE_EVENT))}
      >
        <Search size={14} aria-hidden="true" />
        <span>Buscar</span>
        <kbd>Ctrl K</kbd>
      </button>
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
