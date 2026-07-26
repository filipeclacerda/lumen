// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  resetQuickStartGuideForTests,
  storedQuickStartGuideStatus,
  useQuickStartGuide,
} from "../../shared/quickStartGuide";
import { Onboarding } from "./Onboarding";

const mocks = vi.hoisted(() => ({
  completeOnboarding: vi.fn(),
}));

vi.mock("../../shared/api", () => ({
  api: mocks,
}));

function renderOnboarding(onFinished = vi.fn().mockResolvedValue(undefined)) {
  render(<Onboarding onFinished={onFinished} />);
  return onFinished;
}

function openGoalStep() {
  fireEvent.click(screen.getByRole("button", { name: "Começar" }));
}

function fillGoalStep({
  name = "Filipe",
  target = "",
}: {
  name?: string;
  target?: string;
} = {}) {
  fireEvent.change(screen.getByLabelText(/Como o Lumen pode chamar você/), { target: { value: name } });
  if (target) {
    fireEvent.change(screen.getByLabelText(/Quanto quer separar por mês/), { target: { value: target } });
  }
}

function openStartStep() {
  openGoalStep();
  fillGoalStep();
  fireEvent.click(screen.getByRole("button", { name: "Continuar" }));
}

function openReviewStep() {
  openStartStep();
  fireEvent.click(screen.getByRole("button", { name: "Continuar" }));
}

describe("Onboarding", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    resetQuickStartGuideForTests();
    mocks.completeOnboarding.mockResolvedValue({ profile: {}, accountId: "account-1" });
  });

  afterEach(cleanup);

  it("renders four accessible stages and keeps the preview explicitly illustrative", () => {
    const { container } = render(<Onboarding onFinished={vi.fn()} />);

    expect(container.querySelectorAll(".onboarding-progress__track i")).toHaveLength(4);
    expect(screen.getByRole("progressbar").getAttribute("aria-valuenow")).toBe("1");
    expect(screen.getByText("Prévia ilustrativa")).toBeTruthy();
    expect(screen.getByText("Sem dados reais")).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Seu dinheiro, mais claro." })).toBeTruthy();
  });

  it("preserves the theme already resolved from the saved or system preference", () => {
    document.documentElement.dataset.theme = "light";
    const { unmount } = render(<Onboarding onFinished={vi.fn()} />);

    expect(document.documentElement.dataset.theme).toBe("light");
    expect(document.documentElement.dataset.appSurface).toBe("onboarding");

    unmount();
    document.documentElement.dataset.theme = "dark";
    const darkOnboarding = render(<Onboarding onFinished={vi.fn()} />);

    expect(document.documentElement.dataset.theme).toBe("dark");

    darkOnboarding.unmount();
    delete document.documentElement.dataset.theme;
  });

  it("supports previous and next navigation without losing the draft", () => {
    renderOnboarding();
    openGoalStep();
    fillGoalStep({ name: "Filipe", target: "50000" });
    fireEvent.click(screen.getByRole("radio", { name: /Criar uma reserva/ }));
    fireEvent.click(screen.getByRole("button", { name: "Continuar" }));
    fireEvent.click(screen.getByRole("button", { name: "Voltar" }));

    expect((screen.getByRole("radio", { name: /Criar uma reserva/ }) as HTMLInputElement).checked).toBe(true);
    expect((screen.getByLabelText(/Como o Lumen pode chamar você/) as HTMLInputElement).value).toBe("Filipe");
    expect((screen.getByLabelText(/Quanto quer separar por mês/) as HTMLInputElement).value).toBe("500,00");
  });

  it("validates the name and optional monthly target before advancing", () => {
    renderOnboarding();
    openGoalStep();

    fireEvent.click(screen.getByRole("button", { name: "Continuar" }));
    expect(screen.getByRole("alert").textContent).toContain("Informe um nome com 2 a 80 caracteres.");
    expect(mocks.completeOnboarding).not.toHaveBeenCalled();
  });

  it("reflects every goal and starting choice in the review", () => {
    renderOnboarding();
    openGoalStep();
    fillGoalStep({ name: "Filipe", target: "50000" });

    for (const goal of ["Organizar minhas finanças", "Criar uma reserva", "Quitar dívidas", "Planejar um objetivo"]) {
      fireEvent.click(screen.getByRole("radio", { name: new RegExp(goal) }));
      expect(screen.getAllByText(goal).length).toBeGreaterThan(0);
    }

    fireEvent.click(screen.getByRole("button", { name: "Continuar" }));
    for (const start of ["Importar um extrato", "Começar do zero", "Conhecer o Lumen primeiro"]) {
      fireEvent.click(screen.getByRole("radio", { name: new RegExp(start) }));
      expect(screen.getAllByText(start).length).toBeGreaterThan(0);
    }
    fireEvent.click(screen.getByRole("radio", { name: /Começar do zero/ }));
    fireEvent.click(screen.getByRole("button", { name: "Continuar" }));

    expect(screen.getByText("Planejar um objetivo")).toBeTruthy();
    expect(screen.getByText("R$ 500,00/mês")).toBeTruthy();
    expect(screen.getByText("Filipe")).toBeTruthy();
    expect(screen.getByText("Começar do zero")).toBeTruthy();
  });

  it("persists only onboarding preferences and redirects import with its guide", async () => {
    const onFinished = renderOnboarding();
    openGoalStep();
    fillGoalStep({ target: "50000" });
    fireEvent.click(screen.getByRole("radio", { name: /Criar uma reserva/ }));
    fireEvent.click(screen.getByRole("button", { name: "Continuar" }));
    fireEvent.click(screen.getByRole("radio", { name: /Importar um extrato/ }));
    fireEvent.click(screen.getByRole("button", { name: "Continuar" }));
    fireEvent.click(screen.getByRole("button", { name: "Abrir o Lumen" }));

    await waitFor(() =>
      expect(mocks.completeOnboarding).toHaveBeenCalledWith({
        displayName: "Filipe",
        financialGoal: "emergency_fund",
        monthlyTargetInCents: 50000,
        onboardingStartMode: "import",
      }),
    );
    expect(onFinished).toHaveBeenCalledWith("/import?action=choose");
    expect(useQuickStartGuide.getState().activeGuide).toBe("import");
    expect(useQuickStartGuide.getState().guides.import).toEqual({
      status: "active",
      phase: "choose",
      lessonId: "choose-files",
    });
  });

  it("routes manual and tour choices to their appropriate experiences", async () => {
    const manualFinished = renderOnboarding();
    openStartStep();
    fireEvent.click(screen.getByRole("radio", { name: /Começar do zero/ }));
    fireEvent.click(screen.getByRole("button", { name: "Continuar" }));
    fireEvent.click(screen.getByRole("button", { name: "Abrir o Lumen" }));
    await waitFor(() => expect(manualFinished).toHaveBeenCalledWith("/accounts"));
    expect(storedQuickStartGuideStatus()).toBeUndefined();

    cleanup();
    localStorage.clear();
    resetQuickStartGuideForTests();
    const tourFinished = renderOnboarding();
    openStartStep();
    fireEvent.click(screen.getByRole("radio", { name: /Conhecer o Lumen primeiro/ }));
    fireEvent.click(screen.getByRole("button", { name: "Continuar" }));
    fireEvent.click(screen.getByRole("button", { name: "Abrir o Lumen" }));
    await waitFor(() => expect(tourFinished).toHaveBeenCalledWith("/import"));
    expect(useQuickStartGuide.getState().activeGuide).toBe("complete");
  });

  it("keeps the review open and exposes persistence errors", async () => {
    mocks.completeOnboarding.mockRejectedValueOnce(new Error("Não foi possível salvar."));
    renderOnboarding();
    openReviewStep();
    fireEvent.click(screen.getByRole("button", { name: "Abrir o Lumen" }));

    expect((await screen.findByRole("alert")).textContent).toContain("Não foi possível salvar.");
    expect(screen.getByRole("heading", { name: /Seu espaço financeiro começa/ })).toBeTruthy();
    expect(useQuickStartGuide.getState().mode).toBe("closed");
  });
});
