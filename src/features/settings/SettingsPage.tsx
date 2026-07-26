import { useEffect, useRef, useState, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate, useSearchParams } from "react-router-dom";
import { openUrl } from "@tauri-apps/plugin-opener";
import {
  AlertTriangle,
  BookOpen,
  Check,
  ChevronDown,
  Database,
  Download,
  ExternalLink,
  FileDown,
  FileUp,
  HardDrive,
  Info,
  Keyboard,
  Minus,
  Palette,
  Plus,
  RefreshCw,
  RotateCcw,
  Save,
  ShieldCheck,
  Trash2,
  UserRound,
} from "lucide-react";
import { api } from "../../shared/api";
import { useBackupReminder } from "../../shared/backupReminder";
import {
  createDatabaseBackup,
  chooseBackupToRestore,
  exportTransactions,
  prepareDatabaseReset,
  prepareDatabaseRestore,
  type ExportFormat,
} from "./desktopDataOperations";
import { incomeDayOptions, incomeDaySelection, parseIncomeDaySelection } from "../../shared/incomeDay";
import { useUiPreferences, type EditableUiPreferences } from "../../shared/uiPreferences";
import {
  canCheckForUpdates,
  checkLumenUpdate,
  clearDismissedUpdate,
  isTauriRuntime,
  requestUpdateNoticeRefresh,
} from "../../shared/updater";
import { APP_VERSION } from "../../shared/version";
import type { FinancialGoal, UserProfile } from "../../shared/types";
import { ErrorState, LoadingState } from "../../shared/ui/AsyncState";
import { MoneyInput } from "../../shared/ui/MoneyInput";
import { OverlayDialog } from "../../shared/ui/OverlayDialog";
import { PageHeader } from "../../shared/ui/PageHeader";
import { Select } from "../../shared/ui/Select";
import { useToast } from "../../shared/ui/toast";
import { parseSettingsSection, settingsSections, type SettingsSection } from "./settingsNavigation";
import { useMaintenanceRestart } from "../../shared/maintenanceRestart";
import { restartImportGuide, restartQuickStartGuide } from "../../shared/quickStartGuide";

const RESET_CONFIRM_WORD = "APAGAR";
const RESTORE_CONFIRM_WORD = "RESTAURAR";
const LUMEN_GITHUB_URL = "https://github.com/filipeclacerda/lumen";

type ProfileDraft = {
  name: string;
  incomeInCents: number | null;
  targetInCents: number | null;
  day: string;
  goal?: FinancialGoal;
};
type ActiveOperation = "export" | "backup" | "restore" | "reset" | null;

const goalLabels: Record<FinancialGoal, string> = {
  organize: "Organizar minhas finanças",
  emergency_fund: "Criar reserva de emergência",
  pay_debt: "Quitar dívidas",
  save: "Planejar um objetivo",
  invest: "Investir mais",
};

const exportFormats = [
  { value: "csv", label: "CSV completo" },
  { value: "ofx", label: "OFX de movimentações" },
  { value: "pdf", label: "Relatório resumido em PDF" },
] as const;

function draftFromProfile(profile: UserProfile): ProfileDraft {
  return {
    name: profile.displayName,
    incomeInCents: profile.monthlyIncomeInCents ?? null,
    targetInCents: profile.monthlyTargetInCents ?? null,
    day: incomeDaySelection(profile.incomeDay ?? undefined, profile.incomeDayRule ?? undefined),
    goal: profile.financialGoal ?? undefined,
  };
}

function sameProfileDraft(a: ProfileDraft | null, b: ProfileDraft | null) {
  return (
    !!a &&
    !!b &&
    a.name === b.name &&
    a.incomeInCents === b.incomeInCents &&
    a.targetInCents === b.targetInCents &&
    a.day === b.day &&
    a.goal === b.goal
  );
}

function samePreferences(a: EditableUiPreferences, b: EditableUiPreferences) {
  return a.themePreference === b.themePreference && a.zoom === b.zoom && a.sidebar === b.sidebar;
}

function formatBackupDate(value: string | null) {
  if (!value) return "Ainda não há um backup registrado neste dispositivo.";
  return new Intl.DateTimeFormat("pt-BR", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
}

function settingsSectionHeading(section: SettingsSection) {
  return settingsSections.find((item) => item.id === section)?.label ?? "Geral";
}

export function SettingsPage() {
  const client = useQueryClient();
  const toast = useToast();
  const [searchParams, setSearchParams] = useSearchParams();
  const section = parseSettingsSection(searchParams.get("section"));
  const desktopRuntime = isTauriRuntime();
  const updatesEnabled = canCheckForUpdates();
  const themePreference = useUiPreferences((state) => state.themePreference);
  const zoom = useUiPreferences((state) => state.zoom);
  const sidebar = useUiPreferences((state) => state.sidebar);
  const uiPreferences: EditableUiPreferences = { themePreference, zoom, sidebar };
  const applyPreferences = useUiPreferences((state) => state.applyPreferences);
  const reminder = useBackupReminder((state) => state.reminder);
  const initializeBackupReminder = useBackupReminder((state) => state.initialize);
  const setReminderDays = useBackupReminder((state) => state.setReminderDays);
  const resetBackupReminderForFreshDataset = useBackupReminder((state) => state.resetForFreshDataset);
  const requireMaintenanceRestart = useMaintenanceRestart((state) => state.requireRestart);
  const {
    data: profile,
    isLoading: profileLoading,
    isError: profileError,
    refetch: refetchProfile,
  } = useQuery({ queryKey: ["profile"], queryFn: api.profile });
  const [profileBase, setProfileBase] = useState<ProfileDraft | null>(null);
  const [profileDraft, setProfileDraft] = useState<ProfileDraft | null>(null);
  const [incomeInputVersion, setIncomeInputVersion] = useState(0);
  const [profileSaving, setProfileSaving] = useState(false);
  const [appearanceBase, setAppearanceBase] = useState<EditableUiPreferences>(uiPreferences);
  const [appearanceDraft, setAppearanceDraft] = useState<EditableUiPreferences>(uiPreferences);
  const [appearanceSaving, setAppearanceSaving] = useState(false);
  const [exportFormat, setExportFormat] = useState<ExportFormat>("csv");
  const [activeOperation, setActiveOperation] = useState<ActiveOperation>(null);
  const [restoreCandidate, setRestoreCandidate] = useState<{ path: string; fileName: string }>();
  const [restoreConfirmText, setRestoreConfirmText] = useState("");
  const [resetOpen, setResetOpen] = useState(false);
  const [resetConfirmText, setResetConfirmText] = useState("");
  const [backupBeforeReset, setBackupBeforeReset] = useState(true);
  const [checkingUpdate, setCheckingUpdate] = useState(false);
  const [reminderBaseDays, setReminderBaseDays] = useState<7 | 14 | 30 | null>(14);
  const [reminderDraftDays, setReminderDraftDays] = useState<7 | 14 | 30 | null>(14);
  const sectionHeadingRef = useRef<HTMLHeadingElement>(null);
  const previousSectionRef = useRef<SettingsSection | undefined>(undefined);

  const profileDirty = profileBase !== null && !sameProfileDraft(profileDraft, profileBase);
  const appearanceDirty = !samePreferences(appearanceDraft, appearanceBase);
  const trimmedNameLength = Array.from(profileDraft?.name.trim() ?? "").length;
  const nameError =
    profileDraft && (trimmedNameLength < 2 || trimmedNameLength > 80) ? "O nome deve ter entre 2 e 80 caracteres." : "";
  const incomeError =
    profileDraft?.incomeInCents !== null && (profileDraft?.incomeInCents ?? 0) < 0
      ? "A renda mensal não pode ser negativa."
      : "";
  const targetError =
    profileDraft?.targetInCents !== null && (profileDraft?.targetInCents ?? 0) <= 0
      ? "O valor mensal deve ser maior que zero ou ficar em branco."
      : "";
  const reminderDirty = reminderDraftDays !== reminderBaseDays;
  const operationInProgress = activeOperation !== null;

  useEffect(() => {
    if (!profile) return;
    const next = draftFromProfile(profile);
    if (!profileBase || sameProfileDraft(profileDraft, profileBase)) {
      setProfileBase(next);
      setProfileDraft(next);
      setIncomeInputVersion((version) => version + 1);
    }
    // Incoming query data must never overwrite an unsaved local form.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile]);

  useEffect(() => {
    if (!appearanceDirty) {
      setAppearanceBase(uiPreferences);
      setAppearanceDraft(uiPreferences);
    }
    // The sidebar quick action is allowed to refresh a clean form only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uiPreferences.themePreference, uiPreferences.zoom, uiPreferences.sidebar]);

  useEffect(() => {
    if (desktopRuntime) initializeBackupReminder();
  }, [desktopRuntime, initializeBackupReminder]);

  useEffect(() => {
    const current = reminder?.reminderDays ?? 14;
    if (!reminderDirty) {
      setReminderBaseDays(current);
      setReminderDraftDays(current);
    }
    // Preserve an unsaved reminder choice when the store changes elsewhere.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reminder?.reminderDays]);

  useEffect(() => {
    if (previousSectionRef.current && previousSectionRef.current !== section) sectionHeadingRef.current?.focus();
    previousSectionRef.current = section;
  }, [section]);

  function goToSection(next: SettingsSection) {
    setSearchParams(
      (current) => {
        const params = new URLSearchParams(current);
        params.set("section", next);
        return params;
      },
      { replace: false },
    );
  }

  async function saveProfile() {
    if (!profileDraft || !profileDirty || nameError || incomeError || targetError) return;
    setProfileSaving(true);
    try {
      const saved = await api.saveProfile({
        displayName: profileDraft.name.trim(),
        monthlyIncomeInCents: profileDraft.incomeInCents ?? undefined,
        monthlyTargetInCents: profileDraft.targetInCents ?? undefined,
        ...parseIncomeDaySelection(profileDraft.day),
        financialGoal: profileDraft.goal,
      });
      const next = draftFromProfile(saved);
      setProfileBase(next);
      setProfileDraft(next);
      setIncomeInputVersion((version) => version + 1);
      await Promise.all([
        client.invalidateQueries({ queryKey: ["profile"] }),
        client.invalidateQueries({ queryKey: ["bootstrap"] }),
      ]);
      toast("Perfil atualizado.");
    } catch (error) {
      toast((error as { message?: string })?.message ?? "Não foi possível salvar o perfil.", "error");
    } finally {
      setProfileSaving(false);
    }
  }

  async function saveAppearance() {
    if (!appearanceDirty) return;
    setAppearanceSaving(true);
    try {
      applyPreferences(appearanceDraft);
      setAppearanceBase(appearanceDraft);
      toast("Preferências visuais atualizadas.");
    } finally {
      setAppearanceSaving(false);
    }
  }

  async function exportData() {
    if (!desktopRuntime || operationInProgress) return;
    setActiveOperation("export");
    try {
      const result = await exportTransactions(exportFormat);
      if (result.status === "cancelled") return;
      toast(
        exportFormat === "pdf"
          ? `Relatório criado com ${result.value} transações consideradas; o PDF lista até 120.`
          : `${result.value} transações exportadas em ${exportFormat.toUpperCase()}.`,
      );
    } catch (error) {
      toast((error as { message?: string })?.message ?? "Falha na exportação.", "error");
    } finally {
      setActiveOperation(null);
    }
  }

  async function backupData() {
    if (!desktopRuntime || operationInProgress) return false;
    setActiveOperation("backup");
    try {
      const result = await createDatabaseBackup();
      if (result.status === "cancelled") return false;
      toast("Backup salvo com sucesso!");
      if (!result.value.reminderRecorded)
        toast("O backup foi concluído, mas o lembrete não pôde ser salvo neste dispositivo.", "error");
      return true;
    } catch (error) {
      toast((error as { message?: string })?.message ?? "Falha ao gerar o backup.", "error");
      return false;
    } finally {
      setActiveOperation(null);
    }
  }

  async function chooseRestore() {
    if (!desktopRuntime || operationInProgress) return;
    setActiveOperation("restore");
    try {
      const result = await chooseBackupToRestore();
      if (result.status === "cancelled") return;
      setRestoreCandidate(result.value);
      setRestoreConfirmText("");
    } catch (error) {
      toast((error as { message?: string })?.message ?? "Falha ao escolher o backup.", "error");
    } finally {
      setActiveOperation(null);
    }
  }

  function closeRestore() {
    if (activeOperation === "restore") return;
    setRestoreCandidate(undefined);
    setRestoreConfirmText("");
  }

  async function confirmRestore() {
    if (!restoreCandidate || restoreConfirmText !== RESTORE_CONFIRM_WORD || operationInProgress) return;
    setActiveOperation("restore");
    try {
      await prepareDatabaseRestore(restoreCandidate.path);
      toast("Backup validado e preparado. Será aplicado na próxima abertura do Lumen.");
      setRestoreCandidate(undefined);
      setRestoreConfirmText("");
      requireMaintenanceRestart("restore");
    } catch (error) {
      toast(
        (error as { message?: string })?.message ?? "O backup é inválido e seus dados atuais não foram alterados.",
        "error",
      );
    } finally {
      setActiveOperation(null);
    }
  }

  function closeReset() {
    if (activeOperation) return;
    setResetOpen(false);
    setResetConfirmText("");
    setBackupBeforeReset(true);
  }

  async function resetAllData() {
    if (resetConfirmText !== RESET_CONFIRM_WORD || operationInProgress) return;
    if (backupBeforeReset) {
      const backedUp = await backupData();
      if (!backedUp) return;
    }
    setActiveOperation("reset");
    try {
      await prepareDatabaseReset();
      resetBackupReminderForFreshDataset();
      toast("Limpeza preparada. Reiniciando o Lumen…");
      setResetOpen(false);
      requireMaintenanceRestart("reset");
    } catch (error) {
      toast((error as { message?: string })?.message ?? "Não foi possível apagar os dados.", "error");
    } finally {
      setActiveOperation(null);
    }
  }

  async function checkForUpdates() {
    if (!updatesEnabled) return;
    setCheckingUpdate(true);
    try {
      const update = await checkLumenUpdate();
      if (!update) {
        toast("Você já está usando a versão mais recente.");
        return;
      }
      clearDismissedUpdate(update.latestVersion);
      requestUpdateNoticeRefresh();
      toast(`Lumen ${update.latestVersion} disponível. O aviso apareceu no topo da tela.`);
    } catch (error) {
      toast((error as { message?: string })?.message ?? "Não foi possível checar atualizações.", "error");
    } finally {
      setCheckingUpdate(false);
    }
  }

  let sectionContent: ReactNode;
  if (section === "general")
    sectionContent = (
      <GeneralSection
        profile={profileDraft}
        profileDirty={profileDirty}
        saving={profileSaving}
        nameError={nameError}
        incomeInputVersion={incomeInputVersion}
        incomeError={incomeError}
        targetError={targetError}
        backupDate={formatBackupDate(reminder?.lastSuccessfulAt ?? null)}
        onNavigate={goToSection}
        onChange={setProfileDraft}
        onDiscard={() => {
          if (!profileBase) return;
          setProfileDraft(profileBase);
          setIncomeInputVersion((version) => version + 1);
        }}
        onSave={() => void saveProfile()}
      />
    );
  else if (section === "appearance")
    sectionContent = (
      <AppearanceSection
        draft={appearanceDraft}
        dirty={appearanceDirty}
        saving={appearanceSaving}
        onChange={setAppearanceDraft}
        onDiscard={() => setAppearanceDraft(appearanceBase)}
        onSave={() => void saveAppearance()}
      />
    );
  else if (section === "data")
    sectionContent = (
      <DataSection
        desktopRuntime={desktopRuntime}
        exportFormat={exportFormat}
        activeOperation={activeOperation}
        lastBackupAt={reminder?.lastSuccessfulAt ?? null}
        reminderDraftDays={reminderDraftDays}
        reminderDirty={reminderDirty}
        onFormatChange={(value) => setExportFormat(value as ExportFormat)}
        onExport={() => void exportData()}
        onBackup={() => void backupData()}
        onRestore={() => void chooseRestore()}
        onReminderDaysChange={(value) => setReminderDraftDays(value === "off" ? null : (Number(value) as 7 | 14 | 30))}
        onReminderDiscard={() => setReminderDraftDays(reminderBaseDays)}
        onReminderSave={() => {
          setReminderDays(reminderDraftDays);
          setReminderBaseDays(reminderDraftDays);
          toast("Lembrete de backup atualizado.");
        }}
      />
    );
  else if (section === "privacy") sectionContent = <PrivacySection />;
  else if (section === "about")
    sectionContent = (
      <AboutSection
        updatesEnabled={updatesEnabled}
        checkingUpdate={checkingUpdate}
        onCheckUpdates={() => void checkForUpdates()}
      />
    );
  else
    sectionContent = (
      <DangerSection
        desktopRuntime={desktopRuntime}
        disabled={operationInProgress}
        onReset={() => setResetOpen(true)}
      />
    );

  if (profileError)
    return (
      <ErrorState
        variant="page"
        message="Não foi possível carregar suas configurações."
        onRetry={() => void refetchProfile()}
      />
    );

  return (
    <section className="settings-page" data-tutorial="settings">
      <PageHeader
        eyebrow="PREFERÊNCIAS"
        title="Configurações"
        description="Personalize sua experiência e mantenha seus dados protegidos."
      />
      {profileLoading && <LoadingState variant="panel" label="Carregando configurações…" />}
      <div className="settings-layout">
        <SettingsNavigation section={section} onChange={goToSection} />
        <div className="settings-content" aria-live="polite">
          <h2 ref={sectionHeadingRef} className="sr-only" tabIndex={-1}>
            {settingsSectionHeading(section)}
          </h2>
          {sectionContent}
        </div>
      </div>
      {restoreCandidate && (
        <OverlayDialog
          title="Restaurar backup e substituir dados?"
          description="Esta ação substitui contas, transações, categorias, configurações e faturas atuais. O arquivo é validado antes da troca e o Lumen reinicia."
          onClose={closeRestore}
          dismissible={activeOperation !== "restore"}
        >
          <div className="settings-dialog">
            <p className="settings-dialog__file">
              <HardDrive size={16} aria-hidden="true" /> {restoreCandidate.fileName}
            </p>
            <label>
              Digite {RESTORE_CONFIRM_WORD} para confirmar
              <input
                value={restoreConfirmText}
                onChange={(event) => setRestoreConfirmText(event.target.value)}
                autoFocus
              />
            </label>
            <div className="editor-actions">
              <button className="secondary" onClick={closeRestore} disabled={activeOperation === "restore"}>
                Cancelar
              </button>
              <button
                className="danger"
                onClick={() => void confirmRestore()}
                disabled={operationInProgress || restoreConfirmText !== RESTORE_CONFIRM_WORD}
              >
                <RotateCcw size={15} /> {activeOperation === "restore" ? "Preparando…" : "Restaurar backup"}
              </button>
            </div>
          </div>
        </OverlayDialog>
      )}
      {resetOpen && (
        <OverlayDialog title="Apagar dados financeiros?" onClose={closeReset} dismissible={activeOperation === null}>
          <div className="settings-dialog">
            <p className="muted">
              Essa ação não pode ser desfeita. Tema, zoom e preferências deste dispositivo permanecem.
            </p>
            <label className="settings-check-label">
              <input
                type="checkbox"
                checked={backupBeforeReset}
                onChange={(event) => setBackupBeforeReset(event.target.checked)}
                disabled={operationInProgress}
              />
              Fazer backup antes de apagar
            </label>
            <label>
              Digite {RESET_CONFIRM_WORD} para confirmar
              <input value={resetConfirmText} onChange={(event) => setResetConfirmText(event.target.value)} autoFocus />
            </label>
            <div className="editor-actions">
              <button className="secondary" onClick={closeReset} disabled={operationInProgress}>
                Cancelar
              </button>
              <button
                className="danger"
                onClick={() => void resetAllData()}
                disabled={operationInProgress || resetConfirmText !== RESET_CONFIRM_WORD}
              >
                <Trash2 size={15} />{" "}
                {activeOperation === "backup"
                  ? "Fazendo backup…"
                  : activeOperation === "reset"
                    ? "Preparando limpeza…"
                    : "Apagar dados financeiros"}
              </button>
            </div>
          </div>
        </OverlayDialog>
      )}
    </section>
  );
}

function SettingsNavigation({
  section,
  onChange,
}: {
  section: SettingsSection;
  onChange: (section: SettingsSection) => void;
}) {
  return (
    <>
      <nav className="settings-nav" aria-label="Seções de configurações">
        {settingsSections.map(({ id, label, description, icon: Icon }) => (
          <button
            type="button"
            className={id === section ? "is-active" : ""}
            aria-current={id === section ? "page" : undefined}
            key={id}
            onClick={() => onChange(id)}
          >
            <Icon size={18} aria-hidden="true" />
            <span>
              <strong>{label}</strong>
              <small>{description}</small>
            </span>
          </button>
        ))}
      </nav>
      <div className="settings-nav-select">
        <label htmlFor="settings-section-select">Seção</label>
        <Select
          id="settings-section-select"
          ariaLabel="Ir para seção"
          value={section}
          onChange={(value) => onChange(value as SettingsSection)}
          options={settingsSections.map(({ id, label }) => ({ value: id, label }))}
        />
      </div>
    </>
  );
}

function GeneralSection({
  profile,
  profileDirty,
  saving,
  nameError,
  incomeInputVersion,
  incomeError,
  targetError,
  backupDate,
  onNavigate,
  onChange,
  onDiscard,
  onSave,
}: {
  profile: ProfileDraft | null;
  profileDirty: boolean;
  saving: boolean;
  nameError: string;
  incomeInputVersion: number;
  incomeError: string;
  targetError: string;
  backupDate: string;
  onNavigate: (section: SettingsSection) => void;
  onChange: (next: ProfileDraft | null) => void;
  onDiscard: () => void;
  onSave: () => void;
}) {
  return (
    <div className="settings-section">
      <div className="settings-summary-grid">
        <button type="button" className="settings-summary-card" onClick={() => onNavigate("data")}>
          <Database size={19} aria-hidden="true" />
          <span>
            <strong>Backup local</strong>
            <small>{backupDate}</small>
          </span>
          <ChevronDown size={16} aria-hidden="true" />
        </button>
        <button type="button" className="settings-summary-card" onClick={() => onNavigate("privacy")}>
          <ShieldCheck size={19} aria-hidden="true" />
          <span>
            <strong>Privacidade local</strong>
            <small>Dados processados localmente</small>
          </span>
          <ChevronDown size={16} aria-hidden="true" />
        </button>
        <button type="button" className="settings-summary-card" onClick={() => onNavigate("about")}>
          <Info size={19} aria-hidden="true" />
          <span>
            <strong>Lumen v{APP_VERSION}</strong>
            <small>Atalhos, licença e atualizações</small>
          </span>
          <ChevronDown size={16} aria-hidden="true" />
        </button>
      </div>
      <article className="panel settings-panel">
        <div className="panel-title">
          <h2>
            <UserRound size={18} /> Perfil financeiro
          </h2>
        </div>
        <p className="muted">Essas informações ajudam o Lumen a contextualizar seu planejamento.</p>
        <div className="settings-form">
          <label>
            Nome
            <input
              value={profile?.name ?? ""}
              aria-invalid={nameError ? true : undefined}
              aria-describedby={nameError ? "settings-name-error" : undefined}
              onChange={(event) => profile && onChange({ ...profile, name: event.target.value })}
            />
          </label>
          {nameError && (
            <small id="settings-name-error" className="form-error" role="alert">
              {nameError}
            </small>
          )}
          <div className="form-row">
            <label>
              Renda líquida mensal
              <MoneyInput
                key={incomeInputVersion}
                defaultCents={profile?.incomeInCents ?? 0}
                onChange={(incomeInCents) => profile && onChange({ ...profile, incomeInCents })}
              />
            </label>
            {incomeError && (
              <small className="form-error" role="alert">
                {incomeError}
              </small>
            )}
            <label>
              Dia de recebimento
              <Select
                value={profile?.day ?? ""}
                onChange={(day) => profile && onChange({ ...profile, day })}
                options={incomeDayOptions}
              />
            </label>
          </div>
          <div className="form-row">
            <label>
              Objetivo principal
              <Select
                value={profile?.goal ?? ""}
                onChange={(value) =>
                  profile && onChange({ ...profile, goal: (value || undefined) as FinancialGoal | undefined })
                }
                options={[
                  { value: "", label: "Não definido" },
                  ...Object.entries(goalLabels).map(([value, label]) => ({ value, label })),
                ]}
              />
            </label>
            <label>
              Valor mensal do objetivo
              <MoneyInput
                key={`${incomeInputVersion}-target`}
                id="settings-monthly-target"
                defaultCents={profile?.targetInCents ?? 0}
                aria-describedby={targetError ? "settings-target-error" : undefined}
                onChange={(targetInCents) => profile && onChange({ ...profile, targetInCents })}
              />
            </label>
          </div>
          {targetError && (
            <small id="settings-target-error" className="form-error" role="alert">
              {targetError}
            </small>
          )}
        </div>
        {profileDirty && (
          <div className="settings-form-actions">
            <button className="secondary" onClick={onDiscard} disabled={saving}>
              Descartar
            </button>
            <button onClick={onSave} disabled={saving || !!nameError || !!incomeError || !!targetError}>
              <Save size={16} /> {saving ? "Salvando…" : "Salvar alterações"}
            </button>
          </div>
        )}
      </article>
    </div>
  );
}

function AppearanceSection({
  draft,
  dirty,
  saving,
  onChange,
  onDiscard,
  onSave,
}: {
  draft: EditableUiPreferences;
  dirty: boolean;
  saving: boolean;
  onChange: (draft: EditableUiPreferences) => void;
  onDiscard: () => void;
  onSave: () => void;
}) {
  const zoomPercent = Math.round(draft.zoom * 100);
  return (
    <div className="settings-section">
      <article className="panel settings-panel">
        <div className="panel-title">
          <h2>
            <Palette size={18} /> Aparência e acessibilidade
          </h2>
        </div>
        <div className="settings-form">
          <label>
            Tema
            <Select
              value={draft.themePreference}
              onChange={(themePreference) =>
                onChange({ ...draft, themePreference: themePreference as EditableUiPreferences["themePreference"] })
              }
              options={[
                { value: "system", label: "Usar tema do sistema" },
                { value: "light", label: "Claro" },
                { value: "dark", label: "Escuro" },
              ]}
            />
          </label>
          <div className="settings-zoom">
            <div>
              <strong>Zoom da interface</strong>
              <small>Ajuste a escala sem alterar os dados.</small>
            </div>
            <div className="settings-zoom__controls">
              <button
                className="icon-button secondary"
                aria-label="Diminuir zoom"
                onClick={() => onChange({ ...draft, zoom: Math.max(0.8, Number((draft.zoom - 0.1).toFixed(1))) })}
                disabled={draft.zoom <= 0.8}
              >
                <Minus size={16} />
              </button>
              <output aria-label={`Zoom atual: ${zoomPercent}%`}>{zoomPercent}%</output>
              <button
                className="icon-button secondary"
                aria-label="Aumentar zoom"
                onClick={() => onChange({ ...draft, zoom: Math.min(1.4, Number((draft.zoom + 0.1).toFixed(1))) })}
                disabled={draft.zoom >= 1.4}
              >
                <Plus size={16} />
              </button>
              <button
                className="text-button"
                onClick={() => onChange({ ...draft, zoom: 1 })}
                disabled={draft.zoom === 1}
              >
                100%
              </button>
            </div>
          </div>
          <label>
            Menu lateral
            <Select
              value={draft.sidebar}
              onChange={(sidebar) => onChange({ ...draft, sidebar: sidebar as EditableUiPreferences["sidebar"] })}
              options={[
                { value: "expanded", label: "Expandido" },
                { value: "compact", label: "Compacto" },
              ]}
            />
          </label>
        </div>
        {dirty && (
          <div className="settings-form-actions">
            <button className="secondary" onClick={onDiscard} disabled={saving}>
              Descartar
            </button>
            <button onClick={onSave} disabled={saving}>
              <Save size={16} /> {saving ? "Salvando…" : "Salvar aparência"}
            </button>
          </div>
        )}
      </article>
    </div>
  );
}

function DataSection({
  desktopRuntime,
  exportFormat,
  activeOperation,
  lastBackupAt,
  reminderDraftDays,
  reminderDirty,
  onFormatChange,
  onExport,
  onBackup,
  onRestore,
  onReminderDaysChange,
  onReminderDiscard,
  onReminderSave,
}: {
  desktopRuntime: boolean;
  exportFormat: ExportFormat;
  activeOperation: ActiveOperation;
  lastBackupAt: string | null;
  reminderDraftDays: 7 | 14 | 30 | null;
  reminderDirty: boolean;
  onFormatChange: (value: string) => void;
  onExport: () => void;
  onBackup: () => void;
  onRestore: () => void;
  onReminderDaysChange: (value: string) => void;
  onReminderDiscard: () => void;
  onReminderSave: () => void;
}) {
  if (!desktopRuntime)
    return (
      <article className="panel settings-panel settings-unavailable">
        <HardDrive size={22} aria-hidden="true" />
        <div>
          <h2>Disponível no aplicativo desktop</h2>
          <p className="muted">
            Exportação, backup e restauração usam arquivos locais. Abra o Lumen instalado para gerenciar os dados deste
            dispositivo.
          </p>
        </div>
      </article>
    );
  const busy = activeOperation !== null;
  return (
    <div className="settings-section settings-data-grid">
      <article className="panel settings-panel">
        <div className="panel-title">
          <h2>
            <FileDown size={18} /> Exportar transações
          </h2>
        </div>
        <p className="muted">Crie uma cópia das transações para planilhas, outros aplicativos ou leitura.</p>
        <div className="settings-inline-action">
          <Select
            value={exportFormat}
            onChange={onFormatChange}
            options={exportFormats as unknown as { value: string; label: string }[]}
            disabled={busy}
          />
          <button className="secondary" onClick={onExport} disabled={busy}>
            <Download size={16} /> {activeOperation === "export" ? "Exportando…" : "Exportar"}
          </button>
        </div>
        {exportFormat === "ofx" && (
          <small className="settings-field-help">A compatibilidade pode variar entre aplicativos financeiros.</small>
        )}
        {exportFormat === "pdf" && (
          <small className="settings-field-help">O PDF resume os totais e lista até 120 transações.</small>
        )}
        <p className="settings-security-note status-warning">
          <AlertTriangle size={16} aria-hidden="true" /> Arquivos CSV, OFX e PDF não são criptografados pelo Lumen.
        </p>
      </article>
      <article className="panel settings-panel" data-quick-guide="backup">
        <div className="panel-title">
          <h2>
            <Database size={18} /> Backup completo
          </h2>
        </div>
        <p className="muted">
          Último backup registrado neste dispositivo: <strong>{formatBackupDate(lastBackupAt)}</strong>
        </p>
        <p className="settings-security-note status-warning">
          <AlertTriangle size={16} aria-hidden="true" /> Os backups não são criptografados pelo Lumen.
        </p>
        <div className="settings-inline-action">
          <button className="secondary" onClick={onBackup} disabled={busy}>
            <Database size={16} /> {activeOperation === "backup" ? "Criando backup…" : "Fazer backup"}
          </button>
          <label className="settings-reminder">
            Lembrar novamente
            <Select
              value={reminderDraftDays === null ? "off" : String(reminderDraftDays)}
              onChange={onReminderDaysChange}
              options={[
                { value: "7", label: "Em 7 dias" },
                { value: "14", label: "Em 14 dias" },
                { value: "30", label: "Em 30 dias" },
                { value: "off", label: "Desativado" },
              ]}
              disabled={busy}
            />
          </label>
        </div>
        {reminderDirty && (
          <div className="settings-form-actions">
            <button className="secondary" onClick={onReminderDiscard} disabled={busy}>
              Descartar
            </button>
            <button onClick={onReminderSave} disabled={busy}>
              <Save size={16} /> Salvar lembrete
            </button>
          </div>
        )}
      </article>
      <article className="panel settings-panel">
        <div className="panel-title">
          <h2>
            <RotateCcw size={18} /> Restaurar backup
          </h2>
        </div>
        <p className="muted">Substitui os dados atuais após validação e reinicia o aplicativo para concluir.</p>
        <button className="secondary" onClick={onRestore} disabled={busy}>
          <RotateCcw size={16} /> {activeOperation === "restore" ? "Preparando…" : "Escolher backup"}
        </button>
      </article>
    </div>
  );
}

function PrivacySection() {
  return (
    <div className="settings-section">
      <article className="panel settings-panel">
        <div className="panel-title">
          <h2>
            <ShieldCheck size={18} /> Privacidade e segurança
          </h2>
        </div>
        <div className="settings-fact-list">
          <div>
            <HardDrive aria-hidden="true" />
            <span>
              <strong>Armazenamento local</strong>
              <small>O banco financeiro é processado e armazenado localmente pelo Lumen.</small>
            </span>
          </div>
          <div>
            <Check aria-hidden="true" />
            <span>
              <strong>Sem conta, nuvem ou telemetria</strong>
              <small>O Lumen não exige login nem envia seus extratos automaticamente.</small>
            </span>
          </div>
        </div>
        <div className="settings-security-note status-warning">
          <AlertTriangle size={18} aria-hidden="true" />
          <div>
            <strong>Sem criptografia em repouso</strong>
            <p>
              O banco local, os backups e os arquivos CSV, OFX e PDF ainda não são criptografados pelo Lumen. Use uma
              senha no sistema, criptografia de disco e guarde cópias em local seguro.
            </p>
          </div>
        </div>
      </article>
    </div>
  );
}

function AboutSection({
  updatesEnabled,
  checkingUpdate,
  onCheckUpdates,
}: {
  updatesEnabled: boolean;
  checkingUpdate: boolean;
  onCheckUpdates: () => void;
}) {
  const navigate = useNavigate();

  return (
    <div className="settings-section">
      <article className="panel settings-panel">
        <div className="panel-title">
          <h2>
            <Info size={18} /> Sobre o Lumen
          </h2>
        </div>
        <div className="settings-about-row">
          <div>
            <strong>Versão instalada</strong>
            <small>Lumen v{APP_VERSION}</small>
          </div>
          {updatesEnabled && (
            <button className="secondary" onClick={onCheckUpdates} disabled={checkingUpdate}>
              <RefreshCw size={16} /> {checkingUpdate ? "Checando…" : "Checar atualização"}
            </button>
          )}
        </div>
        <p className="settings-update-privacy">
          Em versões instaladas, a verificação de atualizações consulta o GitHub sem enviar banco, backup ou transações.
        </p>
        <div className="settings-about-row">
          <div>
            <strong>Projeto aberto</strong>
            <small>Licença MIT e código disponível para auditoria e contribuição.</small>
          </div>
          <a
            className="secondary"
            href={LUMEN_GITHUB_URL}
            onClick={(event) => {
              if (!isTauriRuntime()) return;
              event.preventDefault();
              void openUrl(LUMEN_GITHUB_URL);
            }}
          >
            Ver no GitHub <ExternalLink size={15} />
          </a>
        </div>
        <div className="settings-about-row">
          <div>
            <strong>Tour completo</strong>
            <small>Reveja as 14 etapas para entender cada área do Lumen e agir com segurança.</small>
          </div>
          <button className="secondary" type="button" onClick={restartQuickStartGuide}>
            <BookOpen size={16} /> Refazer tour completo
          </button>
        </div>
        <div className="settings-about-row">
          <div>
            <strong>Ajuda de importação</strong>
            <small>Retome a orientação contextual para importar um extrato ou uma fatura.</small>
          </div>
          <button
            className="secondary"
            type="button"
            onClick={() => {
              restartImportGuide();
              navigate("/import");
            }}
          >
            <FileUp size={16} /> Rever ajuda de importação
          </button>
        </div>
        <div className="settings-shortcuts">
          <Keyboard size={18} aria-hidden="true" />
          <div>
            <strong>Atalhos úteis</strong>
            <small>
              <kbd>⌘K</kbd> (ou <kbd>Ctrl+K</kbd>) abre a busca. <kbd>⌘+</kbd>/<kbd>⌘−</kbd> (ou <kbd>Ctrl+</kbd>/
              <kbd>Ctrl−</kbd>) ajusta o zoom; <kbd>⌘0</kbd> (ou <kbd>Ctrl+0</kbd>) restaura 100%.
            </small>
          </div>
        </div>
      </article>
    </div>
  );
}

function DangerSection({
  desktopRuntime,
  disabled,
  onReset,
}: {
  desktopRuntime: boolean;
  disabled: boolean;
  onReset: () => void;
}) {
  return (
    <div className="settings-section">
      <article className="panel settings-panel settings-danger-panel">
        <div className="panel-title">
          <h2>
            <AlertTriangle size={18} /> Zona de risco
          </h2>
        </div>
        <p className="muted">
          Apaga permanentemente contas, transações, categorias, regras, metas, recorrências e faturas. As preferências
          visuais permanecem somente neste dispositivo.
        </p>
        {desktopRuntime ? (
          <button className="danger" onClick={onReset} disabled={disabled}>
            <Trash2 size={16} /> Apagar dados financeiros
          </button>
        ) : (
          <p className="settings-unavailable-copy">Abra o aplicativo desktop para resetar seus dados locais.</p>
        )}
      </article>
    </div>
  );
}
