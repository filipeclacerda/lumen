import { useCallback, useEffect, useState } from "react";
import { Download, RefreshCw, X } from "lucide-react";
import { relaunch } from "@tauri-apps/plugin-process";
import type { DownloadEvent } from "@tauri-apps/plugin-updater";
import { checkLumenUpdate, dismissUpdate, forceUpdateCheckEvent, isUpdateDismissed, type LumenUpdate } from "../updater";
import { Modal } from "./Modal";
import { useToast } from "./toast";

type InstallState = "idle" | "downloading" | "installing" | "ready";

export function UpdateNotice({ enabled }: { enabled: boolean }) {
  const toast = useToast();
  const [availableUpdate, setAvailableUpdate] = useState<LumenUpdate | null>(null);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [installState, setInstallState] = useState<InstallState>("idle");
  const [progress, setProgress] = useState(0);

  const checkForUpdate = useCallback(async () => {
    try {
      const update = await checkLumenUpdate();
      if (!update || isUpdateDismissed(update.latestVersion)) return;
      setAvailableUpdate(update);
    } catch {
      // Automatic checks stay quiet so startup never feels noisy.
    }
  }, []);

  useEffect(() => {
    if (enabled) void checkForUpdate();
  }, [checkForUpdate, enabled]);

  useEffect(() => {
    if (!enabled) return;
    const onRefresh = () => void checkForUpdate();
    window.addEventListener(forceUpdateCheckEvent, onRefresh);
    return () => window.removeEventListener(forceUpdateCheckEvent, onRefresh);
  }, [checkForUpdate, enabled]);

  if (!availableUpdate) return null;
  const updateInfo = availableUpdate;

  function closeForThisVersion() {
    dismissUpdate(updateInfo.latestVersion);
    setDetailsOpen(false);
    setAvailableUpdate(null);
  }

  async function installUpdate() {
    let totalBytes = 0;
    let downloadedBytes = 0;
    setInstallState("downloading");
    setProgress(0);
    try {
      await updateInfo.update.downloadAndInstall((event: DownloadEvent) => {
        if (event.event === "Started") {
          totalBytes = event.data.contentLength ?? 0;
          downloadedBytes = 0;
          setProgress(0);
        } else if (event.event === "Progress") {
          downloadedBytes += event.data.chunkLength;
          if (totalBytes > 0) setProgress(Math.min(99, Math.round((downloadedBytes / totalBytes) * 100)));
        } else {
          setProgress(100);
          setInstallState("installing");
        }
      });
      setInstallState("ready");
      toast("Atualização instalada. Reiniciando o Lúmen…");
      await new Promise(resolve => setTimeout(resolve, 900));
      await relaunch();
    } catch(e) {
      setInstallState("idle");
      setProgress(0);
      toast((e as {message?: string})?.message ?? "Não foi possível instalar a atualização.", "error");
    }
  }

  const busy = installState === "downloading" || installState === "installing" || installState === "ready";

  return <>
    <div className="update-banner" role="status">
      <div>
        <strong>Nova versão disponível</strong>
        <span>Lúmen {updateInfo.latestVersion} já pode ser instalado.</span>
      </div>
      <div className="update-banner-actions">
        <button className="secondary" onClick={() => setDetailsOpen(true)}><Download size={15}/> Ver atualização</button>
        <button className="icon-button" aria-label="Ignorar esta versão" title="Ignorar esta versão" onClick={closeForThisVersion}><X size={15}/></button>
      </div>
    </div>
    {detailsOpen && <Modal title="Atualização disponível" onClose={() => !busy && setDetailsOpen(false)}>
      <div className="modal-form">
        <p className="muted">Você está usando a versão {updateInfo.currentVersion}. A versão {updateInfo.latestVersion} está pronta para instalação.</p>
        {updateInfo.notes && <div className="update-notes">{updateInfo.notes}</div>}
        {busy && <div className="update-progress" aria-label={`Progresso da atualização ${progress}%`}>
          <i style={{width: `${progress}%`}} />
        </div>}
        <div className="editor-actions">
          <button className="secondary" onClick={closeForThisVersion} disabled={busy}>Agora não</button>
          <button onClick={installUpdate} disabled={busy}>
            {busy ? <RefreshCw size={15}/> : <Download size={15}/>}
            {installState === "downloading" ? `Baixando ${progress}%` : installState === "installing" ? "Instalando…" : installState === "ready" ? "Reiniciando…" : "Instalar agora"}
          </button>
        </div>
      </div>
    </Modal>}
  </>;
}
