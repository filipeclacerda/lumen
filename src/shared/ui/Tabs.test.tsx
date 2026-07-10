// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { Tabs } from "./Tabs";
describe("Tabs", () => {
  afterEach(() => cleanup());
  it("omits aria-controls when the consumer owns the panel", () => {
    render(
      <Tabs
        hidePanel
        tabs={[
          { id: "one", label: "Um" },
          { id: "two", label: "Dois" },
        ]}
      />,
    );
    expect(screen.getByRole("tab", { name: "Um" }).hasAttribute("aria-controls")).toBe(false);
    expect(screen.queryByRole("tabpanel")).toBeNull();
  });

  it("supports tab semantics and arrow navigation", () => {
    render(
      <Tabs
        tabs={[
          { id: "one", label: "Um", content: <p>Primeiro</p> },
          { id: "two", label: "Dois", content: <p>Segundo</p> },
        ]}
      />,
    );
    const first = screen.getByRole("tab", { name: "Um" });
    fireEvent.keyDown(first, { key: "ArrowRight" });
    expect(screen.getByRole("tab", { name: "Dois" }).getAttribute("aria-selected")).toBe("true");
    expect(screen.getByText("Segundo")).toBeTruthy();
  });
});
