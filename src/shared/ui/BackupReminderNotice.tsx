import { useEffect, useState } from "react";
import { Database, Clock3 } from "lucide-react";
import { save } from "@tauri-apps/plugin-dialog";
import { backupReminderDue, createVerifiedBackup, useBackupReminder } from "../backupReminder";
import { isTauriRuntime } from "../runtime";
import { useToast } from "./toast";

export function BackupReminderNotice({ enabled }: { enabled: boolean }) {
  const toast = useToast();
  const reminder = useBackupReminder((state) => state.reminder);
  const initialized = useBackupReminder((state) => state.initialized);
  const isBackingUp = useBackupReminder((state) => state.isBackingUp);
  const initialize = useBackupReminder((state) => state.initialize);
  const snoozeOneDay = useBackupReminder((state) => state.snoozeOneDay);
  const [now, setNow] = useState(() => new Date());
  const desktopRuntime = isTauriRuntime();

  useEffect(() => {
    if (!enabled || !desktopRuntime) return;
    const refreshNow = () => setNow(new Date());
    initialize();
    refreshNow();
    const timer = window.setInterval(refreshNow, 60_000);
    window.addEventListener("focus", refreshNow);
    document.addEventListener("visibilitychange", refreshNow);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", refreshNow);
      document.removeEventListener("visibilitychange", refreshNow);
    };
  }, [desktopRuntime, enabled, initialize]);

  if (!enabled || !desktopRuntime || !initialized || !backupReminderDue(reminder, now)) return null;

  async function backup() {
    try {
      const path = await save({
        defaultPath: "lumen-backup.db",
        filters: [{ name: "Backup do Lumen", extensions: ["db"] }],
      });
      if (!path) return;
      const result = await createVerifiedBackup(path);
      toast("Backup salvo com sucesso!");
      if (!result.reminderRecorded)
        toast("O backup foi concluído, mas o lembrete não pôde ser salvo neste dispositivo.", "error");
    } catch (error) {
      toast((error as { message?: string })?.message ?? "Falha ao gerar o backup.", "error");
    }
  }

  return (
    <div className="update-banner" role="status" aria-label="Lembrete de backup">
      <div>
        <strong>Está na hora de proteger seus dados</strong>
        <span>Faça uma cópia local atualizada. O arquivo não é enviado nem criptografado pelo Lumen.</span>
      </div>
      <div className="update-banner-actions">
        <button className="secondary" onClick={() => void backup()} disabled={isBackingUp}>
          <Database size={15} /> {isBackingUp ? "Criando backup…" : "Fazer backup"}
        </button>
        <button className="ghost" onClick={() => snoozeOneDay(new Date())} disabled={isBackingUp}>
          <Clock3 size={15} /> Lembrar amanhã
        </button>
      </div>
    </div>
  );
}
