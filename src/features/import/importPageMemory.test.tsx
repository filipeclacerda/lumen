// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { clearImportPageMemory, useImportPageMemoryState } from "./importPageMemory";

function DraftProbe() {
  const [path, setPath] = useImportPageMemoryState("path", "");
  return <button onClick={() => setPath("C:/faturas/agosto.csv")}>{path || "Selecionar"}</button>;
}

afterEach(() => {
  cleanup();
  clearImportPageMemory();
});

describe("memória temporária da importação", () => {
  it("restaura o rascunho depois que a tela é desmontada e montada novamente", () => {
    const firstRender = render(<DraftProbe />);
    fireEvent.click(screen.getByRole("button", { name: "Selecionar" }));
    expect(screen.getByRole("button", { name: "C:/faturas/agosto.csv" })).toBeTruthy();

    firstRender.unmount();
    render(<DraftProbe />);

    expect(screen.getByRole("button", { name: "C:/faturas/agosto.csv" })).toBeTruthy();
  });

  it("descarta o rascunho somente quando a memória é limpa explicitamente", () => {
    const firstRender = render(<DraftProbe />);
    fireEvent.click(screen.getByRole("button", { name: "Selecionar" }));
    firstRender.unmount();
    clearImportPageMemory();

    render(<DraftProbe />);

    expect(screen.getByRole("button", { name: "Selecionar" })).toBeTruthy();
  });
});
