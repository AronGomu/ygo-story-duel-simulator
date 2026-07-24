// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/svelte";
import { userEvent } from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createInitialPrototypeState,
  type PrototypeState,
} from "../../../src/prototype/model/prototype-state.ts";
import { reducePrototype } from "../../../src/prototype/model/prototype-reducer.ts";
import OutcomeScreen from "../../../src/prototype/screens/OutcomeScreen.svelte";
import RewardScreen from "../../../src/prototype/screens/RewardScreen.svelte";

afterEach(() => cleanup());

describe("outcome and progression", () => {
  it.each(["win", "loss"] as const)(
    "renders authored %s scene and continues",
    async (outcome) => {
      const oncontinue = vi.fn();
      render(OutcomeScreen, { outcome, oncontinue });
      expect(
        screen.getByRole("heading", {
          name: outcome === "win" ? /Signal broken/ : /Signal endures/,
        }),
      ).toBeTruthy();
      await userEvent
        .setup()
        .click(screen.getByRole("button", { name: "Continue story" }));
      expect(oncontinue).toHaveBeenCalledOnce();
    },
  );

  it.each(["abort", "failure"] as const)(
    "renders %s recovery without reward language",
    (outcome) => {
      render(OutcomeScreen, { outcome });
      expect(
        screen.getByText(
          outcome === "abort" ? /Duel paused/ : /Connection interrupted/,
        ),
      ).toBeTruthy();
      expect(screen.queryByText(/reward/i)).toBeNull();
      expect(screen.getByRole("button", { name: "Retry duel" })).toBeTruthy();
      expect(
        screen.getByRole("button", { name: "Return to map" }),
      ).toBeTruthy();
    },
  );

  it("reveals reward once, updates reducer objective/map, and shows stable autosave", async () => {
    const oncontinue = vi.fn();
    render(RewardScreen, { autosaveStatus: "success", oncontinue });
    expect(screen.getByText("Signal Cipher")).toBeTruthy();
    expect(screen.getByText(/Archive route can now be inspected/)).toBeTruthy();
    expect(screen.getByRole("status").textContent).toMatch(/Autosave complete/);
    const continueButton = screen.getByRole("button", {
      name: "Continue to updated map",
    });
    await userEvent.setup().click(continueButton);
    await userEvent.setup().click(continueButton);
    expect(oncontinue).toHaveBeenCalledOnce();
    expect((continueButton as HTMLButtonElement).disabled).toBe(true);

    let state: PrototypeState = {
      ...createInitialPrototypeState(),
      screen: "battle-mock",
    };
    state = reducePrototype(state, { type: "battle-result", result: "win" });
    state = reducePrototype(state, { type: "continue-outcome" });
    state = reducePrototype(state, { type: "acknowledge-reward" });
    expect(state.objective).toMatch(/Signal decoded/);
    expect(state.locations.find(({ id }) => id === "old-arena")).toMatchObject({
      completed: true,
      access: "available",
    });
    expect(state.locations.find(({ id }) => id === "archive")?.access).toBe(
      "available",
    );
  });

  it("shows autosave failure recovery instead of false success", () => {
    render(RewardScreen, { autosaveStatus: "failure" });
    expect(screen.getByRole("alert").textContent).toMatch(/Autosave failed/);
    expect(screen.queryByText(/Autosave complete/)).toBeNull();
    expect(screen.getByRole("button", { name: "Retry autosave" })).toBeTruthy();
  });
});
