import { ArrowRight, CheckCircle2, Landmark, ShieldCheck, Sparkles, UserRound, WalletCards } from "lucide-react";
import { useState } from "react";
import { api } from "../../shared/api";
import { MoneyInput } from "../../shared/ui/MoneyInput";
import { Select } from "../../shared/ui/Select";
import type { AccountType, AppBootstrap, FinancialGoal } from "../../shared/types";
import { BrandLogo } from "../../shared/ui/BrandLogo";
import { incomeDayOptions, parseIncomeDaySelection } from "../../shared/incomeDay";
import { queueQuickStartGuide, useQuickStartGuide } from "../../shared/quickStartGuide";

const goals: { value: FinancialGoal; label: string }[] = [
  { value: "organize", label: "Organizar minhas finanças" },
  { value: "emergency_fund", label: "Criar uma reserva de emergência" },
  { value: "pay_debt", label: "Quitar dívidas" },
  { value: "save", label: "Economizar para um objetivo" },
  { value: "invest", label: "Investir mais" },
];

export function Onboarding({
  bootstrap,
  onFinished,
}: {
  bootstrap: AppBootstrap;
  onFinished: (destination: string) => Promise<void>;
}) {
  const [step, setStep] = useState(1);
  const [name, setName] = useState("");
  const [incomeInCents, setIncomeInCents] = useState<number | null>(null);
  const [incomeDay, setIncomeDay] = useState("");
  const [goal, setGoal] = useState<FinancialGoal>();
  const [accountName, setAccountName] = useState(bootstrap.account?.name ?? "Conta principal");
  const [accountKind, setAccountKind] = useState<Exclude<AccountType, "credit_card">>(
    bootstrap.account?.kind === "savings" || bootstrap.account?.kind === "cash" ? bootstrap.account.kind : "checking",
  );
  const [openingBalanceInCents, setOpeningBalanceInCents] = useState<number | null>(null);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [completed, setCompleted] = useState(false);
  const startQuickStartGuide = useQuickStartGuide((state) => state.start);

  function nextProfile() {
    if (name.trim().length < 2) {
      setError("Informe um nome com pelo menos 2 caracteres.");
      return;
    }
    setError("");
    setStep(3);
  }
  async function finish() {
    if (accountName.trim().length < 2) {
      setError("Informe um nome para a conta.");
      return;
    }
    setSaving(true);
    setError("");
    try {
      await api.completeOnboarding({
        displayName: name.trim(),
        monthlyIncomeInCents: incomeInCents ?? undefined,
        ...parseIncomeDaySelection(incomeDay),
        financialGoal: goal,
        accountName: accountName.trim(),
        accountKind,
        openingBalanceInCents: !bootstrap.hasTransactions ? (openingBalanceInCents ?? undefined) : undefined,
      });
      queueQuickStartGuide();
      setCompleted(true);
    } catch (e) {
      setError(typeof e === "object" && e && "message" in e ? String((e as { message: unknown }).message) : String(e));
    } finally {
      setSaving(false);
    }
  }

  async function beginQuickStartGuide() {
    startQuickStartGuide();
    await onFinished("/import");
  }

  if (completed)
    return (
      <div className="onboarding-shell">
        <div className="onboarding-card completion">
          <div className="completion-heading">
            <div className="success-icon">
              <CheckCircle2 />
            </div>
            <p className="eyebrow">TUDO PRONTO</p>
            <h1>Seu espaço financeiro está pronto</h1>
            <p className="muted">Antes de começar, veja onde estão as funções principais do Lumen.</p>
          </div>

          <section className="completion-guide" aria-labelledby="completion-guide-title">
            <div className="completion-guide-icon" aria-hidden="true">
              <Sparkles />
            </div>
            <div className="completion-guide-content">
              <span>GUIA RÁPIDO · 7 PASSOS</span>
              <h2 id="completion-guide-title">Conheça o essencial</h2>
              <p>Veja como importar, organizar e acompanhar seu mês em menos de um minuto.</p>
              <ol aria-label="Etapas do guia rápido">
                <li>
                  <b>1</b> Importar
                </li>
                <li>
                  <b>2</b> Organizar
                </li>
                <li>
                  <b>3</b> Acompanhar
                </li>
                <li>
                  <b>4</b> Filtros
                </li>
                <li>
                  <b>5</b> Indicadores
                </li>
                <li>
                  <b>6</b> Relatórios
                </li>
                <li>
                  <b>7</b> Categorias
                </li>
              </ol>
            </div>
            <button onClick={beginQuickStartGuide}>
              Começar guia <ArrowRight size={17} />
            </button>
          </section>
          <p className="completion-guide-note">Você pode pular ou fechar o guia a qualquer momento.</p>
        </div>
      </div>
    );

  return (
    <div className="onboarding-shell">
      <div className="onboarding-card">
        <div className="onboarding-brand">
          <BrandLogo size={34} decorative />
          <b>Lumen</b>
        </div>
        <div className="step-indicator">
          <i className={step >= 1 ? "active" : ""} />
          <i className={step >= 2 ? "active" : ""} />
          <i className={step >= 3 ? "active" : ""} />
        </div>
        {step === 1 && (
          <div className="onboarding-content welcome">
            <div className="onboarding-illustration">
              <Landmark />
            </div>
            <p className="eyebrow">BEM-VINDO</p>
            <h1>Seu dinheiro, mais claro</h1>
            <p className="muted">
              Organize extratos, categorias e objetivos em um só lugar, sem abrir mão da sua privacidade.
            </p>
            <div className="privacy-points">
              <div>
                <ShieldCheck />
                <span>
                  <b>100% local</b>
                  <small>Seus dados ficam neste computador.</small>
                </span>
              </div>
              <div>
                <WalletCards />
                <span>
                  <b>Feito para sua rotina</b>
                  <small>Importe extratos e acompanhe seu mês.</small>
                </span>
              </div>
            </div>
            <button className="wide-button" onClick={() => setStep(2)}>
              Começar <ArrowRight size={17} />
            </button>
          </div>
        )}
        {step === 2 && (
          <div className="onboarding-content">
            <div className="step-icon">
              <UserRound />
            </div>
            <p className="eyebrow">SEU PERFIL</p>
            <h1>Vamos nos conhecer</h1>
            <p className="muted">Só o nome é obrigatório. Você pode completar o restante depois.</p>
            <label>
              Como devemos chamar você?{" "}
              <input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="Seu nome" />
            </label>
            <div className="form-row">
              <label>
                Renda líquida mensal <MoneyInput defaultCents={incomeInCents ?? 0} onChange={setIncomeInCents} />
              </label>
              <label>
                Dia de recebimento <Select value={incomeDay} onChange={setIncomeDay} options={incomeDayOptions} />
              </label>
            </div>
            <label>
              Objetivo principal{" "}
              <Select
                value={goal ?? ""}
                onChange={(value) => setGoal((value || undefined) as FinancialGoal | undefined)}
                options={[{ value: "", label: "Escolha depois" }, ...goals]}
              />
            </label>
            {error && <p className="form-error">{error}</p>}
            <div className="onboarding-actions">
              <button className="secondary" onClick={() => setStep(1)}>
                Voltar
              </button>
              <button onClick={nextProfile}>
                Continuar <ArrowRight size={17} />
              </button>
            </div>
          </div>
        )}
        {step === 3 && (
          <div className="onboarding-content">
            <div className="step-icon">
              <WalletCards />
            </div>
            <p className="eyebrow">PRIMEIRA CONTA</p>
            <h1>Configure sua conta principal</h1>
            <p className="muted">
              {bootstrap.hasTransactions
                ? "Encontramos movimentações existentes; seu saldo atual será preservado."
                : "O saldo inicial é opcional e não será contado como receita."}
            </p>
            <label>
              Nome da conta{" "}
              <input
                autoFocus
                value={accountName}
                onChange={(e) => setAccountName(e.target.value)}
                placeholder="Conta principal"
              />
            </label>
            <label>
              Tipo de conta{" "}
              <Select
                value={accountKind}
                onChange={(value) => setAccountKind(value as Exclude<AccountType, "credit_card">)}
                options={[
                  { value: "checking", label: "Conta corrente" },
                  { value: "savings", label: "Poupança" },
                  { value: "cash", label: "Dinheiro" },
                ]}
              />
            </label>
            {!bootstrap.hasTransactions && (
              <label>
                Saldo inicial{" "}
                <MoneyInput defaultCents={openingBalanceInCents ?? 0} onChange={setOpeningBalanceInCents} />
              </label>
            )}
            {error && <p className="form-error">{error}</p>}
            <div className="onboarding-actions">
              <button className="secondary" onClick={() => setStep(2)}>
                Voltar
              </button>
              <button disabled={saving} onClick={finish}>
                {saving ? "Salvando…" : "Concluir cadastro"} <CheckCircle2 size={17} />
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
