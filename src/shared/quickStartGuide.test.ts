// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  QUICK_START_GUIDE_STORAGE_KEY,
  queueQuickStartGuide,
  resetQuickStartGuideForTests,
  restartQuickStartGuide,
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
    expect(storedQuickStartGuideStatus()).toBe("pending");
  });

  it("ignores missing or invalid records for existing users", () => {
    localStorage.setItem(QUICK_START_GUIDE_STORAGE_KEY, "invalid-json");
    resetQuickStartGuideForTests();
    expect(useQuickStartGuide.getState().mode).toBe("closed");

    localStorage.setItem(QUICK_START_GUIDE_STORAGE_KEY, JSON.stringify({ version: 99, status: "pending" }));
    resetQuickStartGuideForTests();
    expect(useQuickStartGuide.getState().mode).toBe("closed");
  });

  it("persists completed and dismissed outcomes", () => {
    queueQuickStartGuide();
    useQuickStartGuide.getState().complete();
    expect(storedQuickStartGuideStatus()).toBe("completed");

    restartQuickStartGuide();
    expect(useQuickStartGuide.getState().mode).toBe("tour");
    useQuickStartGuide.getState().dismiss();
    expect(storedQuickStartGuideStatus()).toBe("dismissed");
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
