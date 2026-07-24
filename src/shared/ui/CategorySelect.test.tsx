// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Category } from "../types";
import { CategorySelect } from "./CategorySelect";

const categories: Category[] = [
  { id: "food", name: "Alimentação", kind: "expense", sortOrder: 0, isSystem: false },
  {
    id: "groceries",
    parentId: "food",
    name: "Supermercado",
    kind: "expense",
    sortOrder: 1,
    isSystem: false,
  },
  {
    id: "restaurants",
    parentId: "food",
    name: "Restaurantes",
    kind: "expense",
    sortOrder: 2,
    isSystem: false,
  },
  { id: "bakery", parentId: "food", name: "Padaria", kind: "expense", sortOrder: 3, isSystem: false },
  { id: "housing", name: "Moradia", kind: "expense", sortOrder: 10, isSystem: false },
  { id: "transport", name: "Transporte", kind: "expense", sortOrder: 20, isSystem: false },
  { id: "leisure", name: "Lazer", kind: "expense", sortOrder: 30, isSystem: false },
  { id: "salary", name: "Salário", kind: "income", sortOrder: 40, isSystem: false },
];

afterEach(cleanup);

function openSelect(label = "Categoria") {
  fireEvent.click(screen.getByRole("button", { name: label }));
  return screen.getByRole("listbox", { name: label });
}

describe("CategorySelect", () => {
  it("renders the current option in a viewport portal and keeps it interactive", () => {
    const onChange = vi.fn();
    const { container } = render(
      <div style={{ overflow: "hidden" }}>
        <CategorySelect value="food" categories={categories} onChange={onChange} />
      </div>,
    );

    const listbox = openSelect();
    const panel = listbox.closest(".category-dropdown-panel");
    expect(panel?.parentElement).toBe(document.body);
    expect((panel as HTMLElement).style.position).toBe("fixed");
    expect(within(listbox).getAllByRole("option")).toHaveLength(2);

    fireEvent.click(within(listbox).getByRole("option", { name: "Alimentação" }));
    expect(onChange).toHaveBeenCalledWith("food");
    expect(container.querySelector(".category-dropdown-panel")).toBeNull();
  });

  it("navigates progressively with at most three category options per state", () => {
    const onChange = vi.fn();
    render(<CategorySelect value="food" categories={categories} onChange={onChange} allowEmpty={false} />);

    const listbox = openSelect();
    expect(within(listbox).getAllByRole("option")).toHaveLength(1);

    fireEvent.click(within(listbox).getByRole("button", { name: "Outra categoria" }));
    expect(within(listbox).getAllByRole("option")).toHaveLength(3);
    expect(within(listbox).queryByRole("option", { name: "Lazer" })).toBeNull();

    fireEvent.click(within(listbox).getByRole("option", { name: "Alimentação" }));
    expect(within(listbox).getAllByRole("option")).toHaveLength(3);
    expect(within(listbox).getByRole("option", { name: "Alimentação" })).toBeTruthy();
    expect(within(listbox).getByRole("option", { name: "Supermercado" })).toBeTruthy();
    expect(within(listbox).getByRole("option", { name: "Restaurantes" })).toBeTruthy();
    expect(within(listbox).queryByRole("option", { name: "Padaria" })).toBeNull();

    fireEvent.click(within(listbox).getByRole("button", { name: "Subcategorias: próxima página" }));
    expect(within(listbox).getAllByRole("option")).toHaveLength(2);
    fireEvent.click(within(listbox).getByRole("option", { name: "Padaria" }));
    expect(onChange).toHaveBeenCalledWith("bakery");
  });

  it("paginates root families three at a time", () => {
    render(
      <CategorySelect
        categories={categories}
        kind="expense"
        onChange={vi.fn()}
        allowEmpty={false}
        aria-label="Categoria famílias"
      />,
    );

    const listbox = openSelect("Categoria famílias");
    fireEvent.click(within(listbox).getByRole("button", { name: "Outra categoria" }));
    expect(within(listbox).getAllByRole("option")).toHaveLength(3);

    fireEvent.click(within(listbox).getByRole("button", { name: "Famílias: próxima página" }));
    expect(within(listbox).getAllByRole("option")).toHaveLength(1);
    expect(within(listbox).getByRole("option", { name: "Lazer" })).toBeTruthy();
  });

  it("searches without accents or punctuation, shows full paths and paginates three results", () => {
    render(
      <CategorySelect categories={categories} onChange={vi.fn()} allowEmpty={false} aria-label="Categoria busca" />,
    );

    const listbox = openSelect("Categoria busca");
    const search = screen.getByRole("textbox", { name: "Buscar categoria" });

    fireEvent.change(search, { target: { value: "alimentacao / supermercado" } });
    expect(within(listbox).getAllByRole("option")).toHaveLength(1);
    expect(within(listbox).getByRole("option", { name: "Alimentação › Supermercado" })).toBeTruthy();

    fireEvent.change(search, { target: { value: "a" } });
    expect(within(listbox).getAllByRole("option")).toHaveLength(3);
    expect(within(listbox).getByRole("button", { name: "Resultados: próxima página" })).toBeTruthy();
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
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Outra categoria" }));

    fireEvent.keyDown(document.activeElement!, { key: "Escape" });
    await waitFor(() => expect(document.activeElement).toBe(trigger));
    expect(screen.queryByRole("listbox", { name: "Categoria teclado" })).toBeNull();
  });
});
