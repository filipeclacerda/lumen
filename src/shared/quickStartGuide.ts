import { create } from "zustand";

export const QUICK_START_GUIDE_STORAGE_KEY = "financa-quick-start-guide";
export const QUICK_START_GUIDE_VERSION = 1;

export type QuickStartGuideStatus = "pending" | "completed" | "dismissed";
export type QuickStartGuideMode = "closed" | "invitation" | "tour";

type StoredQuickStartGuide = {
  version: typeof QUICK_START_GUIDE_VERSION;
  status: QuickStartGuideStatus;
};

type QuickStartGuideStore = {
  mode: QuickStartGuideMode;
  stepIndex: number;
  start: () => void;
  goToStep: (stepIndex: number) => void;
  dismiss: () => void;
  complete: () => void;
};

function readStoredGuide(): StoredQuickStartGuide | undefined {
  try {
    const raw = localStorage.getItem(QUICK_START_GUIDE_STORAGE_KEY);
    if (!raw) return undefined;
    const value = JSON.parse(raw) as Partial<StoredQuickStartGuide>;
    if (
      value.version !== QUICK_START_GUIDE_VERSION ||
      (value.status !== "pending" && value.status !== "completed" && value.status !== "dismissed")
    ) {
      return undefined;
    }
    return value as StoredQuickStartGuide;
  } catch {
    return undefined;
  }
}

function writeStatus(status: QuickStartGuideStatus) {
  try {
    localStorage.setItem(
      QUICK_START_GUIDE_STORAGE_KEY,
      JSON.stringify({ version: QUICK_START_GUIDE_VERSION, status } satisfies StoredQuickStartGuide),
    );
  } catch {
    // The guide remains usable for this session when storage is unavailable.
  }
}

const initialMode: QuickStartGuideMode = readStoredGuide()?.status === "pending" ? "invitation" : "closed";

export const useQuickStartGuide = create<QuickStartGuideStore>((set) => ({
  mode: initialMode,
  stepIndex: 0,
  start: () => set({ mode: "tour", stepIndex: 0 }),
  goToStep: (stepIndex) => set({ mode: "tour", stepIndex }),
  dismiss: () => {
    writeStatus("dismissed");
    set({ mode: "closed", stepIndex: 0 });
  },
  complete: () => {
    writeStatus("completed");
    set({ mode: "closed", stepIndex: 0 });
  },
}));

/** Queues the invitation only after a newly-created profile finishes onboarding. */
export function queueQuickStartGuide() {
  writeStatus("pending");
  useQuickStartGuide.setState({ mode: "invitation", stepIndex: 0 });
}

/** Starts the tour immediately when the user explicitly requests it from Settings. */
export function restartQuickStartGuide() {
  useQuickStartGuide.getState().start();
}

export function storedQuickStartGuideStatus() {
  return readStoredGuide()?.status;
}

export function resetQuickStartGuideForTests() {
  const mode: QuickStartGuideMode = readStoredGuide()?.status === "pending" ? "invitation" : "closed";
  useQuickStartGuide.setState({ mode, stepIndex: 0 });
}
