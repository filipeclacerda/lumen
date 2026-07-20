// @vitest-environment jsdom

import { beforeEach, describe, expect, it } from "vitest";
import { useMaintenanceRestart } from "./maintenanceRestart";

describe("maintenance restart lock", () => {
  beforeEach(() => useMaintenanceRestart.getState().clearForTests());

  it("persists a prepared restore for renderer reload safety", () => {
    useMaintenanceRestart.getState().requireRestart("restore");

    expect(useMaintenanceRestart.getState().reason).toBe("restore");
    expect(sessionStorage.getItem("lumen-maintenance-restart-v1")).toBe("restore");
  });

  it("clears only through the test/reset hook", () => {
    useMaintenanceRestart.getState().requireRestart("reset");
    useMaintenanceRestart.getState().clearForTests();

    expect(useMaintenanceRestart.getState().reason).toBeNull();
    expect(sessionStorage.getItem("lumen-maintenance-restart-v1")).toBeNull();
  });
});
