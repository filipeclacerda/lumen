import { create } from "zustand";

export type MaintenanceRestartReason = "restore" | "reset";

type MaintenanceRestartStore = {
  reason: MaintenanceRestartReason | null;
  requireRestart: (reason: MaintenanceRestartReason) => void;
  clearForTests: () => void;
};

const STORAGE_KEY = "lumen-maintenance-restart-v1";

function readReason(): MaintenanceRestartReason | null {
  try {
    const value = sessionStorage.getItem(STORAGE_KEY);
    return value === "restore" || value === "reset" ? value : null;
  } catch {
    return null;
  }
}

function persistReason(reason: MaintenanceRestartReason | null) {
  try {
    if (reason) sessionStorage.setItem(STORAGE_KEY, reason);
    else sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    // The in-memory lock still protects the current renderer session.
  }
}

/**
 * Session-only safety lock. Once native maintenance has been staged, no more
 * financial mutations should be possible before the process restarts.
 */
export const useMaintenanceRestart = create<MaintenanceRestartStore>((set) => ({
  reason: readReason(),
  requireRestart: (reason) => {
    persistReason(reason);
    set({ reason });
  },
  clearForTests: () => {
    persistReason(null);
    set({ reason: null });
  },
}));
