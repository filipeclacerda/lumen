// @vitest-environment jsdom

import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useMaintenanceRestart } from "../maintenanceRestart";
import { MaintenanceRestartNotice } from "./MaintenanceRestartNotice";

const mocks = vi.hoisted(() => ({ relaunch: vi.fn(), toast: vi.fn() }));

vi.mock("@tauri-apps/plugin-process", () => ({ relaunch: mocks.relaunch }));
vi.mock("./toast", () => ({ useToast: () => mocks.toast }));

describe("MaintenanceRestartNotice", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    useMaintenanceRestart.getState().clearForTests();
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it("keeps the global lock visible when automatic relaunch fails", async () => {
    mocks.relaunch.mockRejectedValue(new Error("indisponível"));
    useMaintenanceRestart.getState().requireRestart("restore");
    render(<MaintenanceRestartNotice />);

    await act(async () => vi.advanceTimersByTimeAsync(900));

    expect(mocks.relaunch).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("dialog", { name: "Restauração preparada" })).toBeTruthy();
    expect(useMaintenanceRestart.getState().reason).toBe("restore");
    expect(mocks.toast).toHaveBeenCalledWith(expect.stringContaining("Feche e abra o Lumen"), "error");
  });
});
