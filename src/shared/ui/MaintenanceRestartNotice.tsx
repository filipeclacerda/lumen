import { useEffect, useState } from "react";
import { RefreshCw } from "lucide-react";
import { relaunch } from "@tauri-apps/plugin-process";
import { useMaintenanceRestart } from "../maintenanceRestart";
import { OverlayDialog } from "./OverlayDialog";
import { useToast } from "./toast";

export function MaintenanceRestartNotice() {
  const toast = useToast();
  const reason = useMaintenanceRestart((state) => state.reason);
  const [restarting, setRestarting] = useState(false);

  async function restart() {
    if (restarting) return;
    setRestarting(true);
    try {
      await relaunch();
    } catch {
      toast(
        `${reason === "restore" ? "A restauração" : "A limpeza"} está preparada. Feche e abra o Lumen para concluir.`,
        "error",
      );
      setRestarting(false);
    }
  }

  useEffect(() => {
    if (!reason) return;
    const timer = window.setTimeout(() => void restart(), 900);
    return () => window.clearTimeout(timer);
    // Restart is intentionally triggered once when the global lock is raised.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reason]);

  if (!reason) return null;
  const action = reason === "restore" ? "Restauração" : "Limpeza";
  return (
    <OverlayDialog title={`${action} preparada`} onClose={() => undefined} dismissible={false}>
      <div className="settings-dialog">
        <div className="settings-restart-required" role="status">
          <RefreshCw size={22} aria-hidden="true" />
          <div>
            <strong>O Lumen precisa reiniciar</strong>
            <p>
              Nenhuma outra alteração pode ser feita agora. Se a janela não fechar automaticamente, feche e abra o
              aplicativo.
            </p>
          </div>
        </div>
        <button onClick={() => void restart()} disabled={restarting}>
          <RefreshCw size={16} /> {restarting ? "Reiniciando…" : "Tentar reiniciar novamente"}
        </button>
      </div>
    </OverlayDialog>
  );
}
