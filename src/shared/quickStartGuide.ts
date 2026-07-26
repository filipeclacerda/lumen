import { create } from "zustand";
import {
  DEFAULT_COMPLETE_GUIDE_LESSON_ID,
  defaultImportLessonByPhase,
  importGuidePhaseForLesson,
  isCompleteGuideLessonId,
  isImportGuideLessonId,
  legacyV2CompleteLessonIds,
  type CompleteGuideLessonId,
  type ImportGuideLessonId,
  type ImportGuidePhase,
} from "./guideLessons";

export type { CompleteGuideLessonId, ImportGuideLessonId, ImportGuidePhase } from "./guideLessons";

export const QUICK_START_GUIDE_STORAGE_KEY = "financa-quick-start-guide";
export const QUICK_START_GUIDE_VERSION = 3;

export type QuickStartGuideId = "complete" | "import";
export type QuickStartGuideStatus = "active" | "paused" | "completed" | "dismissed";
export type QuickStartGuideMode = "closed" | "invitation" | "tour";

export type CompleteGuideProgress = {
  status: QuickStartGuideStatus;
  lessonId: CompleteGuideLessonId;
};

export type ImportGuideProgress = {
  status: QuickStartGuideStatus;
  phase: ImportGuidePhase;
  lessonId: ImportGuideLessonId;
};

export type StoredQuickStartGuide = {
  version: typeof QUICK_START_GUIDE_VERSION;
  complete: CompleteGuideProgress;
  import?: ImportGuideProgress;
};

type LegacyStoredQuickStartGuideV1 = {
  version: 1;
  status: "pending" | "completed" | "dismissed";
};

type LegacyStoredQuickStartGuideV2 = {
  version: 2;
  complete: {
    status: QuickStartGuideStatus;
    stepIndex: number;
  };
  import?: {
    status: QuickStartGuideStatus;
    phase: ImportGuidePhase;
  };
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
  goToLesson: (lessonId: CompleteGuideLessonId) => void;
  goToImportLesson: (lessonId: ImportGuideLessonId) => void;
  setImportPhase: (phase: ImportGuidePhase) => void;
};

const DEFAULT_COMPLETE_PROGRESS: CompleteGuideProgress = {
  status: "paused",
  lessonId: DEFAULT_COMPLETE_GUIDE_LESSON_ID,
};
const DEFAULT_IMPORT_PROGRESS: ImportGuideProgress = {
  status: "paused",
  phase: "choose",
  lessonId: defaultImportLessonByPhase.choose,
};
const validStatuses: ReadonlyArray<QuickStartGuideStatus> = ["active", "paused", "completed", "dismissed"];
const validImportPhases: ReadonlyArray<ImportGuidePhase> = ["choose", "configure", "review", "confirm", "success"];

function isStatus(value: unknown): value is QuickStartGuideStatus {
  return validStatuses.includes(value as QuickStartGuideStatus);
}

function isImportPhase(value: unknown): value is ImportGuidePhase {
  return validImportPhases.includes(value as ImportGuidePhase);
}

function normalizeLegacyStepIndex(value: unknown) {
  if (typeof value !== "number" || !Number.isInteger(value)) return 0;
  return Math.max(0, Math.min(value, legacyV2CompleteLessonIds.length - 1));
}

function normalizeImportLesson(phase: ImportGuidePhase, lessonId: unknown) {
  return isImportGuideLessonId(lessonId) && importGuidePhaseForLesson(lessonId) === phase
    ? lessonId
    : defaultImportLessonByPhase[phase];
}

function migrateLegacyGuideV1(value: LegacyStoredQuickStartGuideV1): StoredQuickStartGuide {
  const status: QuickStartGuideStatus =
    value.status === "pending" ? "paused" : value.status === "completed" ? "completed" : "dismissed";
  return {
    version: QUICK_START_GUIDE_VERSION,
    complete: { status, lessonId: DEFAULT_COMPLETE_GUIDE_LESSON_ID },
  };
}

function migrateLegacyGuideV2(value: LegacyStoredQuickStartGuideV2): StoredQuickStartGuide | undefined {
  if (!value.complete || !isStatus(value.complete.status)) return undefined;
  const stepIndex = normalizeLegacyStepIndex(value.complete.stepIndex);
  let importProgress: ImportGuideProgress | undefined;
  if (value.import !== undefined) {
    if (!isStatus(value.import.status) || !isImportPhase(value.import.phase)) return undefined;
    importProgress = {
      status: value.import.status,
      phase: value.import.phase,
      lessonId: defaultImportLessonByPhase[value.import.phase],
    };
  }
  if (value.complete.status === "active" && importProgress?.status === "active") {
    importProgress = { ...importProgress, status: "paused" };
  }
  return {
    version: QUICK_START_GUIDE_VERSION,
    complete: { status: value.complete.status, lessonId: legacyV2CompleteLessonIds[stepIndex] },
    ...(importProgress ? { import: importProgress } : {}),
  };
}

function parseStoredGuide(raw: string): StoredQuickStartGuide | undefined {
  try {
    const value = JSON.parse(raw) as Record<string, unknown>;
    if (
      value.version === 1 &&
      (value.status === "pending" || value.status === "completed" || value.status === "dismissed")
    ) {
      return migrateLegacyGuideV1(value as LegacyStoredQuickStartGuideV1);
    }
    if (value.version === 2) return migrateLegacyGuideV2(value as unknown as LegacyStoredQuickStartGuideV2);
    if (value.version !== QUICK_START_GUIDE_VERSION || !value.complete || typeof value.complete !== "object") {
      return undefined;
    }

    const complete = value.complete as Record<string, unknown>;
    if (!isStatus(complete.status) || !isCompleteGuideLessonId(complete.lessonId)) return undefined;

    let importProgress: ImportGuideProgress | undefined;
    if (value.import !== undefined) {
      if (!value.import || typeof value.import !== "object") return undefined;
      const candidate = value.import as Record<string, unknown>;
      if (!isStatus(candidate.status) || !isImportPhase(candidate.phase)) return undefined;
      importProgress = {
        status: candidate.status,
        phase: candidate.phase,
        lessonId: normalizeImportLesson(candidate.phase, candidate.lessonId),
      };
    }

    if (complete.status === "active" && importProgress?.status === "active") {
      importProgress = { ...importProgress, status: "paused" };
    }
    return {
      version: QUICK_START_GUIDE_VERSION,
      complete: { status: complete.status, lessonId: complete.lessonId },
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
    const version = (JSON.parse(raw) as { version?: unknown }).version;
    if (stored && version !== QUICK_START_GUIDE_VERSION) {
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
    import: { status: "paused", phase: "choose", lessonId: defaultImportLessonByPhase.choose },
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
        () =>
          guide === "complete"
            ? { status: "active", lessonId: DEFAULT_COMPLETE_GUIDE_LESSON_ID }
            : { status: "active", phase: "choose", lessonId: defaultImportLessonByPhase.choose },
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
        () =>
          guide === "complete"
            ? { status: "active", lessonId: DEFAULT_COMPLETE_GUIDE_LESSON_ID }
            : { status: "active", phase: "choose", lessonId: defaultImportLessonByPhase.choose },
        guide,
        "tour",
      ),
    goToLesson: (lessonId) =>
      set((state) => {
        const guides: Omit<StoredQuickStartGuide, "version"> = {
          ...state.guides,
          complete: { status: "active", lessonId },
          ...(state.guides.import?.status === "active"
            ? { import: { ...state.guides.import, status: "paused" as const } }
            : {}),
        };
        writeStoredGuide(guides);
        return { guides, activeGuide: "complete", mode: "tour" };
      }),
    goToImportLesson: (lessonId) =>
      set((state) => {
        const phase = importGuidePhaseForLesson(lessonId);
        const guides: Omit<StoredQuickStartGuide, "version"> = {
          ...state.guides,
          complete:
            state.guides.complete.status === "active"
              ? { ...state.guides.complete, status: "paused" as const }
              : state.guides.complete,
          import: { status: "active", phase, lessonId },
        };
        writeStoredGuide(guides);
        return { guides, activeGuide: "import", mode: "tour" };
      }),
    setImportPhase: (phase) =>
      set((state) => {
        const currentImport = state.guides.import;
        const lessonId =
          currentImport?.phase === phase
            ? normalizeImportLesson(phase, currentImport.lessonId)
            : defaultImportLessonByPhase[phase];
        const guides = {
          ...state.guides,
          complete:
            state.guides.complete.status === "active"
              ? { ...state.guides.complete, status: "paused" as const }
              : state.guides.complete,
          import: { status: "active" as const, phase, lessonId },
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
    complete: { status: "paused" as const, lessonId: DEFAULT_COMPLETE_GUIDE_LESSON_ID },
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
