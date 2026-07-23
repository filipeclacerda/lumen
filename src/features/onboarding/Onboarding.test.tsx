// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Onboarding } from "./Onboarding";
import {
  resetQuickStartGuideForTests,
  storedQuickStartGuideStatus,
  useQuickStartGuide,
} from "../../shared/quickStartGuide";

const mocks = vi.hoisted(() => ({
  completeOnboarding: vi.fn(),
  categories: vi.fn(),
  saveCategory: vi.fn(),
  archiveCategory: vi.fn(),
}));

vi.mock("../../shared/api", () => ({
  api: mocks,
}));

const bootstrap = {
  onboardingCompleted: false,
  hasTransactions: false,
  hasImports: false,
};

function renderOnboarding(onFinished = vi.fn().mockResolvedValue(undefined)) {
  render(<Onboarding bootstrap={bootstrap} onFinished={onFinished} />);
  return onFinished;
}

function reachProfile() {
  fireEvent.click(screen.getByRole("button", { name: /Começar/i }));
}

function reachAccount() {
  reachProfile();
  fireEvent.change(screen.getByLabelText(/Como devemos chamar você/i), { target: { value: "Filipe" } });
  fireEvent.click(screen.getByRole("button", { name: /Continuar/i }));
}

async function completeFlow(onFinished = vi.fn().mockResolvedValue(undefined)) {
  renderOnboarding(onFinished);
  reachAccount();
  fireEvent.click(screen.getByRole("button", { name: /Concluir cadastro/i }));
  await screen.findByRole("heading", { name: "Seu espaço financeiro está pronto" });
  return onFinished;
}

describe("Onboarding", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    resetQuickStartGuideForTests();
    mocks.completeOnboarding.mockResolvedValue({ profile: {}, accountId: "account-1" });
  });

  afterEach(cleanup);

  it("uses three steps and does not load or modify categories", () => {
    const { container } = render(<Onboarding bootstrap={bootstrap} onFinished={vi.fn()} />);

    expect(container.querySelectorAll(".step-indicator i")).toHaveLength(3);
    expect(mocks.categories).not.toHaveBeenCalled();
    expect(mocks.saveCategory).not.toHaveBeenCalled();
    expect(mocks.archiveCategory).not.toHaveBeenCalled();
  });

  it("validates the required profile and account names", () => {
    renderOnboarding();
    reachProfile();

    fireEvent.click(screen.getByRole("button", { name: /Continuar/i }));
    expect(screen.getByText("Informe um nome com pelo menos 2 caracteres.")).toBeTruthy();

    fireEvent.change(screen.getByLabelText(/Como devemos chamar você/i), { target: { value: "Filipe" } });
    fireEvent.click(screen.getByRole("button", { name: /Continuar/i }));
    fireEvent.change(screen.getByLabelText(/Nome da conta/i), { target: { value: "X" } });
    fireEvent.click(screen.getByRole("button", { name: /Concluir cadastro/i }));

    expect(screen.getByText("Informe um nome para a conta.")).toBeTruthy();
    expect(mocks.completeOnboarding).not.toHaveBeenCalled();
  });

  it("submits the existing payload from the account step and presents errors", async () => {
    mocks.completeOnboarding.mockRejectedValueOnce(new Error("Não foi possível salvar."));
    renderOnboarding();
    reachAccount();
    fireEvent.click(screen.getByRole("button", { name: /Concluir cadastro/i }));

    await waitFor(() =>
      expect(mocks.completeOnboarding).toHaveBeenCalledWith({
        displayName: "Filipe",
        monthlyIncomeInCents: undefined,
        incomeDay: undefined,
        financialGoal: undefined,
        accountName: "Conta principal",
        accountKind: "checking",
        openingBalanceInCents: undefined,
      }),
    );
    expect(await screen.findByText("Não foi possível salvar.")).toBeTruthy();
    expect(storedQuickStartGuideStatus()).toBeUndefined();
    expect(useQuickStartGuide.getState().mode).toBe("closed");
  });

  it("offers three explicit next steps without automatically queuing a guide", async () => {
    await completeFlow();

    expect(screen.getByRole("button", { name: /Fazer primeira importação/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /Conhecer o Lumen/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /Explorar por conta própria/i })).toBeTruthy();
    expect(storedQuickStartGuideStatus()).toBeUndefined();
    expect(useQuickStartGuide.getState().mode).toBe("closed");
  });

  it("starts the import help from the completion choices", async () => {
    const onFinished = vi.fn().mockResolvedValue(undefined);
    await completeFlow(onFinished);

    fireEvent.click(screen.getByRole("button", { name: /Fazer primeira importação/i }));

    await waitFor(() => expect(onFinished).toHaveBeenCalledWith("/import"));
    expect(useQuickStartGuide.getState().activeGuide).toBe("import");
    expect(useQuickStartGuide.getState().guides.import).toEqual({ status: "active", phase: "choose" });
  });

  it("starts the complete tour or explores without a guide", async () => {
    const tourFinished = vi.fn().mockResolvedValue(undefined);
    await completeFlow(tourFinished);
    fireEvent.click(screen.getByRole("button", { name: /Conhecer o Lumen/i }));
    await waitFor(() => expect(tourFinished).toHaveBeenCalledWith("/import"));
    expect(useQuickStartGuide.getState().activeGuide).toBe("complete");

    cleanup();
    localStorage.clear();
    resetQuickStartGuideForTests();
    const exploreFinished = vi.fn().mockResolvedValue(undefined);
    await completeFlow(exploreFinished);
    fireEvent.click(screen.getByRole("button", { name: /Explorar por conta própria/i }));
    await waitFor(() => expect(exploreFinished).toHaveBeenCalledWith("/"));
    expect(useQuickStartGuide.getState().mode).toBe("closed");
  });
});
