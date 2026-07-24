// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Category } from "../types";
import { CategorySelect } from "./CategorySelect";

const categories = [
  { id: "food", name: "Alimentação", kind: "expense", sortOrder: 0, isSystem: false },
  { id: "market", parentId: "food", name: "Mercado", kind: "expense", sortOrder: 1, isSystem: false },
  { id: "weekly", parentId: "market", name: "Semanal", kind: "expense", sortOrder: 2, isSystem: false },
  { id: "organic", parentId: "weekly", name: "Orgânicos", kind: "expense", sortOrder: 3, isSystem: false },
  { id: "housing", name: "Moradia", kind: "expense", sortOrder: 10, isSystem: false },
  { id: "housing-market", parentId: "housing", name: "Mercado", kind: "expense", sortOrder: 11, isSystem: false },
  { id: "salary", name: "Salário", kind: "income", sortOrder: 20, isSystem: false },
] satisfies Category[];

afterEach(cleanup);

function openSelect(label = "Categoria") {
  const accessibleName = new RegExp(`^${label}`);
  fireEvent.click(screen.getByRole("button", { name: accessibleName }));
  return screen.getByRole("listbox", { name: accessibleName });
}

describe("CategorySelect", () => {
  it("renders the complete depth-first tree and selects a parent with one click", async () => {
    const onChange = vi.fn();
    render(<CategorySelect value="organic" categories={categories} onChange={onChange} allowEmpty={false} />);

    expect(screen.getByRole("button", { name: "Categoria: Alimentação › Mercado › Semanal › Orgânicos" })).toBeTruthy();
    const listbox = openSelect();
    expect(within(listbox).getAllByRole("option")).toHaveLength(categories.length);
    expect(within(listbox).getByRole("option", { name: "Orgânicos" }).getAttribute("data-depth")).toBe("3");
    expect(within(listbox).getByRole("option", { name: "Alimentação" })).toBeTruthy();

    fireEvent.click(within(listbox).getByRole("option", { name: "Alimentação" }));
    expect(onChange).toHaveBeenCalledOnce();
    expect(onChange).toHaveBeenCalledWith("food");
    expect(screen.queryByRole("listbox", { name: "Categoria" })).toBeNull();
  });

  it("disambiguates homonyms by path and searches full paths without accents or punctuation", () => {
    const onChange = vi.fn();
    render(
      <CategorySelect categories={categories} onChange={onChange} allowEmpty={false} aria-label="Categoria busca" />,
    );

    const listbox = openSelect("Categoria busca");
    expect(within(listbox).getByRole("option", { name: "Alimentação › Mercado" })).toBeTruthy();
    expect(within(listbox).getByRole("option", { name: "Moradia › Mercado" })).toBeTruthy();

    fireEvent.change(screen.getByRole("textbox", { name: "Buscar categoria" }), {
      target: { value: "alimentacao / mercado / semanal / organicos" },
    });
    expect(within(listbox).getAllByRole("option")).toHaveLength(1);
    fireEvent.click(within(listbox).getByRole("option", { name: "Alimentação › Mercado › Semanal › Orgânicos" }));
    expect(onChange).toHaveBeenCalledWith("organic");
  });

  it("preserves native mode and kind/movement filters with real category options", () => {
    const onChange = vi.fn();
    const { rerender } = render(
      <CategorySelect
        native
        categories={categories}
        movementType="income"
        onChange={onChange}
        aria-label="Categoria nativa"
      />,
    );
    const native = screen.getByRole("combobox", { name: "Categoria nativa" });
    fireEvent.click(native);
    expect(screen.getByRole("option", { name: "Salário" })).toBeTruthy();
    expect(screen.queryByRole("option", { name: "Alimentação" })).toBeNull();

    rerender(
      <CategorySelect categories={categories} kind="expense" onChange={onChange} aria-label="Categoria filtrada" />,
    );
    const listbox = openSelect("Categoria filtrada");
    expect(within(listbox).queryByRole("option", { name: "Salário" })).toBeNull();
    expect(within(listbox).getAllByRole("option")).toHaveLength(6);
  });

  it("supports keyboard navigation, Escape focus restore, and closes on focus-out", async () => {
    render(
      <div>
        <CategorySelect categories={categories} onChange={vi.fn()} allowEmpty={false} aria-label="Categoria teclado" />
        <button>Depois</button>
      </div>,
    );
    const trigger = screen.getByRole("button", { name: "Categoria teclado" });

    fireEvent.keyDown(trigger, { key: "ArrowDown" });
    const search = await screen.findByRole("textbox", { name: "Buscar categoria" });
    await waitFor(() => expect(document.activeElement).toBe(search));
    fireEvent.keyDown(search, { key: "ArrowDown" });
    expect(document.activeElement).toBe(screen.getByRole("option", { name: "Salário" }));
    fireEvent.keyDown(document.activeElement!, { key: "Escape" });
    await waitFor(() => expect(document.activeElement).toBe(trigger));

    openSelect("Categoria teclado");
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole("textbox", { name: "Buscar categoria" })));
    fireEvent.focusIn(screen.getByRole("button", { name: "Depois" }));
    expect(screen.queryByRole("listbox", { name: "Categoria teclado" })).toBeNull();
  });

  it("keeps the rich panel in a body portal", () => {
    const { container } = render(
      <div style={{ overflow: "hidden" }}>
        <CategorySelect categories={categories} onChange={vi.fn()} />
      </div>,
    );
    const panel = openSelect().closest(".category-dropdown-panel");
    expect(panel?.parentElement).toBe(document.body);
    expect(container.querySelector(".category-dropdown-panel")).toBeNull();
  });
});
