import { describe, expect, it } from "vitest";
import { navigation, navigationGroups, settingsNavigation } from "./navigation";

describe("navigation", () => {
  it("keeps every grouped route unique and exposes settings in the flat navigation", () => {
    const groupedRoutes = navigationGroups.flatMap((group) => group.items.map((item) => item.to));
    const flatRoutes = navigation.map((item) => item.to);

    expect(new Set(groupedRoutes).size).toBe(groupedRoutes.length);
    expect(flatRoutes).toEqual([...groupedRoutes, settingsNavigation.to]);
    expect(flatRoutes).toContain("/settings");
  });
});
