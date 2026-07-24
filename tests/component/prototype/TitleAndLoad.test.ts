// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from "@testing-library/svelte";
import { userEvent } from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import LoadScreen from "../../../src/prototype/screens/LoadScreen.svelte";
import TitleScreen from "../../../src/prototype/screens/TitleScreen.svelte";

afterEach(() => cleanup());

describe("title and mock load", () => {
  it("renders title actions, conditionally shows Continue, focuses primary action", async () => {
    const onnewgame = vi.fn();
    const rendered = render(TitleScreen, { hasProgress: false, onnewgame });
    expect(screen.getByRole("button", { name: "New Game" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Load" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Settings" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Continue" })).toBeNull();
    await waitFor(() =>
      expect(document.activeElement?.textContent).toBe("New Game"),
    );
    await userEvent
      .setup()
      .click(screen.getByRole("button", { name: "New Game" }));
    expect(onnewgame).toHaveBeenCalledOnce();
    await rendered.rerender({ hasProgress: true });
    expect(screen.getByRole("button", { name: "Continue" })).toBeTruthy();
  });

  it("shows complete slot summaries plus reviewer corrupt state", () => {
    render(LoadScreen, { showCorrupt: true });
    expect(screen.getByText("Manual slot 1")).toBeTruthy();
    expect(screen.getByText("Autosave")).toBeTruthy();
    expect(screen.getByText("Empty slot")).toBeTruthy();
    expect(screen.getByText(/Chapter 1 · Old Arena/)).toBeTruthy();
    expect(screen.getByText(/00:18:42/)).toBeTruthy();
    expect(screen.getByText(/Yesterday/)).toBeTruthy();
    expect(screen.getAllByText(/preview/i)).toHaveLength(2);
    expect(screen.getByText(/incompatible or corrupt/i)).toBeTruthy();
  });

  it("loads occupied slots, confirms delete, and invokes Back", async () => {
    const onload = vi.fn();
    const ondelete = vi.fn(() => true);
    const onback = vi.fn();
    render(LoadScreen, { onload, ondelete, onback });
    const user = userEvent.setup();
    await user.click(
      screen.getByRole("button", { name: "Load manual slot 1" }),
    );
    expect(onload).toHaveBeenCalledWith("manual");
    await user.click(screen.getByRole("button", { name: "Load autosave" }));
    expect(onload).toHaveBeenCalledWith("autosave");
    await user.click(
      screen.getByRole("button", { name: "Delete manual slot 1" }),
    );
    expect(
      screen.getByRole("alertdialog", { name: "Delete save?" }),
    ).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Cancel delete" }));
    await waitFor(() =>
      expect(document.activeElement?.textContent).toContain("Delete manual"),
    );
    await user.click(
      screen.getByRole("button", { name: "Delete manual slot 1" }),
    );
    await user.click(screen.getByRole("button", { name: "Delete save" }));
    expect(ondelete).toHaveBeenCalledOnce();
    expect(
      screen.getByRole("heading", { name: "Manual slot 1 · Empty" }),
    ).toBeTruthy();
    expect(
      (
        screen.getByRole("button", {
          name: "Load manual slot 1",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
    await user.click(screen.getByRole("button", { name: "Back" }));
    expect(onback).toHaveBeenCalledOnce();
  });
});
