// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  QUICK_START_GUIDE_STORAGE_KEY,
  QUICK_START_GUIDE_VERSION,
  queueQuickStartGuide,
  resetQuickStartGuideForTests,
  restartQuickStartGuide,
  storedQuickStartGuideState,
  storedQuickStartGuideStatus,
  useQuickStartGuide,
} from "./quickStartGuide";

describe("quickStartGuide state", () => {
  beforeEach(() => {
    localStorage.clear();
    resetQuickStartGuideForTests();
  });

  it("queues only an explicit new-onboarding invitation", () => {
    expect(useQuickStartGuide.getState().mode).toBe("closed");
    expect(storedQuickStartGuideStatus()).toBeUndefined();

    queueQuickStartGuide();

    expect(useQuickStartGuide.getState().mode).toBe("invitation");
    expect(storedQuickStartGuideState()).toEqual({
      version: QUICK_START_GUIDE_VERSION,
      complete: { status: "paused", lessonId: "import-source" },
    });
  });

  it("lets the user postpone the invitation without dismissing the tutorial", () => {
    queueQuickStartGuide();

    useQuickStartGuide.getState().pause("complete");

    expect(useQuickStartGuide.getState().mode).toBe("closed");
    expect(storedQuickStartGuideState()?.complete.status).toBe("paused");
  });

  it.each([
    ["pending", "paused"],
    ["completed", "completed"],
    ["dismissed", "dismissed"],
  ] as const)("migrates a v1 %s record to v3", (legacyStatus, expectedStatus) => {
    localStorage.setItem(QUICK_START_GUIDE_STORAGE_KEY, JSON.stringify({ version: 1, status: legacyStatus }));

    resetQuickStartGuideForTests();

    expect(storedQuickStartGuideState()).toEqual({
      version: 3,
      complete: { status: expectedStatus, lessonId: "import-source" },
    });
    expect(JSON.parse(localStorage.getItem(QUICK_START_GUIDE_STORAGE_KEY) ?? "")).toEqual({
      version: 3,
      complete: { status: expectedStatus, lessonId: "import-source" },
    });
  });

  it.each([
    [0, "import-source"],
    [1, "transactions-filters"],
    [2, "overview-month"],
    [3, "reports-filters"],
    [4, "settings-backup"],
  ] as const)("migrates the v2 step %s to %s", (stepIndex, lessonId) => {
    localStorage.setItem(
      QUICK_START_GUIDE_STORAGE_KEY,
      JSON.stringify({
        version: 2,
        complete: { status: "paused", stepIndex },
        import: { status: "paused", phase: "review" },
      }),
    );

    resetQuickStartGuideForTests();

    expect(storedQuickStartGuideState()).toEqual({
      version: 3,
      complete: { status: "paused", lessonId },
      import: { status: "paused", phase: "review", lessonId: "review-summary" },
    });
  });

  it("ignores missing or invalid records for existing users", () => {
    localStorage.setItem(QUICK_START_GUIDE_STORAGE_KEY, "invalid-json");
    resetQuickStartGuideForTests();
    expect(useQuickStartGuide.getState().mode).toBe("closed");

    localStorage.setItem(QUICK_START_GUIDE_STORAGE_KEY, JSON.stringify({ version: 99, status: "pending" }));
    resetQuickStartGuideForTests();
    expect(useQuickStartGuide.getState().mode).toBe("closed");

    localStorage.setItem(
      QUICK_START_GUIDE_STORAGE_KEY,
      JSON.stringify({
        version: 3,
        complete: { status: "paused", lessonId: "unknown" },
      }),
    );
    resetQuickStartGuideForTests();
    expect(useQuickStartGuide.getState().mode).toBe("closed");
  });

  it("persists progress, pause, resume, completion and restart", () => {
    restartQuickStartGuide();
    useQuickStartGuide.getState().goToLesson("settings-backup");
    expect(storedQuickStartGuideState()?.complete).toEqual({
      status: "active",
      lessonId: "settings-backup",
    });

    useQuickStartGuide.getState().pause("complete");
    expect(storedQuickStartGuideState()?.complete).toEqual({
      status: "paused",
      lessonId: "settings-backup",
    });
    expect(useQuickStartGuide.getState().activeGuide).toBeNull();

    resetQuickStartGuideForTests();
    expect(useQuickStartGuide.getState().mode).toBe("invitation");
    expect(useQuickStartGuide.getState().guides.complete.lessonId).toBe("settings-backup");

    useQuickStartGuide.getState().resume("complete");
    expect(useQuickStartGuide.getState().activeGuide).toBe("complete");
    expect(storedQuickStartGuideState()?.complete).toEqual({
      status: "active",
      lessonId: "settings-backup",
    });

    useQuickStartGuide.getState().complete("complete");
    expect(storedQuickStartGuideState()?.complete.status).toBe("completed");

    restartQuickStartGuide();
    expect(storedQuickStartGuideState()?.complete).toEqual({
      status: "active",
      lessonId: "import-source",
    });
  });

  it("restores the active guide and its persisted lesson", () => {
    restartQuickStartGuide();
    useQuickStartGuide.getState().goToLesson("reports-insights");

    resetQuickStartGuideForTests();

    expect(useQuickStartGuide.getState().activeGuide).toBe("complete");
    expect(useQuickStartGuide.getState().mode).toBe("tour");
    expect(useQuickStartGuide.getState().guides.complete).toEqual({
      status: "active",
      lessonId: "reports-insights",
    });
  });

  it("restarts an interrupted import tutorial without restoring an ephemeral session", () => {
    useQuickStartGuide.getState().start("import");
    useQuickStartGuide.getState().setImportPhase("review");
    useQuickStartGuide.getState().goToImportLesson("review-all");

    resetQuickStartGuideForTests();

    expect(useQuickStartGuide.getState().activeGuide).toBeNull();
    expect(useQuickStartGuide.getState().guides.import).toEqual({
      status: "paused",
      phase: "choose",
      lessonId: "choose-files",
    });
  });

  it("keeps complete and import progress independent while allowing only one active guide", () => {
    const guide = useQuickStartGuide.getState();
    guide.start("complete");
    guide.goToLesson("reports-filters");
    useQuickStartGuide.getState().start("import");

    expect(useQuickStartGuide.getState().activeGuide).toBe("import");
    expect(storedQuickStartGuideState()).toEqual({
      version: 3,
      complete: { status: "paused", lessonId: "reports-filters" },
      import: { status: "active", phase: "choose", lessonId: "choose-files" },
    });

    useQuickStartGuide.getState().setImportPhase("review");
    useQuickStartGuide.getState().goToImportLesson("review-categories");
    useQuickStartGuide.getState().dismiss("import");
    expect(storedQuickStartGuideState()?.import).toEqual({
      status: "dismissed",
      phase: "review",
      lessonId: "review-categories",
    });

    useQuickStartGuide.getState().restart("import");
    expect(storedQuickStartGuideState()?.import).toEqual({
      status: "active",
      phase: "choose",
      lessonId: "choose-files",
    });
  });

  it("resets to the first lesson whenever the real import phase changes", () => {
    useQuickStartGuide.getState().start("import");
    useQuickStartGuide.getState().setImportPhase("review");
    useQuickStartGuide.getState().goToImportLesson("review-all");

    useQuickStartGuide.getState().setImportPhase("confirm");

    expect(useQuickStartGuide.getState().guides.import).toEqual({
      status: "active",
      phase: "confirm",
      lessonId: "confirm-pending",
    });
  });

  it("keeps working in memory when local storage cannot be written", () => {
    const setItem = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("storage unavailable");
    });

    queueQuickStartGuide();

    expect(useQuickStartGuide.getState().mode).toBe("invitation");
    setItem.mockRestore();
  });
});
