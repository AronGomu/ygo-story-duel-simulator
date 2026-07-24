// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/svelte";
import { userEvent } from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import BattleHandoffScreen from "../../../src/prototype/screens/BattleHandoffScreen.svelte";
import PreBattleScreen from "../../../src/prototype/screens/PreBattleScreen.svelte";

afterEach(() => cleanup());

describe("battle handoff", () => {
  it("shows briefing details, checkpoint, conditional return, and starts once", async () => {
    const onstart = vi.fn();
    const rendered = render(PreBattleScreen, { allowReturn: false, onstart });
    for (const text of [
      /Rin's Echo/i,
      /Signal Deck/i,
      /Relay Deck/i,
      /Single duel/i,
      /Decode the challenge/i,
      /Mock checkpoint saved/i,
    ])
      expect(screen.getByText(text)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Return to Map" })).toBeNull();
    const start = screen.getByRole("button", { name: "Start Duel" });
    await userEvent.setup().click(start);
    await userEvent.setup().click(start);
    expect(onstart).toHaveBeenCalledOnce();
    await rendered.rerender({ allowReturn: true });
    expect(screen.getByRole("button", { name: "Return to Map" })).toBeTruthy();
  });

  it.each(["win", "loss", "abort", "failure"] as const)(
    "normalizes reviewer %s simulation",
    async (result) => {
      const onresult = vi.fn();
      render(BattleHandoffScreen, { onresult });
      expect(
        screen.getByRole("region", { name: "Reviewer-only battle controls" }),
      ).toBeTruthy();
      expect(screen.getByText(/Non-player tooling/)).toBeTruthy();
      await userEvent.setup().click(
        screen.getByRole("button", {
          name: new RegExp(
            `Simulate ${result === "failure" ? "Technical Failure" : result === "abort" ? "Abort" : `Player ${result[0]!.toUpperCase()}${result.slice(1)}`}`,
            "i",
          ),
        }),
      );
      expect(onresult).toHaveBeenCalledWith(result);
      if (result === "abort") {
        expect(screen.getByText(/No progression granted/)).toBeTruthy();
        expect(
          screen.getByRole("button", { name: "Retry mock duel" }),
        ).toBeTruthy();
      }
      if (result === "failure") {
        expect(screen.getByText(/not a story defeat/i)).toBeTruthy();
        expect(
          screen.getByRole("button", { name: "Return to map" }),
        ).toBeTruthy();
      }
    },
  );

  it("keeps win/loss messages distinct", async () => {
    const rendered = render(BattleHandoffScreen);
    await userEvent
      .setup()
      .click(screen.getByRole("button", { name: "Simulate Player Win" }));
    const win = screen.getByRole("status").textContent;
    rendered.unmount();
    render(BattleHandoffScreen);
    await userEvent
      .setup()
      .click(screen.getByRole("button", { name: "Simulate Player Loss" }));
    expect(screen.getByRole("status").textContent).not.toBe(win);
  });
});
