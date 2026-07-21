// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Onboarding } from "./Onboarding";

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
  await screen.findByRole("heading", { name: "Seu espaço financeiro foi criado" });
  return onFinished;
}

describe("Onboarding", () => {
  beforeEach(() => {
    vi.clearAllMocks();
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
  });

  it.each([
    ["Ir para visão geral", "/"],
    ["Importar primeiro extrato", "/import"],
    ["Ajustar categorias", "/categories?tab=categories"],
  ])("opens %s after completion", async (label, destination) => {
    const onFinished = vi.fn().mockResolvedValue(undefined);
    await completeFlow(onFinished);

    fireEvent.click(screen.getByRole("button", { name: new RegExp(label, "i") }));

    expect(onFinished).toHaveBeenCalledWith(destination);
  });
});
