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
      complete: { status: "paused", stepIndex: 0 },
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
  ] as const)("migrates a v1 %s record to v2", (legacyStatus, expectedStatus) => {
    localStorage.setItem(QUICK_START_GUIDE_STORAGE_KEY, JSON.stringify({ version: 1, status: legacyStatus }));

    resetQuickStartGuideForTests();

    expect(storedQuickStartGuideState()).toEqual({
      version: 2,
      complete: { status: expectedStatus, stepIndex: 0 },
    });
    expect(JSON.parse(localStorage.getItem(QUICK_START_GUIDE_STORAGE_KEY) ?? "")).toEqual({
      version: 2,
      complete: { status: expectedStatus, stepIndex: 0 },
    });
  });

  it("ignores missing or invalid records for existing users", () => {
    localStorage.setItem(QUICK_START_GUIDE_STORAGE_KEY, "invalid-json");
    resetQuickStartGuideForTests();
    expect(useQuickStartGuide.getState().mode).toBe("closed");

    localStorage.setItem(QUICK_START_GUIDE_STORAGE_KEY, JSON.stringify({ version: 99, status: "pending" }));
    resetQuickStartGuideForTests();
    expect(useQuickStartGuide.getState().mode).toBe("closed");
  });

  it("persists progress, pause, resume, completion and restart", () => {
    restartQuickStartGuide();
    useQuickStartGuide.getState().goToStep(4);
    expect(storedQuickStartGuideState()?.complete).toEqual({ status: "active", stepIndex: 4 });

    useQuickStartGuide.getState().pause("complete");
    expect(storedQuickStartGuideState()?.complete).toEqual({ status: "paused", stepIndex: 4 });
    expect(useQuickStartGuide.getState().activeGuide).toBeNull();

    resetQuickStartGuideForTests();
    expect(useQuickStartGuide.getState().mode).toBe("invitation");
    expect(useQuickStartGuide.getState().guides.complete.stepIndex).toBe(4);

    useQuickStartGuide.getState().resume("complete");
    expect(useQuickStartGuide.getState().activeGuide).toBe("complete");
    expect(storedQuickStartGuideState()?.complete).toEqual({ status: "active", stepIndex: 4 });

    useQuickStartGuide.getState().complete("complete");
    expect(storedQuickStartGuideState()?.complete.status).toBe("completed");

    restartQuickStartGuide();
    expect(storedQuickStartGuideState()?.complete).toEqual({ status: "active", stepIndex: 0 });
  });

  it("restores the active guide and its persisted progress", () => {
    restartQuickStartGuide();
    useQuickStartGuide.getState().goToStep(99);

    resetQuickStartGuideForTests();

    expect(useQuickStartGuide.getState().activeGuide).toBe("complete");
    expect(useQuickStartGuide.getState().mode).toBe("tour");
    expect(useQuickStartGuide.getState().guides.complete).toEqual({ status: "active", stepIndex: 4 });
  });

  it("restarts an interrupted import tutorial without restoring an ephemeral session", () => {
    useQuickStartGuide.getState().start("import");
    useQuickStartGuide.getState().setImportPhase("review");

    resetQuickStartGuideForTests();

    expect(useQuickStartGuide.getState().activeGuide).toBeNull();
    expect(useQuickStartGuide.getState().guides.import).toEqual({ status: "paused", phase: "choose" });
  });

  it("keeps complete and import progress independent while allowing only one active guide", () => {
    const guide = useQuickStartGuide.getState();
    guide.start("complete");
    guide.goToStep(3);
    useQuickStartGuide.getState().start("import");

    expect(useQuickStartGuide.getState().activeGuide).toBe("import");
    expect(storedQuickStartGuideState()).toEqual({
      version: 2,
      complete: { status: "paused", stepIndex: 3 },
      import: { status: "active", phase: "choose" },
    });

    useQuickStartGuide.getState().setImportPhase("review");
    useQuickStartGuide.getState().dismiss("import");
    expect(storedQuickStartGuideState()?.import).toEqual({ status: "dismissed", phase: "review" });

    useQuickStartGuide.getState().restart("import");
    expect(storedQuickStartGuideState()?.import).toEqual({ status: "active", phase: "choose" });
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
