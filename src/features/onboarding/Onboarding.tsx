import {
  ArrowLeft,
  ArrowRight,
  BarChart3,
  Check,
  CloudOff,
  Compass,
  Database,
  FileCheck2,
  FileUp,
  Landmark,
  LockKeyhole,
  ReceiptText,
  ShieldCheck,
  Sparkles,
  Target,
  UserRound,
  WalletCards,
} from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState, type ComponentType, type FormEvent } from "react";
import { api } from "../../shared/api";
import { money } from "../../shared/format";
import { restartImportGuide, restartQuickStartGuide } from "../../shared/quickStartGuide";
import type { FinancialGoal, OnboardingStartMode } from "../../shared/types";
import { MoneyInput } from "../../shared/ui/MoneyInput";

type Step = 0 | 1 | 2 | 3;

type OnboardingDraft = {
  displayName: string;
  financialGoal: FinancialGoal;
  monthlyTargetInCents: number | null;
  onboardingStartMode: OnboardingStartMode;
};

const stepMeta = [
  { label: "Começar", eyebrow: "BEM-VINDO AO LUMEN" },
  { label: "Seu objetivo", eyebrow: "SEU OBJETIVO" },
  { label: "Primeiro movimento", eyebrow: "PRIMEIRO MOVIMENTO" },
  { label: "Tudo pronto", eyebrow: "TUDO PRONTO" },
] as const;

const goalOptions: {
  value: FinancialGoal;
  label: string;
  description: string;
  icon: ComponentType<{ size?: number; "aria-hidden"?: boolean }>;
}[] = [
  {
    value: "organize",
    label: "Organizar minhas finanças",
    description: "Uma visão clara do mês e dos compromissos.",
    icon: WalletCards,
  },
  {
    value: "emergency_fund",
    label: "Criar uma reserva",
    description: "Acompanhe um valor de segurança por etapas.",
    icon: ShieldCheck,
  },
  {
    value: "pay_debt",
    label: "Quitar dívidas",
    description: "Priorize parcelas e veja o caminho restante.",
    icon: ReceiptText,
  },
  {
    value: "save",
    label: "Planejar um objetivo",
    description: "Transforme uma intenção em uma meta mensal.",
    icon: Target,
  },
];

const startOptions: {
  value: OnboardingStartMode;
  label: string;
  description: string;
  icon: ComponentType<{ size?: number; "aria-hidden"?: boolean }>;
}[] = [
  {
    value: "import",
    label: "Importar um extrato",
    description: "Veja uma prévia, trate duplicatas e confirme só no final.",
    icon: FileUp,
  },
  {
    value: "manual",
    label: "Começar do zero",
    description: "Organize contas e movimentações manualmente, no seu ritmo.",
    icon: Landmark,
  },
  {
    value: "tour",
    label: "Conhecer o Lumen primeiro",
    description: "Explore as telas antes de trazer seus dados.",
    icon: Sparkles,
  },
];

function optionLabel<T extends string>(options: { value: T; label: string }[], value: T) {
  return options.find((option) => option.value === value)?.label ?? value;
}

function ChoiceCard<T extends string>({
  name,
  value,
  label,
  description,
  icon: Icon,
  checked,
  onChange,
}: {
  name: string;
  value: T;
  label: string;
  description: string;
  icon: ComponentType<{ size?: number; "aria-hidden"?: boolean }>;
  checked: boolean;
  onChange: (value: T) => void;
}) {
  return (
    <label className={`onboarding-choice${checked ? " is-selected" : ""}`}>
      <input type="radio" name={name} value={value} checked={checked} onChange={() => onChange(value)} />
      <span className="onboarding-choice__icon" aria-hidden="true">
        <Icon size={19} />
      </span>
      <span className="onboarding-choice__copy">
        <strong>{label}</strong>
        <small>{description}</small>
      </span>
      <span className="onboarding-choice__mark" aria-hidden="true" />
    </label>
  );
}

function Preview({ step, draft }: { step: Step; draft: OnboardingDraft }) {
  const goalLabel = optionLabel(goalOptions, draft.financialGoal);
  const startLabel = optionLabel(startOptions, draft.onboardingStartMode);
  const previewHeading =
    draft.onboardingStartMode === "import"
      ? "Traga seus dados sem entregar credenciais."
      : draft.onboardingStartMode === "manual"
        ? "Comece simples e organize no seu ritmo."
        : "Explore com segurança antes de decidir.";

  return (
    <aside className="onboarding-preview" aria-hidden="true">
      <div className="onboarding-preview__orbit onboarding-preview__orbit--top" />
      <div className="onboarding-preview__orbit onboarding-preview__orbit--bottom" />
      <div className="onboarding-preview__window">
        <div className="onboarding-preview__top">
          <span>Prévia ilustrativa</span>
          <span className="onboarding-preview__status">
            <i /> Sem dados reais
          </span>
        </div>
        <div className="onboarding-preview__body">
          {step === 0 && (
            <section className="onboarding-preview__state">
              <p>VISÃO GERAL</p>
              <h2>Seu mês, sem ruído.</h2>
              <div className="onboarding-preview__metrics">
                {["Receitas", "Despesas", "Orçamento", "Saldo do mês"].map((label) => (
                  <article key={label}>
                    <small>{label}</small>
                    <strong>—</strong>
                    <span>Disponível quando você adicionar dados</span>
                  </article>
                ))}
              </div>
              <article className="onboarding-preview__chart">
                <div>
                  <strong>Fluxo de caixa</strong>
                  <span>Exemplo visual</span>
                </div>
                <div className="onboarding-preview__bars">
                  {[42, 58, 49, 70, 63, 82].map((height, index) => (
                    <i key={height} className={index === 5 ? "is-highlighted" : ""} style={{ height: `${height}%` }} />
                  ))}
                </div>
              </article>
            </section>
          )}
          {step === 1 && (
            <section className="onboarding-preview__state">
              <p>SEU PLANO INICIAL</p>
              <h2>
                {draft.displayName.trim()
                  ? `${draft.displayName.trim().split(/\s+/)[0]}, clareza para o que importa.`
                  : "Uma meta que cabe no seu mês."}
              </h2>
              <article className="onboarding-preview__goal">
                <small>OBJETIVO</small>
                <h3>{goalLabel}</h3>
                <div>
                  <strong>
                    {draft.monthlyTargetInCents && draft.monthlyTargetInCents > 0
                      ? money(draft.monthlyTargetInCents)
                      : "Valor opcional"}
                  </strong>
                  <span>{draft.monthlyTargetInCents ? "por mês" : "defina quando quiser"}</span>
                </div>
                <div className="onboarding-preview__track">
                  <i />
                </div>
                <div className="onboarding-preview__months">
                  <span>Mês 1</span>
                  <span>Mês 2</span>
                  <span>Mês 3</span>
                </div>
              </article>
              <article className="onboarding-preview__context">
                <strong>Contexto, não recomendações prontas</strong>
                <span>Você ajusta categorias, orçamento e metas depois.</span>
              </article>
            </section>
          )}
          {step === 2 && (
            <section className="onboarding-preview__state">
              <p>PRIMEIRO MOVIMENTO</p>
              <h2>{previewHeading}</h2>
              <article className="onboarding-preview__import">
                <div className="onboarding-preview__file">
                  <FileCheck2 size={19} />
                  <span>
                    <strong>{startLabel}</strong>
                    <small>Nenhuma ação foi iniciada</small>
                  </span>
                  <b>Você decide</b>
                </div>
                {[
                  ["1", "Escolha o que deseja adicionar"],
                  ["2", "Confira a prévia e possíveis duplicatas"],
                  ["3", "Confirme somente quando estiver pronto"],
                ].map(([number, label]) => (
                  <div className="onboarding-preview__workflow" key={number}>
                    <span>{number}</span>
                    <strong>{label}</strong>
                  </div>
                ))}
              </article>
            </section>
          )}
          {step === 3 && (
            <section className="onboarding-preview__state">
              <p>PRIVACIDADE POR ARQUITETURA</p>
              <h2>Útil sem tirar seus dados financeiros do computador.</h2>
              <article className="onboarding-preview__local">
                <div className="onboarding-preview__database">
                  <Database size={25} />
                </div>
                <small>SQLITE LOCAL</small>
                <h3>Seus dados permanecem com você</h3>
                <span>Contas, categorias, regras e relatórios ficam sob o controle do seu sistema.</span>
              </article>
            </section>
          )}
        </div>
      </div>
    </aside>
  );
}

export function Onboarding({ onFinished }: { onFinished: (destination: string) => Promise<void> }) {
  const [step, setStep] = useState<Step>(0);
  const [draft, setDraft] = useState<OnboardingDraft>({
    displayName: "",
    financialGoal: "organize",
    monthlyTargetInCents: null,
    onboardingStartMode: "import",
  });
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const errorRef = useRef<HTMLParagraphElement>(null);

  useLayoutEffect(() => {
    const root = document.documentElement;
    const previousSurface = root.dataset.appSurface;
    const previousTheme = root.dataset.onboardingTheme;
    const previousResolvedTheme = root.dataset.theme;
    root.dataset.appSurface = "onboarding";
    root.dataset.onboardingTheme = "dark";
    root.dataset.theme = "dark";
    return () => {
      if (previousSurface === undefined) delete root.dataset.appSurface;
      else root.dataset.appSurface = previousSurface;
      if (previousTheme === undefined) delete root.dataset.onboardingTheme;
      else root.dataset.onboardingTheme = previousTheme;
      if (previousResolvedTheme === undefined) delete root.dataset.theme;
      else root.dataset.theme = previousResolvedTheme;
    };
  }, []);

  useEffect(() => {
    headingRef.current?.focus({ preventScroll: true });
  }, [step]);

  useEffect(() => {
    if (error) errorRef.current?.focus({ preventScroll: true });
  }, [error]);

  function updateDraft(update: Partial<OnboardingDraft>) {
    setDraft((current) => ({ ...current, ...update }));
    setError("");
  }

  function validateProfileStep() {
    const nameLength = Array.from(draft.displayName.trim()).length;
    if (nameLength < 2 || nameLength > 80) {
      setError("Informe um nome com 2 a 80 caracteres.");
      requestAnimationFrame(() => document.getElementById("onboarding-name")?.focus());
      return false;
    }
    if (draft.monthlyTargetInCents !== null && draft.monthlyTargetInCents <= 0) {
      setError("Informe um valor mensal maior que zero ou deixe o campo em branco.");
      requestAnimationFrame(() => document.getElementById("onboarding-monthly-target")?.focus());
      return false;
    }
    return true;
  }

  function goForward() {
    if (step === 1 && !validateProfileStep()) return;
    setError("");
    setStep((current) => Math.min(current + 1, 3) as Step);
  }

  function goBack() {
    setError("");
    setStep((current) => Math.max(current - 1, 0) as Step);
  }

  async function finish() {
    if (!validateProfileStep() || saving) return;
    setSaving(true);
    setError("");
    try {
      await api.completeOnboarding({
        displayName: draft.displayName.trim(),
        financialGoal: draft.financialGoal,
        monthlyTargetInCents: draft.monthlyTargetInCents ?? undefined,
        onboardingStartMode: draft.onboardingStartMode,
      });
      if (draft.onboardingStartMode === "import") {
        restartImportGuide();
        await onFinished("/import?action=choose");
      } else if (draft.onboardingStartMode === "tour") {
        restartQuickStartGuide();
        await onFinished("/import");
      } else {
        await onFinished("/accounts");
      }
    } catch (cause) {
      setError(
        typeof cause === "object" && cause && "message" in cause
          ? String((cause as { message: unknown }).message)
          : String(cause),
      );
    } finally {
      setSaving(false);
    }
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (step < 3) goForward();
    else void finish();
  }

  const actionLabel = step === 0 ? "Começar" : step === 3 ? (saving ? "Salvando…" : "Abrir o Lumen") : "Continuar";

  return (
    <div className="onboarding-shell">
      <div className="onboarding-workspace">
        <form className="onboarding-panel" onSubmit={handleSubmit} aria-busy={saving || undefined}>
          <header className="onboarding-progress">
            <div className="onboarding-progress__meta">
              <span>
                <strong>{stepMeta[step].label}</strong> · {step + 1} de 4
              </span>
              <span className="onboarding-local-label">
                <LockKeyhole size={13} aria-hidden="true" /> Configuração local
              </span>
            </div>
            <div
              className="onboarding-progress__track"
              role="progressbar"
              aria-label={`Etapa ${step + 1} de 4: ${stepMeta[step].label}`}
              aria-valuemin={1}
              aria-valuemax={4}
              aria-valuenow={step + 1}
            >
              {stepMeta.map((item, index) => (
                <i key={item.label} className={index <= step ? "is-active" : ""} />
              ))}
            </div>
            <span className="onboarding-sr-only" aria-live="polite">
              Etapa {step + 1} de 4: {stepMeta[step].label}
            </span>
          </header>

          <div className="onboarding-step">
            {step === 0 && (
              <section>
                <div className="onboarding-step__icon" aria-hidden="true">
                  <Sparkles size={21} />
                </div>
                <p className="onboarding-overline">{stepMeta[step].eyebrow}</p>
                <h1 ref={headingRef} tabIndex={-1}>
                  Seu dinheiro, mais claro.
                </h1>
                <p className="onboarding-lead">
                  Organize contas, cartões, orçamento e relatórios no seu computador — sem conectar o banco, sem login
                  obrigatório e sem enviar seus extratos para a nuvem.
                </p>
                <div className="onboarding-benefits">
                  <article>
                    <FileCheck2 size={19} aria-hidden="true" />
                    <strong>Importe com calma</strong>
                    <span>Revise CSV, OFX, PDF textual e faturas antes de confirmar.</span>
                  </article>
                  <article>
                    <BarChart3 size={19} aria-hidden="true" />
                    <strong>Veja o contexto</strong>
                    <span>Orçamento, fluxo de caixa e relatórios juntos.</span>
                  </article>
                  <article>
                    <ShieldCheck size={19} aria-hidden="true" />
                    <strong>Continue no controle</strong>
                    <span>Seus dados financeiros permanecem neste computador.</span>
                  </article>
                </div>
                <p className="onboarding-privacy-line">
                  <LockKeyhole size={15} aria-hidden="true" /> Esta configuração é salva apenas no dispositivo.
                </p>
              </section>
            )}

            {step === 1 && (
              <section>
                <div className="onboarding-step__icon" aria-hidden="true">
                  <Target size={21} />
                </div>
                <p className="onboarding-overline">{stepMeta[step].eyebrow}</p>
                <h1 ref={headingRef} tabIndex={-1}>
                  O que você quer tornar mais claro primeiro?
                </h1>
                <p className="onboarding-lead">
                  Isso personaliza o contexto inicial. Você poderá ajustar essas escolhas quando quiser.
                </p>
                <fieldset className="onboarding-choice-grid">
                  <legend className="onboarding-sr-only">Objetivo principal</legend>
                  {goalOptions.map((option) => (
                    <ChoiceCard
                      key={option.value}
                      {...option}
                      name="financial-goal"
                      checked={draft.financialGoal === option.value}
                      onChange={(financialGoal) => updateDraft({ financialGoal })}
                    />
                  ))}
                </fieldset>
                <div className="onboarding-fields">
                  <label>
                    <span>
                      Quanto quer separar por mês? <small>Opcional</small>
                    </span>
                    <MoneyInput
                      id="onboarding-monthly-target"
                      defaultCents={draft.monthlyTargetInCents ?? 0}
                      aria-describedby={error ? "onboarding-error" : undefined}
                      onChange={(monthlyTargetInCents) => updateDraft({ monthlyTargetInCents })}
                    />
                  </label>
                  <label>
                    Como o Lumen pode chamar você?
                    <input
                      id="onboarding-name"
                      autoComplete="name"
                      value={draft.displayName}
                      aria-invalid={error && draft.displayName.trim().length < 2 ? true : undefined}
                      aria-describedby={error ? "onboarding-error" : undefined}
                      placeholder="Seu nome"
                      onChange={(event) => updateDraft({ displayName: event.target.value })}
                    />
                  </label>
                </div>
              </section>
            )}

            {step === 2 && (
              <section>
                <div className="onboarding-step__icon" aria-hidden="true">
                  <Compass size={21} />
                </div>
                <p className="onboarding-overline">{stepMeta[step].eyebrow}</p>
                <h1 ref={headingRef} tabIndex={-1}>
                  Como você prefere começar?
                </h1>
                <p className="onboarding-lead">
                  O Lumen trabalha somente com os arquivos e lançamentos que você escolher.
                </p>
                <fieldset className="onboarding-start-options">
                  <legend className="onboarding-sr-only">Forma de começar</legend>
                  {startOptions.map((option) => (
                    <ChoiceCard
                      key={option.value}
                      {...option}
                      name="onboarding-start"
                      checked={draft.onboardingStartMode === option.value}
                      onChange={(onboardingStartMode) => updateDraft({ onboardingStartMode })}
                    />
                  ))}
                </fieldset>
                <div className="onboarding-formats" aria-label="Formatos aceitos">
                  <span>CSV</span>
                  <span>OFX</span>
                  <span>PDF textual</span>
                  <span>Faturas</span>
                </div>
                <p className="onboarding-no-write">
                  <LockKeyhole size={15} aria-hidden="true" /> Nenhuma importação ou movimentação será criada agora.
                </p>
              </section>
            )}

            {step === 3 && (
              <section>
                <div className="onboarding-step__icon" aria-hidden="true">
                  <Check size={21} />
                </div>
                <p className="onboarding-overline">{stepMeta[step].eyebrow}</p>
                <h1 ref={headingRef} tabIndex={-1}>
                  Seu espaço financeiro começa sob o seu controle.
                </h1>
                <p className="onboarding-lead">
                  Confira as escolhas. O Lumen não exige login, não conecta seu banco e não força sincronização com a
                  nuvem.
                </p>
                <div className="onboarding-review">
                  <div>
                    <Target size={18} aria-hidden="true" />
                    <span>
                      <strong>Objetivo principal</strong>
                      <small>{optionLabel(goalOptions, draft.financialGoal)}</small>
                    </span>
                    <b>
                      {draft.monthlyTargetInCents && draft.monthlyTargetInCents > 0
                        ? `${money(draft.monthlyTargetInCents)}/mês`
                        : "Sem valor definido"}
                    </b>
                  </div>
                  <div>
                    <UserRound size={18} aria-hidden="true" />
                    <span>
                      <strong>Seu perfil</strong>
                      <small>{draft.displayName.trim()}</small>
                    </span>
                    <b>Local</b>
                  </div>
                  <div>
                    <FileUp size={18} aria-hidden="true" />
                    <span>
                      <strong>Primeiro passo</strong>
                      <small>{optionLabel(startOptions, draft.onboardingStartMode)}</small>
                    </span>
                    <b>Você decide</b>
                  </div>
                  <div>
                    <Database size={18} aria-hidden="true" />
                    <span>
                      <strong>Armazenamento</strong>
                      <small>SQLite neste computador</small>
                    </span>
                    <b>Local</b>
                  </div>
                  <div>
                    <CloudOff size={18} aria-hidden="true" />
                    <span>
                      <strong>Login e sincronização</strong>
                      <small>Sem conta obrigatória ou sincronização forçada</small>
                    </span>
                    <b>Desativados</b>
                  </div>
                </div>
              </section>
            )}
          </div>

          {error && (
            <p ref={errorRef} id="onboarding-error" className="onboarding-error" role="alert" tabIndex={-1}>
              {error}
            </p>
          )}

          <footer className="onboarding-actions">
            <span>
              {step === 3
                ? "Nada foi importado ou enviado para fora deste computador."
                : "Nome, objetivo e valor poderão ser ajustados nas Configurações."}
            </span>
            <div>
              <button className="secondary" type="button" onClick={goBack} disabled={step === 0 || saving}>
                <ArrowLeft size={16} aria-hidden="true" /> Voltar
              </button>
              <button type="submit" disabled={saving}>
                {actionLabel} <ArrowRight size={16} aria-hidden="true" />
              </button>
            </div>
          </footer>
        </form>
        <Preview step={step} draft={draft} />
      </div>
    </div>
  );
}
