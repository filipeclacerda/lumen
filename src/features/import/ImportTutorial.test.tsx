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
        <div data-import-tutorial="review-summary">Resumo</div>
        <div data-import-tutorial="review-category-group">Categorias</div>
        <div data-import-tutorial="review-tabs">Abas</div>
        <button data-import-tutorial="review-confirm">Confirmar</button>
        <ImportTutorial hasPreview />
      </MemoryRouter>,
    );

    expect(screen.getByRole("heading", { name: "Escolha o arquivo exportado" })).toBeTruthy();
    const region = screen.getByRole("region", { name: "Escolha o arquivo exportado" });
    expect(region.parentElement?.parentElement).toBe(document.body);
    expect(region.classList.contains("is-docked")).toBe(false);
    useQuickStartGuide.getState().setImportPhase("review");
    await waitFor(() =>
      expect(screen.getByRole("heading", { name: "Entenda de onde vieram as categorias" })).toBeTruthy(),
    );
    expect(
      screen.getByRole("region", { name: "Entenda de onde vieram as categorias" }).classList.contains("is-docked"),
    ).toBe(false);

    const reviewTarget = document.querySelector('[data-import-tutorial="review-summary"]') as HTMLElement;
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

  it("keeps the card visually hidden until the lesson target is positioned", async () => {
    useQuickStartGuide.getState().start("import");
    const view = render(
      <MemoryRouter>
        <ImportTutorial />
      </MemoryRouter>,
    );

    const region = screen.getByRole("region", { name: "Escolha o arquivo exportado" });
    const positioner = region.parentElement as HTMLElement;
    expect(positioner.style.opacity).toBe("0");
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

    view.rerender(
      <MemoryRouter>
        <div data-import-tutorial="choose">Escolher arquivo</div>
        <ImportTutorial />
      </MemoryRouter>,
    );
    const target = document.querySelector('[data-import-tutorial="choose"]') as HTMLElement;
    let targetTop = 120;
    vi.spyOn(target, "getBoundingClientRect").mockImplementation(() => ({
      top: targetTop,
      right: 920,
      bottom: targetTop + 100,
      left: 120,
      width: 800,
      height: 100,
      x: 120,
      y: targetTop,
      toJSON: () => ({}),
    }));
    fireEvent(window, new Event("resize"));

    await waitFor(() => {
      const positioned = screen.getByRole("region", { name: "Escolha o arquivo exportado" })
        .parentElement as HTMLElement;
      expect(positioned.dataset.placement).toBeTruthy();
      expect(positioned.style.opacity).toBe("0");
      expect(document.querySelector(".quick-start-guide__highlight")).toBeNull();
    });

    targetTop = 340;
    fireEvent(window, new Event("resize"));
    await waitFor(() => {
      const positioned = screen.getByRole("region", { name: "Escolha o arquivo exportado" })
        .parentElement as HTMLElement;
      expect(positioned.style.opacity).toBe("0");
      expect(document.querySelector(".quick-start-guide__highlight")).toBeNull();
    });

    await waitFor(() => {
      const positioned = screen.getByRole("region", { name: "Escolha o arquivo exportado" })
        .parentElement as HTMLElement;
      expect(positioned.dataset.placement).toBeTruthy();
      expect(positioned.style.opacity).toBe("");
      const highlight = document.querySelector(".quick-start-guide__highlight") as HTMLElement;
      expect(Number.parseFloat(highlight.style.top)).toBeCloseTo(340);
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
    expect(screen.getByText(/O Lumen pode pré-selecionar o único cartão cadastrado/)).toBeTruthy();
    expect(screen.getByText(/Confirme os dois campos antes de abrir a revisão/)).toBeTruthy();

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
    expect(screen.getByText(/Escolha o cartão ao qual este arquivo pertence/)).toBeTruthy();
    expect(screen.getByText(/Use Revisar fatura somente depois de confirmar o destino/)).toBeTruthy();
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
    expect(screen.getByText(/Use o botão \+ para cadastrar o cartão sem perder o arquivo/)).toBeTruthy();
    expect(screen.getByText(/selecione o cartão, confira o vencimento/)).toBeTruthy();
  });

  it("moves the highlight to the complete card dialog while it is open", async () => {
    useQuickStartGuide.getState().start("import");
    useQuickStartGuide.getState().setImportPhase("configure");
    const view = render(
      <MemoryRouter>
        <div data-import-tutorial="configure-card">Seletor de cartão</div>
        <div className="import-card-creation-dialog">Cadastro completo do cartão</div>
        <ImportTutorial configureKind="card" cardCreationOpen />
      </MemoryRouter>,
    );

    expect(screen.getByRole("heading", { name: "Cadastre o cartão correto" })).toBeTruthy();
    expect(screen.getByText(/Use um nome fácil de reconhecer/)).toBeTruthy();

    const backgroundTarget = document.querySelector('[data-import-tutorial="configure-card"]') as HTMLElement;
    vi.spyOn(backgroundTarget, "getBoundingClientRect").mockReturnValue({
      top: 80,
      right: 900,
      bottom: 150,
      left: 500,
      width: 400,
      height: 70,
      x: 500,
      y: 80,
      toJSON: () => ({}),
    });
    const dialogTarget = document.querySelector(".import-card-creation-dialog") as HTMLElement;
    vi.spyOn(dialogTarget, "getBoundingClientRect").mockReturnValue({
      top: 100,
      right: 760,
      bottom: 360,
      left: 300,
      width: 460,
      height: 260,
      x: 300,
      y: 100,
      toJSON: () => ({}),
    });
    fireEvent(window, new Event("resize"));

    await waitFor(() => {
      const highlight = document.querySelector(".quick-start-guide__highlight") as HTMLElement;
      expect(Number.parseFloat(highlight.style.top)).toBeCloseTo(94);
      expect(Number.parseFloat(highlight.style.left)).toBeCloseTo(294);
      expect(Number.parseFloat(highlight.style.width)).toBeCloseTo(472);
      expect(Number.parseFloat(highlight.style.height)).toBeCloseTo(272);
    });

    view.rerender(
      <MemoryRouter>
        <div data-import-tutorial="configure-card">Seletor de cartão</div>
        <ImportTutorial configureKind="card" />
      </MemoryRouter>,
    );

    expect(screen.getByRole("heading", { name: "Cadastre o cartão da fatura" })).toBeTruthy();
    await waitFor(() => {
      const highlight = document.querySelector(".quick-start-guide__highlight") as HTMLElement;
      expect(Number.parseFloat(highlight.style.top)).toBeCloseTo(80);
      expect(Number.parseFloat(highlight.style.left)).toBeCloseTo(500);
    });
  });

  it("shows confirmation only after the third category lesson is completed", async () => {
    useQuickStartGuide.getState().start("import");
    useQuickStartGuide.getState().setImportPhase("review");
    const confirmAction = vi.fn();
    const view = render(
      <MemoryRouter>
        <div data-import-tutorial="review-summary">Resumo</div>
        <div data-import-tutorial="review-tabs">Abas</div>
        <button data-import-tutorial="review-confirm" onClick={confirmAction}>
          Confirmar
        </button>
        <div data-import-tutorial="review-category-group">Categorias</div>
        <ImportTutorial hasPreview pendingCategoryCount={2} />
      </MemoryRouter>,
    );

    expect(screen.getByRole("heading", { name: "Entenda de onde vieram as categorias" })).toBeTruthy();
    expect(screen.getByText(/Por regra vem de uma regra explícita/)).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Avançar" }));
    expect(await screen.findByRole("heading", { name: "Use “Todas” para a conferência fina" })).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Avançar" }));
    expect(await screen.findByRole("heading", { name: "Resolva uma categoria por vez" })).toBeTruthy();
    expect(useQuickStartGuide.getState().guides.import?.lessonId).toBe("review-categories");
    expect(screen.getByText("Faltam 2 lançamentos para categorizar.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Avançar" })).toBeNull();
    expect(confirmAction).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Ocultar ajuda" }));
    expect(screen.queryByRole("region", { name: "Resolva uma categoria por vez" })).toBeNull();
    expect(useQuickStartGuide.getState().guides.import?.status).toBe("active");
    expect(useQuickStartGuide.getState().guides.import?.lessonId).toBe("review-categories");
    fireEvent.click(screen.getByRole("button", { name: /Mostrar ajuda de categorização/ }));
    expect(await screen.findByRole("heading", { name: "Resolva uma categoria por vez" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Ocultar ajuda" }));

    view.rerender(
      <MemoryRouter>
        <div data-import-tutorial="review-summary">Resumo</div>
        <div data-import-tutorial="review-tabs">Abas</div>
        <button data-import-tutorial="review-confirm" onClick={confirmAction}>
          Confirmar
        </button>
        <div data-import-tutorial="review-categories-ready">Tudo pronto</div>
        <ImportTutorial hasPreview pendingCategoryCount={0} />
      </MemoryRouter>,
    );

    expect(await screen.findByRole("heading", { name: "Confirme somente depois da revisão" })).toBeTruthy();
    expect(screen.getByText("4 de 4")).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "Categorias resolvidas" })).toBeNull();
    expect(useQuickStartGuide.getState().guides.import?.status).toBe("active");
    expect(useQuickStartGuide.getState().guides.import?.lessonId).toBe("review-confirm");
    expect(confirmAction).not.toHaveBeenCalled();
  });

  it("highlights the entire current category group in the last lesson", async () => {
    useQuickStartGuide.getState().start("import");
    useQuickStartGuide.getState().goToImportLesson("review-categories");
    render(
      <MemoryRouter>
        <article data-import-tutorial="review-category-group">Card completo do grupo</article>
        <ImportTutorial hasPreview pendingCategoryCount={1} />
      </MemoryRouter>,
    );

    const target = document.querySelector('[data-import-tutorial="review-category-group"]') as HTMLElement;
    vi.spyOn(target, "getBoundingClientRect").mockReturnValue({
      top: 360,
      right: 952,
      bottom: 720,
      left: 72,
      width: 880,
      height: 360,
      x: 72,
      y: 360,
      toJSON: () => ({}),
    });
    const region = screen.getByRole("region", { name: "Resolva uma categoria por vez" });
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
    fireEvent(window, new Event("resize"));

    await waitFor(() => {
      expect(region.parentElement?.getAttribute("data-placement")).toBe("top");
      const highlight = document.querySelector(".quick-start-guide__highlight") as HTMLElement;
      expect(Number.parseFloat(highlight.style.top)).toBeCloseTo(354);
      expect(Number.parseFloat(highlight.style.left)).toBeCloseTo(66);
      expect(Number.parseFloat(highlight.style.width)).toBeCloseTo(892);
      expect(Number.parseFloat(highlight.style.height)).toBeCloseTo(372);
    });
  });

  it("separates required mapping fields from the file sample", async () => {
    useQuickStartGuide.getState().start("import");
    useQuickStartGuide.getState().setImportPhase("configure");
    render(
      <MemoryRouter>
        <div data-import-tutorial="configure-mapping-fields">Campos</div>
        <div data-import-tutorial="configure-mapping-sample">Amostra</div>
        <ImportTutorial configureKind="mapping" />
      </MemoryRouter>,
    );

    expect(await screen.findByRole("heading", { name: "Diga o que cada coluna representa" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Avançar" }));
    expect(await screen.findByRole("heading", { name: "Valide o resultado na amostra" })).toBeTruthy();
    expect(useQuickStartGuide.getState().guides.import?.lessonId).toBe("configure-mapping-sample");
  });

  it("targets the pending-category decision instead of the covered confirm button", () => {
    useQuickStartGuide.getState().start("import");
    useQuickStartGuide.getState().setImportPhase("confirm");
    render(
      <MemoryRouter>
        <div data-import-tutorial="confirm-pending">Modal de pendências</div>
        <ImportTutorial />
      </MemoryRouter>,
    );

    expect(screen.getByRole("heading", { name: "Decida o que fazer com as pendências" })).toBeTruthy();
    expect(screen.getByText(/Continuar revisando volta à prévia/)).toBeTruthy();
  });

  it("explains the batch queue before the final batch confirmation", async () => {
    useQuickStartGuide.getState().start("import");
    useQuickStartGuide.getState().setImportPhase("review");
    render(
      <MemoryRouter>
        <div data-import-tutorial="batch-queue">Fila do lote</div>
        <button data-import-tutorial="review-confirm">Confirmar lote</button>
        <ImportTutorial batchMode />
      </MemoryRouter>,
    );

    expect(await screen.findByRole("heading", { name: "Acompanhe cada arquivo do lote" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Avançar" }));
    expect(await screen.findByRole("heading", { name: "Faça a validação final do lote" })).toBeTruthy();
  });

  it("applies the category gate before showing the current file action inside a batch", async () => {
    useQuickStartGuide.getState().start("import");
    useQuickStartGuide.getState().goToImportLesson("batch-queue");
    const view = render(
      <MemoryRouter>
        <div data-import-tutorial="batch-queue">Fila do lote</div>
        <div data-import-tutorial="review-summary">Resumo</div>
        <div data-import-tutorial="review-tabs">Abas</div>
        <button data-import-tutorial="review-confirm">Adicionar arquivo ao lote</button>
        <div data-import-tutorial="review-category-group">Categorias</div>
        <ImportTutorial batchMode hasPreview pendingCategoryCount={1} />
      </MemoryRouter>,
    );

    expect(await screen.findByRole("heading", { name: "Acompanhe cada arquivo do lote" })).toBeTruthy();
    for (const title of [
      "Entenda de onde vieram as categorias",
      "Use “Todas” para a conferência fina",
      "Resolva uma categoria por vez",
    ]) {
      fireEvent.click(screen.getByRole("button", { name: "Avançar" }));
      expect(await screen.findByRole("heading", { name: title })).toBeTruthy();
    }

    expect(screen.getByText("Falta 1 lançamento para categorizar.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Avançar" })).toBeNull();

    view.rerender(
      <MemoryRouter>
        <div data-import-tutorial="batch-queue">Fila do lote</div>
        <div data-import-tutorial="review-summary">Resumo</div>
        <div data-import-tutorial="review-tabs">Abas</div>
        <button data-import-tutorial="review-confirm">Adicionar arquivo ao lote</button>
        <div data-import-tutorial="review-categories-ready">Tudo pronto</div>
        <ImportTutorial batchMode hasPreview pendingCategoryCount={0} />
      </MemoryRouter>,
    );

    expect(await screen.findByRole("heading", { name: "Adicione este arquivo ao lote" })).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "Categorias resolvidas" })).toBeNull();
  });

  it("can be paused or permanently dismissed", () => {
    useQuickStartGuide.getState().start("import");
    const view = render(
      <MemoryRouter>
        <ImportTutorial />
      </MemoryRouter>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Pausar ajuda de importação" }));
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
    useQuickStartGuide.getState().pause("import");
    useQuickStartGuide.getState().setImportPhase("success");
    render(
      <MemoryRouter>
        <div data-import-tutorial="success">Concluída</div>
        <ImportTutorial />
      </MemoryRouter>,
    );

    expect(screen.getByRole("heading", { name: "Importação concluída" })).toBeTruthy();
    expect(useQuickStartGuide.getState().guides.import?.status).toBe("active");
    fireEvent.click(screen.getByRole("button", { name: "Fechar" }));
    expect(useQuickStartGuide.getState().guides.import?.status).toBe("completed");
  });
});
