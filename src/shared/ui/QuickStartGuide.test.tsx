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
      {location.pathname === "/transactions" && <div data-quick-guide="transactions-filters">Busca e filtros</div>}
      {location.pathname === "/" && <div data-quick-guide="overview">Resumo mensal</div>}
      {location.pathname === "/reports" && <div data-quick-guide="reports-filters">Filtros dos relatórios</div>}
      {location.pathname === "/settings" && <div data-quick-guide="backup">Backup completo</div>}
    </>
  );
}

function renderGuide(hasTransactions = false) {
  return render(
    <MemoryRouter initialEntries={["/settings"]}>
      <div id="tutorial-host" />
      <Routes>
        <Route path="*" element={<GuideSurface />} />
      </Routes>
      <QuickStartGuide hasTransactions={hasTransactions} />
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

    const invitation = screen.getByRole("dialog", { name: "Aprenda com seus próprios dados" });
    expect(invitation.getAttribute("aria-modal")).toBe("false");
    expect(screen.getByTestId("location").textContent).toBe("/settings");

    fireEvent.click(screen.getByRole("button", { name: "Começar" }));

    await waitFor(() => expect(screen.getByTestId("location").textContent).toBe("/import"));
    expect(screen.getByRole("heading", { name: "Comece pelo arquivo exportado" })).toBeTruthy();
    expect(screen.getByLabelText("Etapa 1 de 5")).toBeTruthy();
  });

  it("hands the first step to the contextual import guide", async () => {
    restartQuickStartGuide();
    renderGuide();
    await waitFor(() => expect(screen.getByTestId("location").textContent).toBe("/import"));

    fireEvent.click(screen.getByRole("button", { name: "Começar importação" }));

    expect(useQuickStartGuide.getState().activeGuide).toBe("import");
    expect(useQuickStartGuide.getState().guides.complete.status).toBe("paused");
    expect(screen.queryByRole("heading", { name: "Comece pelo arquivo exportado" })).toBeNull();
  });

  it("shows the import overview without starting the contextual guide when there are transactions", async () => {
    restartQuickStartGuide();
    renderGuide(true);

    await waitFor(() => expect(screen.getByTestId("location").textContent).toBe("/import"));
    expect(screen.getByRole("heading", { name: "Comece pelo arquivo exportado" })).toBeTruthy();
    expect(screen.getByLabelText("Etapa 1 de 5")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Começar importação" })).toBeNull();
    expect(screen.getByRole("button", { name: "Voltar" }).hasAttribute("disabled")).toBe(true);
    expect(useQuickStartGuide.getState().activeGuide).toBe("complete");
    expect(useQuickStartGuide.getState().guides.import?.status).not.toBe("active");

    for (const route of ["/transactions", "/", "/reports", "/settings?section=data"]) {
      fireEvent.click(screen.getByRole("button", { name: "Avançar" }));
      await waitFor(() => expect(screen.getByTestId("location").textContent).toBe(route));
    }

    expect(screen.getByRole("heading", { name: "Proteja seu histórico local" })).toBeTruthy();
    expect(screen.getByLabelText("Etapa 5 de 5")).toBeTruthy();
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
        <div id="tutorial-host" />
        <div data-import-tutorial="choose">Escolha o arquivo</div>
        <QuickStartGuide hasTransactions={false} />
      </MemoryRouter>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Encerrar tutorial" }));
    expect(storedQuickStartGuideStatus()).toBe("dismissed");
  });

  it("cycles the floating card to a docked fallback with the mover control", async () => {
    mockMedia(false);
    restartQuickStartGuide();
    renderGuide();
    await waitFor(() => expect(screen.getByRole("button", { name: "Mover tutorial" })).toBeTruthy());

    for (let index = 0; index < 4; index += 1) {
      fireEvent.click(
        screen.getByRole("button", {
          name: /^(Mover|Tentar flutuar) tutorial$/,
        }),
      );
    }

    expect(document.querySelector(".quick-start-guide__announcement")?.textContent).toContain(
      "Tutorial fixado na página.",
    );
    expect(screen.getByRole("button", { name: "Tentar flutuar tutorial" })).toBeTruthy();
    expect(screen.getByRole("dialog").classList.contains("is-docked")).toBe(true);
  });

  it("aligns the target highlight when the app zoom is not 100%", async () => {
    mockMedia(false);
    document.documentElement.style.setProperty("--app-zoom", "0.9");
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
      expect(Number.parseFloat(highlight.style.top)).toBeCloseTo(24 / 0.9);
      expect(Number.parseFloat(highlight.style.left)).toBeCloseTo(40 / 0.9);
      expect(Number.parseFloat(highlight.style.width)).toBeCloseTo(220 / 0.9);
      expect(Number.parseFloat(highlight.style.height)).toBeCloseTo(44 / 0.9);
    });
    document.documentElement.style.removeProperty("--app-zoom");
  });

  it("keeps the controls available when a target is missing", async () => {
    restartQuickStartGuide();
    render(
      <MemoryRouter initialEntries={["/settings"]}>
        <div id="tutorial-host" />
        <Routes>
          <Route path="*" element={<Location />} />
        </Routes>
        <QuickStartGuide hasTransactions={false} />
      </MemoryRouter>,
    );

    await waitFor(() => expect(screen.getByTestId("location").textContent).toBe("/import"));
    expect(screen.getByRole("button", { name: "Começar importação" })).toBeTruthy();
    expect(screen.getByRole("dialog").closest("#tutorial-host")).toBeTruthy();
  });
});
