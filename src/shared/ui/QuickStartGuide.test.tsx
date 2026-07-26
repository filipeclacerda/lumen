// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import {
  queueQuickStartGuide,
  resetQuickStartGuideForTests,
  restartQuickStartGuide,
  storedQuickStartGuideStatus,
  useQuickStartGuide,
} from "../quickStartGuide";
import { QuickStartGuide } from "./QuickStartGuide";

function Location() {
  const location = useLocation();
  return <output data-testid="location">{`${location.pathname}${location.search}`}</output>;
}

function GuideSurface() {
  const location = useLocation();
  return (
    <>
      <Location />
      {location.pathname === "/import" && <div data-import-tutorial="choose">Escolha o arquivo</div>}
      {location.pathname === "/transactions" && (
        <>
          <div data-quick-guide="transactions-list">Lista de transações</div>
          <div data-quick-guide="transactions-filter-panel">Filtros detalhados</div>
        </>
      )}
      {location.pathname === "/review" && <div data-quick-guide="review-center">Central de pendências</div>}
      {location.pathname === "/accounts" && <div data-quick-guide="accounts-overview">Contas e cartões</div>}
      {location.pathname === "/recurring" && <div data-quick-guide="recurring-editor">Recorrências</div>}
      {location.pathname === "/budget" && <div data-quick-guide="budget-overview">Orçamento</div>}
      {location.pathname === "/categories" && (
        <>
          <div data-quick-guide="categories-structure">Estrutura de categorias</div>
          <div data-quick-guide="categories-rules">Regras de categorias</div>
        </>
      )}
      {location.pathname === "/" && <div data-quick-guide="overview">Resumo mensal</div>}
      {location.pathname === "/reports" && (
        <>
          <div data-quick-guide="reports-filters">Filtros dos relatórios</div>
          <div data-quick-guide="reports-kpis">Indicadores dos relatórios</div>
          <div data-quick-guide="reports-categories">Categorias dos relatórios</div>
        </>
      )}
      {location.pathname === "/settings" && <div data-quick-guide="backup">Backup completo</div>}
    </>
  );
}

function renderGuide() {
  return render(
    <MemoryRouter initialEntries={["/settings"]}>
      <Routes>
        <Route path="*" element={<GuideSurface />} />
      </Routes>
      <QuickStartGuide />
    </MemoryRouter>,
  );
}

function mockMedia(matches: boolean) {
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: vi.fn().mockReturnValue({
      matches,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }),
  });
}

describe("QuickStartGuide", () => {
  beforeEach(() => {
    localStorage.clear();
    resetQuickStartGuideForTests();
    mockMedia(true);
    Object.defineProperty(Element.prototype, "scrollIntoView", {
      configurable: true,
      value: vi.fn(),
    });
  });

  afterEach(() => {
    document.documentElement.style.removeProperty("--app-zoom");
    cleanup();
  });

  it("does not interrupt an existing user without a pending record", () => {
    renderGuide();
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("offers a concise invitation before navigating", async () => {
    queueQuickStartGuide();
    renderGuide();

    const invitation = screen.getByRole("dialog", { name: "Conheça o Lumen com seus próprios dados" });
    expect(invitation.getAttribute("aria-modal")).toBe("false");
    expect(screen.getByTestId("location").textContent).toBe("/settings");

    fireEvent.click(screen.getByRole("button", { name: "Começar" }));

    await waitFor(() => expect(screen.getByTestId("location").textContent).toBe("/import"));
    expect(screen.getByRole("heading", { name: "Traga seus dados com segurança" })).toBeTruthy();
    expect(screen.getByRole("progressbar", { name: "Importação: etapa 1 de 14" })).toBeTruthy();
  });

  it("keeps the complete guide independent from the contextual import guide", async () => {
    restartQuickStartGuide();
    renderGuide();

    await waitFor(() => expect(screen.getByTestId("location").textContent).toBe("/import"));
    expect(screen.getByRole("heading", { name: "Traga seus dados com segurança" })).toBeTruthy();
    expect(screen.getByRole("progressbar", { name: "Importação: etapa 1 de 14" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Voltar" }).hasAttribute("disabled")).toBe(true);
    expect(useQuickStartGuide.getState().activeGuide).toBe("complete");
    expect(useQuickStartGuide.getState().guides.import?.status).not.toBe("active");

    for (const route of [
      "/transactions",
      "/transactions",
      "/review",
      "/accounts",
      "/recurring",
      "/budget",
      "/categories?tab=categories",
      "/categories?tab=rules",
      "/",
      "/reports",
      "/reports",
      "/reports",
      "/settings?section=data",
    ]) {
      fireEvent.click(screen.getByRole("button", { name: "Avançar" }));
      await waitFor(() => expect(screen.getByTestId("location").textContent).toBe(route));
    }

    expect(screen.getByRole("heading", { name: "Proteja seu histórico local" })).toBeTruthy();
    expect(screen.getByRole("progressbar", { name: "Backup: etapa 14 de 14" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Concluir" }));

    expect(screen.queryByRole("dialog")).toBeNull();
    expect(storedQuickStartGuideStatus()).toBe("completed");
  });

  it("pauses without permanently dismissing and can be ended explicitly", () => {
    restartQuickStartGuide();
    const view = renderGuide();

    fireEvent.click(screen.getByRole("button", { name: "Pausar tutorial" }));
    expect(storedQuickStartGuideStatus()).toBe("pending");
    expect(screen.queryByRole("dialog")).toBeNull();

    useQuickStartGuide.getState().resume("complete");
    view.rerender(
      <MemoryRouter initialEntries={["/import"]}>
        <div data-import-tutorial="choose">Escolha o arquivo</div>
        <QuickStartGuide />
      </MemoryRouter>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Encerrar tutorial" }));
    expect(storedQuickStartGuideStatus()).toBe("dismissed");
  });

  it("cycles through floating positions and returns to automatic mode", async () => {
    mockMedia(false);
    restartQuickStartGuide();
    renderGuide();
    await waitFor(() => expect(screen.getByRole("button", { name: "Mover tutorial" })).toBeTruthy());

    const dialog = screen.getByRole("dialog");
    const target = document.querySelector('[data-import-tutorial="choose"]') as HTMLElement;
    vi.spyOn(dialog, "getBoundingClientRect").mockReturnValue({
      top: 0,
      right: 400,
      bottom: 206,
      left: 0,
      width: 400,
      height: 206,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    });
    vi.spyOn(target, "getBoundingClientRect").mockReturnValue({
      top: 233,
      right: 1168,
      bottom: 696,
      left: 188,
      width: 980,
      height: 463,
      x: 188,
      y: 233,
      toJSON: () => ({}),
    });
    fireEvent(window, new Event("resize"));

    expect(dialog.classList.contains("is-docked")).toBe(false);
    expect(dialog.closest("#tutorial-host")).toBeNull();

    const positioner = dialog.parentElement as HTMLElement;
    await waitFor(() => expect(positioner.dataset.placement).toBe("top"));

    const manualTransforms = new Set<string>();
    for (const placement of ["right", "left", "bottom", "top"]) {
      fireEvent.click(screen.getByRole("button", { name: "Mover tutorial" }));
      await waitFor(() => expect(positioner.dataset.placement).toBe(placement));
      manualTransforms.add(positioner.style.transform);
      expect(dialog.classList.contains("is-docked")).toBe(false);
    }
    expect(manualTransforms.size).toBe(4);

    fireEvent.click(screen.getByRole("button", { name: "Mover tutorial" }));
    await waitFor(() => expect(positioner.dataset.placement).toBe("top"));
    expect(document.querySelector(".quick-start-guide__announcement")?.textContent).toContain(
      "Tutorial em posição automática.",
    );
  });

  it.each([0.9, 1.25])("aligns the target highlight when the app zoom is %s", async (zoom) => {
    mockMedia(false);
    document.documentElement.style.setProperty("--app-zoom", String(zoom));
    restartQuickStartGuide();
    renderGuide();
    await waitFor(() => expect(screen.getByTestId("location").textContent).toBe("/import"));

    const target = document.querySelector('[data-import-tutorial="choose"]') as HTMLElement;
    vi.spyOn(target, "getBoundingClientRect").mockReturnValue({
      top: 24,
      right: 260,
      bottom: 68,
      left: 40,
      width: 220,
      height: 44,
      x: 40,
      y: 24,
      toJSON: () => ({}),
    });
    fireEvent(window, new Event("resize"));

    await waitFor(() => {
      const highlight = document.querySelector(".quick-start-guide__highlight") as HTMLElement;
      expect(Number.parseFloat(highlight.style.top)).toBeCloseTo(24 / zoom);
      expect(Number.parseFloat(highlight.style.left)).toBeCloseTo(40 / zoom);
      expect(Number.parseFloat(highlight.style.width)).toBeCloseTo(220 / zoom);
      expect(Number.parseFloat(highlight.style.height)).toBeCloseTo(44 / zoom);
    });
    document.documentElement.style.removeProperty("--app-zoom");
  });

  it("remeasures the highlight after WebView restores layout on refresh", async () => {
    mockMedia(false);
    restartQuickStartGuide();
    renderGuide();
    await waitFor(() => expect(screen.getByTestId("location").textContent).toBe("/import"));
    expect(Element.prototype.scrollIntoView).toHaveBeenCalledWith({
      behavior: "auto",
      block: "start",
      inline: "nearest",
    });

    const target = document.querySelector('[data-import-tutorial="choose"]') as HTMLElement;
    const getTargetRect = vi.spyOn(target, "getBoundingClientRect");
    getTargetRect.mockReturnValue({
      top: 144,
      right: 260,
      bottom: 188,
      left: 40,
      width: 220,
      height: 44,
      x: 40,
      y: 144,
      toJSON: () => ({}),
    });
    fireEvent(window, new Event("resize"));

    await waitFor(() => {
      const highlight = document.querySelector(".quick-start-guide__highlight") as HTMLElement;
      expect(Number.parseFloat(highlight.style.top)).toBeCloseTo(144);
    });

    getTargetRect.mockReturnValue({
      top: 24,
      right: 260,
      bottom: 68,
      left: 40,
      width: 220,
      height: 44,
      x: 40,
      y: 24,
      toJSON: () => ({}),
    });
    fireEvent(document, new Event("scrollend"));

    await waitFor(() => {
      const highlight = document.querySelector(".quick-start-guide__highlight") as HTMLElement;
      expect(Number.parseFloat(highlight.style.top)).toBeCloseTo(24);
    });
  });

  it("keeps the controls available when a target is missing", async () => {
    restartQuickStartGuide();
    render(
      <MemoryRouter initialEntries={["/settings"]}>
        <Routes>
          <Route path="*" element={<Location />} />
        </Routes>
        <QuickStartGuide />
      </MemoryRouter>,
    );

    await waitFor(() => expect(screen.getByTestId("location").textContent).toBe("/import"));
    expect(screen.getByRole("button", { name: "Avançar" })).toBeTruthy();
    const dialog = screen.getByRole("dialog");
    expect(dialog.parentElement?.parentElement).toBe(document.body);
    expect(dialog.classList.contains("is-corner")).toBe(true);
    expect(dialog.classList.contains("is-docked")).toBe(false);
  });
});
