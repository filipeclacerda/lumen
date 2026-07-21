// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import {
  queueQuickStartGuide,
  resetQuickStartGuideForTests,
  restartQuickStartGuide,
  storedQuickStartGuideStatus,
} from "../quickStartGuide";
import { QuickStartGuide } from "./QuickStartGuide";

function Location() {
  const location = useLocation();
  return <output data-testid="location">{location.pathname}</output>;
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

function GuideSurface() {
  const location = useLocation();
  return (
    <>
      <Location />
      {location.pathname === "/import" && <div data-quick-guide="import">Import target</div>}
      {location.pathname === "/transactions" && <div data-quick-guide="transactions">Transactions target</div>}
      {location.pathname === "/transactions" && (
        <div data-quick-guide="transactions-filters">Transactions filters target</div>
      )}
      {location.pathname === "/" && <div data-quick-guide="overview">Overview target</div>}
      {location.pathname === "/reports" && <div data-quick-guide="reports-filters">Reports filters target</div>}
      {location.pathname === "/reports" && <div data-quick-guide="reports-kpis">Reports cards target</div>}
      {location.pathname === "/reports" && <div data-quick-guide="reports-categories">Reports categories target</div>}
    </>
  );
}

describe("QuickStartGuide", () => {
  beforeEach(() => {
    localStorage.clear();
    resetQuickStartGuideForTests();
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      value: vi.fn().mockReturnValue({ matches: true }),
    });
    Object.defineProperty(Element.prototype, "scrollIntoView", {
      configurable: true,
      value: vi.fn(),
    });
  });

  afterEach(cleanup);

  it("does not interrupt an existing user without a pending record", () => {
    renderGuide();
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("offers a non-modal invitation before navigating", async () => {
    queueQuickStartGuide();
    renderGuide();

    const invitation = screen.getByRole("dialog", { name: "Conheça o essencial" });
    expect(invitation.getAttribute("aria-modal")).toBe("false");
    expect(screen.getByTestId("location").textContent).toBe("/settings");

    fireEvent.click(screen.getByRole("button", { name: "Ver guia" }));

    await waitFor(() => expect(screen.getByTestId("location").textContent).toBe("/import"));
    expect(screen.getByRole("heading", { name: "Traga seu histórico" })).toBeTruthy();
    expect(screen.getByLabelText("Etapa 1 de 7")).toBeTruthy();
  });

  it("disables route entrance motion while the tour is active", () => {
    restartQuickStartGuide();
    renderGuide();
    expect(document.body.classList.contains("quick-start-guide-active")).toBe(true);

    fireEvent.click(screen.getByRole("button", { name: "Pular guia" }));

    expect(document.body.classList.contains("quick-start-guide-active")).toBe(false);
  });

  it("moves forward and back through the contextual routes, then completes", async () => {
    restartQuickStartGuide();
    renderGuide();
    await waitFor(() => expect(screen.getByTestId("location").textContent).toBe("/import"));

    fireEvent.click(screen.getByRole("button", { name: "Avançar" }));
    await waitFor(() => expect(screen.getByTestId("location").textContent).toBe("/transactions"));
    expect(screen.getByRole("heading", { name: "Revise e organize" })).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Avançar" }));
    await waitFor(() => expect(screen.getByRole("heading", { name: "Encontre o que precisa" })).toBeTruthy());

    fireEvent.click(screen.getByRole("button", { name: "Voltar" }));
    await waitFor(() => expect(screen.getByTestId("location").textContent).toBe("/transactions"));
    expect(screen.getByRole("heading", { name: "Revise e organize" })).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Avançar" }));
    await waitFor(() => expect(screen.getByRole("heading", { name: "Encontre o que precisa" })).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: "Avançar" }));
    await waitFor(() => expect(screen.getByTestId("location").textContent).toBe("/"));
    expect(screen.getByRole("heading", { name: "Acompanhe seu mês" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Avançar" }));
    await waitFor(() => expect(screen.getByTestId("location").textContent).toBe("/reports"));
    expect(screen.getByRole("heading", { name: "Escolha o período" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Avançar" }));
    expect(screen.getByRole("heading", { name: "Leia seus indicadores" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Avançar" }));
    expect(screen.getByRole("heading", { name: "Explore categorias" })).toBeTruthy();
    expect(screen.getByLabelText("Etapa 7 de 7")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Concluir" }));

    expect(screen.queryByRole("dialog")).toBeNull();
    expect(storedQuickStartGuideStatus()).toBe("completed");
  });

  it("aligns the highlight with the target bounds and radius", async () => {
    restartQuickStartGuide();
    renderGuide();
    await waitFor(() => expect(screen.getByTestId("location").textContent).toBe("/import"));

    const target = document.querySelector('[data-quick-guide="import"]') as HTMLElement;
    target.style.borderRadius = "9px";
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
      expect(highlight.style.top).toBe("24px");
      expect(highlight.style.left).toBe("40px");
      expect(highlight.style.width).toBe("220px");
      expect(highlight.style.height).toBe("44px");
      expect(highlight.style.borderRadius).toBe("9px");
    });

    vi.spyOn(target, "getBoundingClientRect").mockReturnValue({
      top: 18,
      right: 260,
      bottom: 62,
      left: 40,
      width: 220,
      height: 44,
      x: 40,
      y: 18,
      toJSON: () => ({}),
    });
    fireEvent.animationEnd(target);

    await waitFor(() => {
      const highlight = document.querySelector(".quick-start-guide__highlight") as HTMLElement;
      expect(highlight.style.top).toBe("18px");
    });
  });

  it.each(["Pular guia", "Fechar guia"])("dismisses with %s", (label) => {
    restartQuickStartGuide();
    renderGuide();
    fireEvent.click(screen.getByRole("button", { name: label }));
    expect(storedQuickStartGuideStatus()).toBe("dismissed");
  });

  it("dismisses with Escape", () => {
    restartQuickStartGuide();
    renderGuide();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(storedQuickStartGuideStatus()).toBe("dismissed");
  });
});
