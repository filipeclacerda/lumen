import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { open, save } from "@tauri-apps/plugin-dialog";
import { relaunch } from "@tauri-apps/plugin-process";
import {
  AlertTriangle,
  Database,
  Download,
  RefreshCw,
  RotateCcw,
  Save,
  ShieldCheck,
  Trash2,
  UserRound,
} from "lucide-react";
import { api } from "../../shared/api";
import {
  canCheckForUpdates,
  checkLumenUpdate,
  clearDismissedUpdate,
  requestUpdateNoticeRefresh,
} from "../../shared/updater";
import { Modal } from "../../shared/ui/Modal";
import { MoneyInput } from "../../shared/ui/MoneyInput";
import { useToast } from "../../shared/ui/toast";
import type { FinancialGoal } from "../../shared/types";

const RESET_CONFIRM_WORD = "APAGAR";
const RESTORE_CONFIRM_WORD = "RESTAURAR";

const goalLabels: Record<FinancialGoal, string> = {
  organize: "Organizar minhas finanças",
  emergency_fund: "Criar reserva de emergência",
  pay_debt: "Quitar dívidas",
  save: "Economizar para um objetivo",
  invest: "Investir mais",
};

export function SettingsPage() {
  const client = useQueryClient();
  const toast = useToast();
  const { data: profile } = useQuery({ queryKey: ["profile"], queryFn: api.profile });
  const [name, setName] = useState("");
  const [incomeInCents, setIncomeInCents] = useState<number | null>(null);
  const [day, setDay] = useState("");
  const [incomeInputVersion, setIncomeInputVersion] = useState(0);
  const [goal, setGoal] = useState<FinancialGoal>();
  const [saving, setSaving] = useState(false);
  const [resetOpen, setResetOpen] = useState(false);
  const [resetConfirmText, setResetConfirmText] = useState("");
  const [resetting, setResetting] = useState(false);
  const [restorePath, setRestorePath] = useState<string>();
  const [restoreOpen, setRestoreOpen] = useState(false);
  const [restoreConfirmText, setRestoreConfirmText] = useState("");
  const [restoring, setRestoring] = useState(false);
  const [checkingUpdate, setCheckingUpdate] = useState(false);
  const updatesEnabled = canCheckForUpdates();
  useEffect(() => {
    if (profile) {
      setName(profile.displayName);
      setIncomeInCents(profile.monthlyIncomeInCents ?? null);
      setIncomeInputVersion((version) => version + 1);
      setDay(profile.incomeDay ? String(profile.incomeDay) : "");
      setGoal(profile.financialGoal);
    }
  }, [profile]);
  async function saveProfile() {
    setSaving(true);
    try {
      await api.saveProfile({
        displayName: name.trim(),
        monthlyIncomeInCents: incomeInCents ?? undefined,
        incomeDay: day ? Number(day) : undefined,
        financialGoal: goal,
      });
      await Promise.all([
        client.invalidateQueries({ queryKey: ["profile"] }),
        client.invalidateQueries({ queryKey: ["bootstrap"] }),
      ]);
      toast("Perfil atualizado.");
    } catch (e) {
      toast((e as { message?: string })?.message ?? "Não foi possível salvar.", "error");
    } finally {
      setSaving(false);
    }
  }
  async function exportCsv() {
    try {
      const path = await save({
        defaultPath: "transacoes.csv",
        filters: [{ name: "Planilha CSV", extensions: ["csv"] }],
      });
      if (!path) return;
      const count = await api.exportTransactionsCsv(path);
      toast(`${count} transações exportadas.`);
    } catch (e) {
      toast((e as { message?: string })?.message ?? "Falha na exportação.", "error");
    }
  }
  async function backup() {
    try {
      const path = await save({
        defaultPath: "lumen-backup.db",
        filters: [{ name: "Backup do Lumen", extensions: ["db"] }],
      });
      if (path) {
        await api.backupDatabase(path);
        toast("Backup salvo com sucesso!");
      }
    } catch (e) {
      toast((e as { message?: string })?.message ?? "Falha ao gerar o backup.", "error");
    }
  }
  async function restore() {
    try {
      const path = await open({ multiple: false, filters: [{ name: "Backup do Lumen", extensions: ["db"] }] });
      if (path) {
        setRestorePath(path as string);
        setRestoreConfirmText("");
        setRestoreOpen(true);
      }
    } catch (e) {
      toast((e as { message?: string })?.message ?? "Falha ao restaurar.", "error");
    }
  }
  function closeRestore() {
    if (restoring) return;
    setRestoreOpen(false);
    setRestorePath(undefined);
    setRestoreConfirmText("");
  }
  async function confirmRestore() {
    if (!restorePath || restoreConfirmText !== RESTORE_CONFIRM_WORD) return;
    setRestoring(true);
    try {
      await api.restoreDatabase(restorePath);
    } catch (e) {
      toast(
        (e as { message?: string })?.message ?? "O backup é inválido e seus dados atuais não foram alterados.",
        "error",
      );
      setRestoring(false);
      return;
    }
    toast("Backup validado e preparado. Será aplicado na próxima abertura do Lumen.");
    setRestoreOpen(false);
    setRestorePath(undefined);
    setRestoreConfirmText("");
    await new Promise((resolve) => setTimeout(resolve, 900));
    try {
      await relaunch();
    } catch {
      toast("Restauração preparada e será aplicada na próxima abertura. Feche e abra o Lumen para concluir.", "error");
      setRestoring(false);
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
    } catch (e) {
      toast((e as { message?: string })?.message ?? "Não foi possível checar atualizações.", "error");
    } finally {
      setCheckingUpdate(false);
    }
  }
  function closeReset() {
    setResetOpen(false);
    setResetConfirmText("");
  }
  async function resetAllData() {
    setResetting(true);
    try {
      await api.resetDatabase();
      toast("Todos os dados foram apagados. Reiniciando o Lumen…");
      closeReset();
      // The actual wipe happens at startup (before the db pool opens), so we relaunch
      // right after staging it — the user never has to close/reopen the app manually.
      await new Promise((resolve) => setTimeout(resolve, 900));
      await relaunch();
    } catch (e) {
      toast((e as { message?: string })?.message ?? "Não foi possível apagar os dados.", "error");
    } finally {
      setResetting(false);
    }
  }
  return (
    <section>
      <header>
        <div>
          <p className="eyebrow">PREFERÊNCIAS</p>
          <h1>Configurações</h1>
          <p className="muted">Atualize seus dados de planejamento.</p>
        </div>
      </header>
      <div className="settings-grid">
        <article className="panel rule-editor">
          <div className="panel-title">
            <h2>
              <UserRound size={17} /> Perfil financeiro
            </h2>
          </div>
          <label>
            Nome
            <input value={name} onChange={(e) => setName(e.target.value)} />
          </label>
          <div className="form-row">
            <label>
              Renda líquida mensal
              <MoneyInput key={incomeInputVersion} defaultCents={incomeInCents ?? 0} onChange={setIncomeInCents} />
            </label>
            <label>
              Dia de recebimento
              <input type="number" min="1" max="31" value={day} onChange={(e) => setDay(e.target.value)} />
            </label>
          </div>
          <label>
            Objetivo principal
            <select
              value={goal ?? ""}
              onChange={(e) => setGoal((e.target.value || undefined) as FinancialGoal | undefined)}
            >
              <option value="">Não definido</option>
              {Object.entries(goalLabels).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <button onClick={saveProfile} disabled={saving}>
            <Save size={16} /> {saving ? "Salvando…" : "Salvar alterações"}
          </button>
        </article>
        <article className="panel privacy-settings">
          <ShieldCheck />
          <div>
            <h2>Privacidade local</h2>
            <p className="muted">Seu perfil e seus dados financeiros permanecem exclusivamente neste computador.</p>
          </div>
        </article>
      </div>
      <article className="panel" style={{ marginTop: 18 }}>
        <div className="panel-title">
          <h2>
            <Database size={17} /> Dados e backup
          </h2>
        </div>
        <p className="muted">
          Exporte suas transações ou guarde uma cópia completa dos seus dados. Recomendado antes de grandes mudanças.
        </p>
        <div className="data-actions">
          <button className="secondary" onClick={exportCsv}>
            <Download size={15} /> Exportar transações (CSV)
          </button>
          <button className="secondary" onClick={backup} disabled={restoring || resetting}>
            <Database size={15} /> Fazer backup completo
          </button>
          <button className="secondary" onClick={restore} disabled={restoring || resetting}>
            <RotateCcw size={15} /> Restaurar backup
          </button>
        </div>
        <p className="muted" style={{ fontSize: 12, marginTop: 12 }}>
          A restauração substitui todos os dados atuais e é aplicada ao reiniciar o aplicativo.
        </p>
      </article>
      {updatesEnabled && (
        <article className="panel" style={{ marginTop: 18 }}>
          <div className="panel-title">
            <h2>
              <RefreshCw size={17} /> Atualizações
            </h2>
          </div>
          <p className="muted">
            Confira se existe uma versão nova do Lumen. Quando houver atualização, um aviso aparece no topo da tela com
            a opção de instalar.
          </p>
          <div className="data-actions">
            <button className="secondary" onClick={checkForUpdates} disabled={checkingUpdate}>
              <RefreshCw size={15} /> {checkingUpdate ? "Checando…" : "Checar atualização"}
            </button>
          </div>
        </article>
      )}
      <article className="panel danger-zone" style={{ marginTop: 18 }}>
        <div className="panel-title">
          <h2>
            <AlertTriangle size={17} /> Zona de risco
          </h2>
        </div>
        <p className="muted">
          Apaga permanentemente contas, transações, categorias, regras, metas, recorrências e faturas de cartão — o
          Lumen reinicia sozinho e volta ao estado de instalação nova. Faça um backup antes, se precisar dos dados
          depois.
        </p>
        <button className="danger" onClick={() => setResetOpen(true)} disabled={restoring || resetting}>
          <Trash2 size={15} /> Resetar dados do aplicativo
        </button>
      </article>
      {restoreOpen && (
        <Modal title="Restaurar backup e substituir dados?" onClose={closeRestore}>
          <div className="modal-form">
            <p className="muted">
              Esta ação substituirá contas, transações, categorias, configurações e faturas atuais. O arquivo será
              validado antes da troca e o Lumen será reiniciado.
            </p>
            <label>
              Digite {RESTORE_CONFIRM_WORD} para confirmar
              <input value={restoreConfirmText} onChange={(e) => setRestoreConfirmText(e.target.value)} autoFocus />
            </label>
            <div className="editor-actions">
              <button className="secondary" onClick={closeRestore} disabled={restoring}>
                Cancelar
              </button>
              <button
                className="danger"
                onClick={confirmRestore}
                disabled={restoring || restoreConfirmText !== RESTORE_CONFIRM_WORD}
              >
                <RotateCcw size={15} /> {restoring ? "Restaurando…" : "Restaurar backup"}
              </button>
            </div>
          </div>
        </Modal>
      )}
      {resetOpen && (
        <Modal title="Apagar todos os dados?" onClose={closeReset}>
          <div className="modal-form">
            <p className="muted">
              Essa ação não pode ser desfeita. Todos os dados serão apagados e o Lumen reinicia automaticamente para
              concluir a limpeza.
            </p>
            <label>
              Digite {RESET_CONFIRM_WORD} para confirmar
              <input value={resetConfirmText} onChange={(e) => setResetConfirmText(e.target.value)} autoFocus />
            </label>
            <div className="editor-actions">
              <button className="secondary" onClick={closeReset} disabled={resetting}>
                Cancelar
              </button>
              <button
                className="danger"
                onClick={resetAllData}
                disabled={resetting || resetConfirmText !== RESET_CONFIRM_WORD}
              >
                <Trash2 size={15} /> {resetting ? "Apagando…" : "Apagar tudo"}
              </button>
            </div>
          </div>
        </Modal>
      )}
    </section>
  );
}
