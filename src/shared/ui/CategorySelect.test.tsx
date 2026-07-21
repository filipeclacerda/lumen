// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { Category } from "../types";
import { CategorySelect } from "./CategorySelect";

const categories: Category[] = [
  {
    id: "food",
    name: "Alimentacao",
    kind: "expense",
    sortOrder: 0,
    isSystem: false,
  },
];

describe("CategorySelect", () => {
  it("renders the options in a viewport portal and keeps them interactive", () => {
    const onChange = vi.fn();
    const { container } = render(
      <div style={{ overflow: "hidden" }}>
        <CategorySelect value="food" categories={categories} onChange={onChange} />
      </div>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Categoria" }));

    const listbox = screen.getByRole("listbox", { name: "Categoria" });
    const panel = listbox.closest(".category-dropdown-panel");
    expect(panel?.parentElement).toBe(document.body);
    expect((panel as HTMLElement).style.position).toBe("fixed");

    fireEvent.mouseDown(screen.getByRole("option", { name: "Alimentacao" }));
    fireEvent.click(screen.getByRole("option", { name: "Alimentacao" }));
    expect(onChange).toHaveBeenCalledWith("food");
    expect(container.querySelector(".category-dropdown-panel")).toBeNull();
  });
});
