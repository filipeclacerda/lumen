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
        <div id="tutorial-host" />
        <div data-import-tutorial="choose">Escolha</div>
        <div data-import-tutorial="review">Revisão</div>
        <ImportTutorial />
      </MemoryRouter>,
    );

    expect(screen.getByRole("heading", { name: "Comece pelo arquivo exportado" })).toBeTruthy();
    await waitFor(() =>
      expect(
        screen.getByRole("region", { name: "Comece pelo arquivo exportado" }).closest("#tutorial-host"),
      ).toBeTruthy(),
    );
    useQuickStartGuide.getState().setImportPhase("review");
    await waitFor(() => expect(screen.getByRole("heading", { name: "Revise o que vai entrar" })).toBeTruthy());
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
