// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DatePicker, MonthPicker } from "./CalendarPicker";

describe("CalendarPicker", () => {
  afterEach(() => cleanup());

  it("selects a date from the calendar without relying on a native input", () => {
    const onChange = vi.fn();

    render(<DatePicker ariaLabel="Selecionar data" value="2026-07-22" onChange={onChange} />);
    fireEvent.click(screen.getByRole("button", { name: "Selecionar data" }));

    const picker = screen.getByRole("dialog", { name: "Selecionar data" });
    fireEvent.click(within(picker).getByText("15", { selector: "button" }));

    expect(onChange).toHaveBeenCalledWith("2026-07-15");
    expect(screen.queryByRole("dialog", { name: "Selecionar data" })).toBeNull();
  });

  it("selects and clears a month", () => {
    const onChange = vi.fn();

    render(<MonthPicker ariaLabel="Selecionar mês" value="2026-07" onChange={onChange} />);
    fireEvent.click(screen.getByRole("button", { name: "Selecionar mês" }));

    const picker = screen.getByRole("dialog", { name: "Selecionar mês" });
    fireEvent.click(within(picker).getByText("jun", { selector: "button" }));
    expect(onChange).toHaveBeenCalledWith("2026-06");

    render(<MonthPicker ariaLabel="Limpar mês" value="2026-07" onChange={onChange} />);
    fireEvent.click(screen.getByRole("button", { name: "Limpar mês" }));
    fireEvent.click(screen.getByRole("button", { name: "Limpar" }));
    expect(onChange).toHaveBeenLastCalledWith("");
  });
});
