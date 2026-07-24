// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { resetQuickStartGuideForTests, useQuickStartGuide } from "../../shared/quickStartGuide";
import { ImportTutorial, shouldAutoStartImportGuide } from "./ImportTutorial";

describe("ImportTutorial", () => {
  beforeEach(() => {
    localStorage.clear();
    resetQuickStartGuideForTests();
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      value: vi.fn().mockReturnValue({
        matches: true,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      }),
    });
    Object.defineProperty(Element.prototype, "scrollIntoView", {
      configurable: true,
      value: vi.fn(),
    });
  });

  afterEach(cleanup);

  it("starts automatically only for a first import without another active tour", () => {
    expect(
      shouldAutoStartImportGuide({
        hasImports: false,
        completeStatus: "paused",
        activeGuide: null,
      }),
    ).toBe(true);
    expect(
      shouldAutoStartImportGuide({
        hasImports: true,
        completeStatus: "paused",
        activeGuide: null,
      }),
    ).toBe(false);
    expect(
      shouldAutoStartImportGuide({
        hasImports: false,
        importStatus: "dismissed",
        completeStatus: "paused",
        activeGuide: null,
      }),
    ).toBe(false);
    expect(
      shouldAutoStartImportGuide({
        hasImports: false,
        completeStatus: "active",
        activeGuide: "complete",
      }),
    ).toBe(false);
    expect(
      shouldAutoStartImportGuide({
        hasImports: false,
        completeStatus: "paused",
        activeGuide: null,
        mode: "invitation",
      }),
    ).toBe(false);
  });

  it("follows the import phase stored by the real flow", async () => {
    useQuickStartGuide.getState().start("import");
    render(
      <MemoryRouter>
        <div data-import-tutorial="choose">Escolha</div>
        <div data-import-tutorial="review">Revisão</div>
        <ImportTutorial />
      </MemoryRouter>,
    );

    expect(screen.getByRole("heading", { name: "Comece pelo arquivo exportado" })).toBeTruthy();
    const region = screen.getByRole("region", { name: "Comece pelo arquivo exportado" });
    expect(region.parentElement?.parentElement).toBe(document.body);
    expect(region.classList.contains("is-docked")).toBe(false);
    useQuickStartGuide.getState().setImportPhase("review");
    await waitFor(() => expect(screen.getByRole("heading", { name: "Revise o que vai entrar" })).toBeTruthy());
    expect(screen.getByRole("region", { name: "Revise o que vai entrar" }).classList.contains("is-docked")).toBe(false);

    const reviewTarget = document.querySelector('[data-import-tutorial="review"]') as HTMLElement;
    vi.spyOn(reviewTarget, "getBoundingClientRect").mockReturnValue({
      top: 80,
      right: 520,
      bottom: 150,
      left: 40,
      width: 480,
      height: 70,
      x: 40,
      y: 80,
      toJSON: () => ({}),
    });
    fireEvent(window, new Event("resize"));

    await waitFor(() => {
      const highlight = document.querySelector(".quick-start-guide__highlight") as HTMLElement;
      expect(Number.parseFloat(highlight.style.top)).toBeCloseTo(74);
      expect(Number.parseFloat(highlight.style.left)).toBeCloseTo(34);
      expect(Number.parseFloat(highlight.style.width)).toBeCloseTo(492);
      expect(Number.parseFloat(highlight.style.height)).toBeCloseTo(82);
    });
  });

  it("guides the complete invoice check when a card is already selected", async () => {
    useQuickStartGuide.getState().start("import");
    useQuickStartGuide.getState().setImportPhase("configure");
    render(
      <MemoryRouter>
        <div data-import-tutorial="configure">Cabeçalho da configuração</div>
        <div data-import-tutorial="configure-card">Seletor de cartão</div>
        <div data-import-tutorial="configure-card-review">
          Cartão, vencimento
          <button>Revisar fatura</button>
        </div>
        <ImportTutorial configureKind="card" hasCards cardSelected />
      </MemoryRouter>,
    );

    expect(screen.getByRole("heading", { name: "Confira os dados da fatura" })).toBeTruthy();
    expect(screen.getByText(/O Lumen pré-selecionou um cartão/)).toBeTruthy();
    expect(screen.getByText(/clique em Revisar fatura/)).toBeTruthy();

    const region = screen.getByRole("region", { name: "Confira os dados da fatura" });
    vi.spyOn(region, "getBoundingClientRect").mockReturnValue({
      top: 120,
      right: 480,
      bottom: 360,
      left: 80,
      width: 400,
      height: 240,
      x: 80,
      y: 120,
      toJSON: () => ({}),
    });
    const target = document.querySelector('[data-import-tutorial="configure-card-review"]') as HTMLElement;
    vi.spyOn(target, "getBoundingClientRect").mockReturnValue({
      top: 120,
      right: 840,
      bottom: 360,
      left: 500,
      width: 340,
      height: 240,
      x: 80,
      y: 120,
      toJSON: () => ({}),
    });
    fireEvent(window, new Event("resize"));

    await waitFor(() => {
      const highlight = document.querySelector(".quick-start-guide__highlight") as HTMLElement;
      expect(Number.parseFloat(highlight.style.top)).toBeCloseTo(114);
      expect(Number.parseFloat(highlight.style.left)).toBeCloseTo(494);
      expect(Number.parseFloat(highlight.style.width)).toBeCloseTo(352);
      expect(Number.parseFloat(highlight.style.height)).toBeCloseTo(252);
      const positioner = region.parentElement as HTMLElement;
      expect(positioner.dataset.placement).toBe("left");
      expect(positioner.style.transform).toContain("translate(80px, 114px)");
    });
  });

  it("uses a safe floating fallback when the selected-card form does not fit on the left", async () => {
    const originalWidth = window.innerWidth;
    const originalHeight = window.innerHeight;
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 600 });
    Object.defineProperty(window, "innerHeight", { configurable: true, value: 800 });

    try {
      useQuickStartGuide.getState().start("import");
      useQuickStartGuide.getState().setImportPhase("configure");
      render(
        <MemoryRouter>
          <div data-import-tutorial="configure-card-review">Formulário completo</div>
          <ImportTutorial configureKind="card" hasCards cardSelected />
        </MemoryRouter>,
      );

      const region = screen.getByRole("region", { name: "Confira os dados da fatura" });
      vi.spyOn(region, "getBoundingClientRect").mockReturnValue({
        top: 0,
        right: 400,
        bottom: 240,
        left: 0,
        width: 400,
        height: 240,
        x: 0,
        y: 0,
        toJSON: () => ({}),
      });
      const target = document.querySelector('[data-import-tutorial="configure-card-review"]') as HTMLElement;
      vi.spyOn(target, "getBoundingClientRect").mockReturnValue({
        top: 300,
        right: 500,
        bottom: 540,
        left: 100,
        width: 400,
        height: 240,
        x: 100,
        y: 300,
        toJSON: () => ({}),
      });
      fireEvent(window, new Event("resize"));

      await waitFor(() => {
        const positioner = region.parentElement as HTMLElement;
        expect(positioner.dataset.placement).toBe("top");
        expect(positioner.style.transform).toContain("translate(94px, 40px)");
      });
    } finally {
      Object.defineProperty(window, "innerWidth", { configurable: true, value: originalWidth });
      Object.defineProperty(window, "innerHeight", { configurable: true, value: originalHeight });
    }
  });

  it("asks for a card selection when cards exist but none is selected", () => {
    useQuickStartGuide.getState().start("import");
    useQuickStartGuide.getState().setImportPhase("configure");
    render(
      <MemoryRouter>
        <div data-import-tutorial="configure-card">Seletor de cartão</div>
        <div data-import-tutorial="configure-card-review">Formulário completo</div>
        <ImportTutorial configureKind="card" hasCards />
      </MemoryRouter>,
    );

    expect(screen.getByRole("heading", { name: "Selecione o cartão da fatura" })).toBeTruthy();
    expect(screen.getByText(/Escolha o cartão ao qual esta fatura pertence/)).toBeTruthy();
    expect(screen.getByText(/clique em Revisar fatura/)).toBeTruthy();
  });

  it("asks the user to create a card when none exists", () => {
    useQuickStartGuide.getState().start("import");
    useQuickStartGuide.getState().setImportPhase("configure");
    render(
      <MemoryRouter>
        <div data-import-tutorial="configure-card">Seletor de cartão</div>
        <div data-import-tutorial="configure-card-review">Formulário completo</div>
        <ImportTutorial configureKind="card" />
      </MemoryRouter>,
    );

    expect(screen.getByRole("heading", { name: "Cadastre o cartão da fatura" })).toBeTruthy();
    expect(screen.getByText(/Use o botão \+ para cadastrar o cartão da fatura/)).toBeTruthy();
    expect(screen.getByText(/clique em Revisar fatura/)).toBeTruthy();
  });

  it("can be paused or permanently dismissed", () => {
    useQuickStartGuide.getState().start("import");
    const view = render(
      <MemoryRouter>
        <ImportTutorial />
      </MemoryRouter>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Pausar ajuda" }));
    expect(useQuickStartGuide.getState().guides.import?.status).toBe("paused");

    useQuickStartGuide.getState().resume("import");
    view.rerender(
      <MemoryRouter>
        <ImportTutorial />
      </MemoryRouter>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Encerrar ajuda" }));
    expect(useQuickStartGuide.getState().guides.import?.status).toBe("dismissed");
  });

  it("keeps the success step visible until the user completes it", () => {
    useQuickStartGuide.getState().start("import");
    useQuickStartGuide.getState().setImportPhase("success");
    render(
      <MemoryRouter>
        <div data-import-tutorial="success">Concluída</div>
        <ImportTutorial />
      </MemoryRouter>,
    );

    expect(screen.getByRole("heading", { name: "Importação concluída" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Fechar" }));
    expect(useQuickStartGuide.getState().guides.import?.status).toBe("completed");
  });
});
