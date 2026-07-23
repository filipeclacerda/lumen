// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
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

afterEach(cleanup);

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

  it("supports arrow navigation and restores focus when dismissed", async () => {
    render(
      <CategorySelect categories={categories} onChange={vi.fn()} allowEmpty={false} aria-label="Categoria teclado" />,
    );
    const trigger = screen.getByRole("button", { name: "Categoria teclado" });

    fireEvent.keyDown(trigger, { key: "ArrowDown" });
    const search = await screen.findByRole("textbox", { name: "Buscar categoria" });
    await waitFor(() => expect(document.activeElement).toBe(search));

    fireEvent.keyDown(search, { key: "ArrowDown" });
    expect(document.activeElement).toBe(screen.getByRole("option", { name: "Alimentacao" }));

    fireEvent.keyDown(document.activeElement!, { key: "Escape" });
    await waitFor(() => expect(document.activeElement).toBe(trigger));
    expect(screen.queryByRole("listbox", { name: "Categoria teclado" })).toBeNull();
  });
});
