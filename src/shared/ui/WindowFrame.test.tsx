// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { WindowFrame } from "./WindowFrame";

const windowMocks = vi.hoisted(() => ({
  close: vi.fn().mockResolvedValue(undefined),
  isMaximized: vi.fn().mockResolvedValue(false),
  minimize: vi.fn().mockResolvedValue(undefined),
  onResized: vi.fn().mockResolvedValue(vi.fn()),
  toggleMaximize: vi.fn().mockResolvedValue(undefined),
}));

function renderFrame() {
  return render(
    <MemoryRouter>
      <WindowFrame>
        <main>Conteúdo</main>
      </WindowFrame>
    </MemoryRouter>,
  );
}

vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => windowMocks,
}));

describe("WindowFrame", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    windowMocks.close.mockResolvedValue(undefined);
    windowMocks.isMaximized.mockResolvedValue(false);
    windowMocks.minimize.mockResolvedValue(undefined);
    windowMocks.onResized.mockResolvedValue(vi.fn());
    windowMocks.toggleMaximize.mockResolvedValue(undefined);
  });

  afterEach(() => {
    cleanup();
    Reflect.deleteProperty(window, "__TAURI_INTERNALS__");
    vi.restoreAllMocks();
  });

  it("keeps the browser fallback free of desktop window chrome", () => {
    renderFrame();

    expect(screen.queryByRole("banner")).toBeNull();
    expect(screen.getByText("Conteúdo")).toBeTruthy();
  });

  it("exposes native window actions in the custom desktop titlebar", async () => {
    Object.defineProperty(window, "__TAURI_INTERNALS__", { configurable: true, value: {} });
    windowMocks.isMaximized.mockResolvedValueOnce(false).mockResolvedValue(true);
    renderFrame();

    await waitFor(() => expect(windowMocks.isMaximized).toHaveBeenCalled());
    expect(screen.getByRole("button", { name: "Voltar" }).hasAttribute("disabled")).toBe(true);
    expect(screen.getByRole("button", { name: "Avançar" }).hasAttribute("disabled")).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Minimizar" }));
    fireEvent.click(screen.getByRole("button", { name: "Maximizar" }));
    fireEvent.click(screen.getByRole("button", { name: "Fechar" }));

    await waitFor(() => expect(screen.getByRole("button", { name: "Restaurar" })).toBeTruthy());
    expect(windowMocks.minimize).toHaveBeenCalledOnce();
    expect(windowMocks.toggleMaximize).toHaveBeenCalledOnce();
    expect(windowMocks.close).toHaveBeenCalledOnce();
  });

  it("exposes the global search from the desktop titlebar", () => {
    Object.defineProperty(window, "__TAURI_INTERNALS__", { configurable: true, value: {} });
    const onOpen = vi.fn();
    window.addEventListener("lumen:open-command-palette", onOpen);

    renderFrame();

    const search = screen.getByRole("button", { name: "Abrir busca rápida" });
    expect(search.getAttribute("aria-keyshortcuts")).toBe("Control+K Meta+K");
    fireEvent.click(search);
    expect(onOpen).toHaveBeenCalledOnce();
    window.removeEventListener("lumen:open-command-palette", onOpen);
  });

  it("preserves the native traffic-light controls on macOS", () => {
    Object.defineProperty(window, "__TAURI_INTERNALS__", { configurable: true, value: {} });
    vi.spyOn(window.navigator, "userAgent", "get").mockReturnValue("Macintosh");

    renderFrame();

    expect(screen.getByRole("banner")).toBeTruthy();
    expect(document.querySelector(".window-titlebar__identity")).toBeNull();
    expect(screen.queryByRole("button", { name: "Minimizar" })).toBeNull();
    expect(screen.getByRole("button", { name: "Abrir busca rápida" })).toBeTruthy();
  });
});
