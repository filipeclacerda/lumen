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
      <div id="tutorial-host" />
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
      {location.pathname === "/import" && (
        <div data-tutorial="import">
          <h1>Import target</h1>
        </div>
      )}
      {location.pathname === "/transactions" && (
        <div data-tutorial="transactions">
          <h1>Transactions target</h1>
        </div>
      )}
      {location.pathname === "/accounts" && (
        <div data-tutorial="accounts">
          <h1>Accounts target</h1>
        </div>
      )}
      {location.pathname === "/recurring" && (
        <div data-tutorial="recurring">
          <h1>Recurring target</h1>
        </div>
      )}
      {location.pathname === "/budget" && (
        <div data-tutorial="budget">
          <h1>Budget target</h1>
        </div>
      )}
      {location.pathname === "/categories" && (
        <div data-tutorial="categories">
          <h1>Categories target</h1>
        </div>
      )}
      {location.pathname === "/" && (
        <div data-tutorial="overview">
          <h1>Overview target</h1>
        </div>
      )}
      {location.pathname === "/reports" && (
        <div data-tutorial="reports">
          <h1>Reports target</h1>
        </div>
      )}
      {location.pathname === "/settings" && (
        <div data-tutorial="settings">
          <h1>Settings target</h1>
        </div>
      )}
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
    expect(invitation.closest("#tutorial-host")).toBeTruthy();
    expect(screen.getByTestId("location").textContent).toBe("/settings");

    fireEvent.click(screen.getByRole("button", { name: "Ver guia" }));

    await waitFor(() => expect(screen.getByTestId("location").textContent).toBe("/import"));
    expect(screen.getByRole("heading", { name: "Importe seu histórico" })).toBeTruthy();
    expect(screen.getByLabelText("Etapa 1 de 9")).toBeTruthy();
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
    expect(screen.getByRole("heading", { name: "Organize suas transações" })).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Avançar" }));
    await waitFor(() => expect(screen.getByTestId("location").textContent).toBe("/accounts"));
    expect(screen.getByRole("heading", { name: "Acompanhe contas e cartões" })).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Voltar" }));
    await waitFor(() => expect(screen.getByTestId("location").textContent).toBe("/transactions"));
    expect(screen.getByRole("heading", { name: "Organize suas transações" })).toBeTruthy();

    for (const route of ["/accounts", "/recurring", "/budget", "/categories", "/", "/reports", "/settings"]) {
      fireEvent.click(screen.getByRole("button", { name: "Avançar" }));
      await waitFor(() => expect(screen.getByTestId("location").textContent).toBe(route));
    }
    expect(screen.getByRole("heading", { name: "Proteja seus dados" })).toBeTruthy();
    expect(screen.getByLabelText("Etapa 9 de 9")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Concluir" }));

    expect(screen.queryByRole("dialog")).toBeNull();
    expect(storedQuickStartGuideStatus()).toBe("completed");
  });

  it("aligns the highlight with the target bounds and radius", async () => {
    restartQuickStartGuide();
    renderGuide();
    await waitFor(() => expect(screen.getByTestId("location").textContent).toBe("/import"));

    const target = document.querySelector('[data-tutorial="import"] h1') as HTMLElement;
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

  it("dismisses with Pular guia", () => {
    restartQuickStartGuide();
    renderGuide();
    fireEvent.click(screen.getByRole("button", { name: "Pular guia" }));
    expect(storedQuickStartGuideStatus()).toBe("dismissed");
  });

  it.each(["Pausar guia", "Escape"])("pauses with %s", (action) => {
    restartQuickStartGuide();
    renderGuide();
    if (action === "Escape") fireEvent.keyDown(document, { key: "Escape" });
    else fireEvent.click(screen.getByRole("button", { name: action }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(storedQuickStartGuideStatus()).toBe("pending");
  });

  it("keeps the controls available when a page target is missing", async () => {
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
    fireEvent.click(screen.getByRole("button", { name: "Avançar" }));
    await waitFor(() => expect(screen.getByTestId("location").textContent).toBe("/transactions"));
  });
});
