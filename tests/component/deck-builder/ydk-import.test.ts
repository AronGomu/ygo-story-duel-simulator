// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/svelte";
import { userEvent } from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import YdkImport from "../../../src/prototypes/deck-builder/components/YdkImport.svelte";

afterEach(() => cleanup());

describe("YDK import UI", () => {
  it("previews pasted YDK and preserves unknown codes", async () => {
    const user = userEvent.setup();
    const onimport = vi.fn();
    render(YdkImport, { onimport, oncancel: vi.fn() });
    await user.type(
      screen.getByLabelText("Or paste YDK text"),
      "#main{enter}99999999{enter}#extra{enter}!side{enter}",
    );
    await user.click(screen.getByRole("button", { name: "Preview import" }));
    expect(screen.getByText(/Main 1 · Extra 0 · Side 0/)).toBeTruthy();
    expect(screen.getByText("99999999")).toBeTruthy();
    await user.click(
      screen.getByRole("button", { name: "Replace deck cards" }),
    );
    expect(onimport).toHaveBeenCalledWith(
      { main: [99999999], extra: [], side: [] },
      "Imported Deck",
    );
  });

  it("previews file input and warns about duplicate local names", async () => {
    const user = userEvent.setup();
    render(YdkImport, {
      onimport: vi.fn(),
      oncancel: vi.fn(),
      requireName: true,
      existingDeckNames: ["Imported Deck"],
    });
    const file = new File(["#main\n89631139\n#extra\n!side\n"], "deck.ydk", {
      type: "text/plain",
    });
    await user.upload(screen.getByLabelText("Choose .ydk file"), file);
    expect(await screen.findByText(/Main 1 · Extra 0 · Side 0/)).toBeTruthy();
    expect(screen.getByText(/already uses this name/)).toBeTruthy();
  });

  it("invalidates preview when pasted source changes", async () => {
    const user = userEvent.setup();
    render(YdkImport, { onimport: vi.fn(), oncancel: vi.fn() });
    const source = screen.getByLabelText("Or paste YDK text");
    await user.type(source, "#main{enter}1{enter}#extra{enter}!side");
    await user.click(screen.getByRole("button", { name: "Preview import" }));
    expect(
      screen.getByRole("button", { name: "Replace deck cards" }),
    ).toBeTruthy();
    await user.type(source, "{enter}2");
    expect(
      screen.queryByRole("button", { name: "Replace deck cards" }),
    ).toBeNull();
  });

  it("shows exact malformed line and supports Cancel", async () => {
    const user = userEvent.setup();
    const oncancel = vi.fn();
    render(YdkImport, { onimport: vi.fn(), oncancel });
    await user.type(
      screen.getByLabelText("Or paste YDK text"),
      "#main{enter}bad{enter}#extra{enter}!side",
    );
    await user.click(screen.getByRole("button", { name: "Preview import" }));
    expect(screen.getByRole("alert").textContent).toContain("line 2");
    expect(
      screen.getByLabelText("Or paste YDK text").getAttribute("aria-invalid"),
    ).toBe("true");
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(oncancel).toHaveBeenCalledTimes(1);
  });
});
