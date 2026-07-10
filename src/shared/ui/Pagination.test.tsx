// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { Pagination, type PaginationSize } from "./Pagination";

function Harness() {
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState<PaginationSize>(10);
  return (
    <Pagination
      page={page}
      pageSize={pageSize}
      totalCount={241}
      onPageChange={setPage}
      onPageSizeChange={(size) => {
        setPageSize(size);
        setPage(0);
      }}
      itemLabel="lançamentos"
    />
  );
}

describe("Pagination", () => {
  afterEach(() => cleanup());

  it("navigates numbered pages and exposes the current page", () => {
    render(<Harness />);
    expect(screen.getByText("1–10 de 241 lançamentos")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Ir para a página 1" }).getAttribute("aria-current")).toBe("page");

    fireEvent.click(screen.getByRole("button", { name: "Próxima página" }));

    expect(screen.getByText("11–20 de 241 lançamentos")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Ir para a página 2" }).getAttribute("aria-current")).toBe("page");
  });

  it("resets to the first page when the page size changes", () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole("button", { name: "Próxima página" }));
    fireEvent.click(screen.getByRole("combobox", { name: "Itens por página" }));
    fireEvent.click(screen.getByRole("option", { name: "25" }));

    expect(screen.getByText("1–25 de 241 lançamentos")).toBeTruthy();
  });
});
