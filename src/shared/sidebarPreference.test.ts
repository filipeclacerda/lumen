// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import { getSidebarCollapsed, setSidebarCollapsed } from "./sidebarPreference";

describe("sidebar preference", () => {
  beforeEach(() => localStorage.clear());

  it("starts expanded when the preference is absent or invalid", () => {
    expect(getSidebarCollapsed()).toBe(false);

    localStorage.setItem("financa-sidebar-collapsed", "invalid");
    expect(getSidebarCollapsed()).toBe(false);
  });

  it("persists both collapsed and expanded states", () => {
    setSidebarCollapsed(true);
    expect(getSidebarCollapsed()).toBe(true);

    setSidebarCollapsed(false);
    expect(getSidebarCollapsed()).toBe(false);
  });
});
