import { create } from "zustand";

export const QUICK_START_GUIDE_STORAGE_KEY = "financa-quick-start-guide";
export const QUICK_START_GUIDE_VERSION = 2;

export type QuickStartGuideId = "complete" | "import";
export type QuickStartGuideStatus = "active" | "paused" | "completed" | "dismissed";
export type QuickStartGuideMode = "closed" | "invitation" | "tour";
export type ImportGuidePhase = "choose" | "configure" | "review" | "confirm" | "success";

export type CompleteGuideProgress = {
  status: QuickStartGuideStatus;
  stepIndex: number;
};

export type ImportGuideProgress = {
  status: QuickStartGuideStatus;
  phase: ImportGuidePhase;
};

export type StoredQuickStartGuide = {
  version: typeof QUICK_START_GUIDE_VERSION;
  complete: CompleteGuideProgress;
  import?: ImportGuideProgress;
};

type LegacyStoredQuickStartGuide = {
  version: 1;
  status: "pending" | "completed" | "dismissed";
};

type QuickStartGuideStore = {
  activeGuide: QuickStartGuideId | null;
  mode: QuickStartGuideMode;
  guides: Omit<StoredQuickStartGuide, "version">;
  start: (guide?: QuickStartGuideId) => void;
  pause: (guide?: QuickStartGuideId) => void;
  resume: (guide: QuickStartGuideId) => void;
  dismiss: (guide?: QuickStartGuideId) => void;
  complete: (guide?: QuickStartGuideId) => void;
  restart: (guide: QuickStartGuideId) => void;
  goToStep: (stepIndex: number) => void;
  setImportPhase: (phase: ImportGuidePhase) => void;
};

const DEFAULT_COMPLETE_PROGRESS: CompleteGuideProgress = { status: "paused", stepIndex: 0 };
const DEFAULT_IMPORT_PROGRESS: ImportGuideProgress = { status: "paused", phase: "choose" };
const COMPLETE_TOUR_LAST_STEP = 4;
const validStatuses: ReadonlyArray<QuickStartGuideStatus> = ["active", "paused", "completed", "dismissed"];
const validImportPhases: ReadonlyArray<ImportGuidePhase> = ["choose", "configure", "review", "confirm", "success"];

function isStatus(value: unknown): value is QuickStartGuideStatus {
  return validStatuses.includes(value as QuickStartGuideStatus);
}

function isImportPhase(value: unknown): value is ImportGuidePhase {
  return validImportPhases.includes(value as ImportGuidePhase);
}

function normalizeStepIndex(value: unknown) {
  if (typeof value !== "number" || !Number.isInteger(value)) return 0;
  return Math.max(0, Math.min(value, COMPLETE_TOUR_LAST_STEP));
}

function migrateLegacyGuide(value: LegacyStoredQuickStartGuide): StoredQuickStartGuide {
  const status: QuickStartGuideStatus =
    value.status === "pending" ? "paused" : value.status === "completed" ? "completed" : "dismissed";
  return {
    version: QUICK_START_GUIDE_VERSION,
    complete: { status, stepIndex: 0 },
  };
}

function parseStoredGuide(raw: string): StoredQuickStartGuide | undefined {
  try {
    const value = JSON.parse(raw) as Record<string, unknown>;
    if (
      value.version === 1 &&
      (value.status === "pending" || value.status === "completed" || value.status === "dismissed")
    ) {
      return migrateLegacyGuide(value as LegacyStoredQuickStartGuide);
    }
    if (value.version !== QUICK_START_GUIDE_VERSION || !value.complete || typeof value.complete !== "object") {
      return undefined;
    }

    const complete = value.complete as Record<string, unknown>;
    if (!isStatus(complete.status)) return undefined;

    let importProgress: ImportGuideProgress | undefined;
    if (value.import !== undefined) {
      if (!value.import || typeof value.import !== "object") return undefined;
      const candidate = value.import as Record<string, unknown>;
      if (!isStatus(candidate.status) || !isImportPhase(candidate.phase)) return undefined;
      importProgress = { status: candidate.status, phase: candidate.phase };
    }

    const completeProgress = { status: complete.status, stepIndex: normalizeStepIndex(complete.stepIndex) };
    if (completeProgress.status === "active" && importProgress?.status === "active") {
      importProgress = { ...importProgress, status: "paused" };
    }

    return {
      version: QUICK_START_GUIDE_VERSION,
      complete: completeProgress,
      ...(importProgress ? { import: importProgress } : {}),
    };
  } catch {
    return undefined;
  }
}

function writeStoredGuide(guides: Omit<StoredQuickStartGuide, "version">) {
  try {
    localStorage.setItem(
      QUICK_START_GUIDE_STORAGE_KEY,
      JSON.stringify({ version: QUICK_START_GUIDE_VERSION, ...guides } satisfies StoredQuickStartGuide),
    );
  } catch {
    // The guides remain usable for this session when storage is unavailable.
  }
}

function readStoredGuide(): StoredQuickStartGuide | undefined {
  try {
    const raw = localStorage.getItem(QUICK_START_GUIDE_STORAGE_KEY);
    if (!raw) return undefined;
    const stored = parseStoredGuide(raw);
    if (stored && JSON.parse(raw).version === 1) {
      writeStoredGuide({ complete: stored.complete, import: stored.import });
    }
    return stored;
  } catch {
    return undefined;
  }
}

function normalizeStoredGuideForSession(stored: StoredQuickStartGuide | undefined) {
  if (stored?.import?.status !== "active") return stored;
  const normalized: StoredQuickStartGuide = {
    ...stored,
    import: { status: "paused", phase: "choose" },
  };
  writeStoredGuide({ complete: normalized.complete, import: normalized.import });
  return normalized;
}

const initialStoredGuide = normalizeStoredGuideForSession(readStoredGuide());
const initialGuides: Omit<StoredQuickStartGuide, "version"> = {
  complete: initialStoredGuide?.complete ?? DEFAULT_COMPLETE_PROGRESS,
  ...(initialStoredGuide?.import ? { import: initialStoredGuide.import } : {}),
};
const initialActiveGuide: QuickStartGuideId | null =
  initialGuides.complete.status === "active" ? "complete" : initialGuides.import?.status === "active" ? "import" : null;
const initialMode: QuickStartGuideMode = initialActiveGuide
  ? "tour"
  : initialStoredGuide?.complete.status === "paused"
    ? "invitation"
    : "closed";

function guideProgress(
  guides: Omit<StoredQuickStartGuide, "version">,
  guide: QuickStartGuideId,
): CompleteGuideProgress | ImportGuideProgress {
  return guide === "complete" ? guides.complete : (guides.import ?? DEFAULT_IMPORT_PROGRESS);
}

function resolveGuide(activeGuide: QuickStartGuideId | null, guide?: QuickStartGuideId) {
  return guide ?? activeGuide ?? "complete";
}

export const useQuickStartGuide = create<QuickStartGuideStore>((set) => {
  const updateGuide = (
    guide: QuickStartGuideId,
    update: (progress: CompleteGuideProgress | ImportGuideProgress) => CompleteGuideProgress | ImportGuideProgress,
    activeGuide: QuickStartGuideId | null,
    mode: QuickStartGuideMode,
  ) =>
    set((state) => {
      const progress = update(guideProgress(state.guides, guide));
      let guides =
        guide === "complete"
          ? { ...state.guides, complete: progress as CompleteGuideProgress }
          : { ...state.guides, import: progress as ImportGuideProgress };
      if (activeGuide && state.activeGuide && state.activeGuide !== activeGuide) {
        const previous = state.activeGuide;
        const previousProgress = { ...guideProgress(guides, previous), status: "paused" } as
          CompleteGuideProgress | ImportGuideProgress;
        guides =
          previous === "complete"
            ? { ...guides, complete: previousProgress as CompleteGuideProgress }
            : { ...guides, import: previousProgress as ImportGuideProgress };
      }
      writeStoredGuide(guides);
      return { guides, activeGuide, mode };
    });

  return {
    activeGuide: initialActiveGuide,
    mode: initialMode,
    guides: initialGuides,
    start: (guide = "complete") =>
      updateGuide(
        guide,
        () => (guide === "complete" ? { status: "active", stepIndex: 0 } : { status: "active", phase: "choose" }),
        guide,
        "tour",
      ),
    pause: (guide) =>
      set((state) => {
        const resolved = resolveGuide(state.activeGuide, guide);
        const progress = { ...guideProgress(state.guides, resolved), status: "paused" } as
          CompleteGuideProgress | ImportGuideProgress;
        const guides =
          resolved === "complete"
            ? { ...state.guides, complete: progress as CompleteGuideProgress }
            : { ...state.guides, import: progress as ImportGuideProgress };
        writeStoredGuide(guides);
        const isActiveGuide = state.activeGuide === resolved;
        const isInvitation = resolved === "complete" && state.mode === "invitation";
        return {
          guides,
          activeGuide: isActiveGuide ? null : state.activeGuide,
          mode: isActiveGuide || isInvitation ? "closed" : state.mode,
        };
      }),
    resume: (guide) => updateGuide(guide, (progress) => ({ ...progress, status: "active" }), guide, "tour"),
    dismiss: (guide) =>
      set((state) => {
        const resolved = resolveGuide(state.activeGuide, guide);
        const progress = { ...guideProgress(state.guides, resolved), status: "dismissed" } as
          CompleteGuideProgress | ImportGuideProgress;
        const guides =
          resolved === "complete"
            ? { ...state.guides, complete: progress as CompleteGuideProgress }
            : { ...state.guides, import: progress as ImportGuideProgress };
        writeStoredGuide(guides);
        const isActiveGuide = state.activeGuide === resolved;
        return {
          guides,
          activeGuide: isActiveGuide ? null : state.activeGuide,
          mode: isActiveGuide ? "closed" : state.mode,
        };
      }),
    complete: (guide) =>
      set((state) => {
        const resolved = resolveGuide(state.activeGuide, guide);
        const progress = { ...guideProgress(state.guides, resolved), status: "completed" } as
          CompleteGuideProgress | ImportGuideProgress;
        const guides =
          resolved === "complete"
            ? { ...state.guides, complete: progress as CompleteGuideProgress }
            : { ...state.guides, import: progress as ImportGuideProgress };
        writeStoredGuide(guides);
        const isActiveGuide = state.activeGuide === resolved;
        return {
          guides,
          activeGuide: isActiveGuide ? null : state.activeGuide,
          mode: isActiveGuide ? "closed" : state.mode,
        };
      }),
    restart: (guide) =>
      updateGuide(
        guide,
        () => (guide === "complete" ? { status: "active", stepIndex: 0 } : { status: "active", phase: "choose" }),
        guide,
        "tour",
      ),
    goToStep: (stepIndex) =>
      set((state) => {
        const guides: Omit<StoredQuickStartGuide, "version"> = {
          ...state.guides,
          complete: { status: "active" as const, stepIndex: normalizeStepIndex(stepIndex) },
          ...(state.guides.import?.status === "active"
            ? { import: { ...state.guides.import, status: "paused" as const } }
            : {}),
        };
        writeStoredGuide(guides);
        return { guides, activeGuide: "complete", mode: "tour" };
      }),
    setImportPhase: (phase) =>
      set((state) => {
        const guides = {
          ...state.guides,
          complete:
            state.guides.complete.status === "active"
              ? { ...state.guides.complete, status: "paused" as const }
              : state.guides.complete,
          import: { status: "active" as const, phase },
        };
        writeStoredGuide(guides);
        return { guides, activeGuide: "import", mode: "tour" };
      }),
  };
});

/** Queues the invitation only after a newly-created profile finishes onboarding. */
export function queueQuickStartGuide() {
  const importProgress = useQuickStartGuide.getState().guides.import;
  const guides = {
    ...useQuickStartGuide.getState().guides,
    complete: { status: "paused" as const, stepIndex: 0 },
    ...(importProgress?.status === "active" ? { import: { ...importProgress, status: "paused" as const } } : {}),
  };
  writeStoredGuide(guides);
  useQuickStartGuide.setState({ activeGuide: null, mode: "invitation", guides });
}

/** Starts the complete tour immediately when the user explicitly requests it. */
export function restartQuickStartGuide() {
  useQuickStartGuide.getState().restart("complete");
}

export function restartImportGuide() {
  useQuickStartGuide.getState().restart("import");
}

export function storedQuickStartGuideState() {
  return readStoredGuide();
}

/** Compatibility helper for callers that only need the complete-guide outcome. */
export function storedQuickStartGuideStatus() {
  const status = readStoredGuide()?.complete.status;
  return status === "active" || status === "paused" ? "pending" : status;
}

export function resetQuickStartGuideForTests() {
  const stored = normalizeStoredGuideForSession(readStoredGuide());
  const activeGuide: QuickStartGuideId | null =
    stored?.complete.status === "active" ? "complete" : stored?.import?.status === "active" ? "import" : null;
  useQuickStartGuide.setState({
    activeGuide,
    mode: activeGuide ? "tour" : stored?.complete.status === "paused" ? "invitation" : "closed",
    guides: {
      complete: stored?.complete ?? DEFAULT_COMPLETE_PROGRESS,
      ...(stored?.import ? { import: stored.import } : {}),
    },
  });
}
