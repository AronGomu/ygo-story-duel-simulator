// @vitest-environment jsdom

import { cleanup, fireEvent, render } from "@testing-library/svelte";
import { afterEach, describe, expect, it, vi } from "vitest";
import PhaseBar from "../../src/battle/app/components/PhaseBar.svelte";
import { choiceId, promptId } from "../../src/battle/duel/contracts/ids.ts";
import type { ActiveInteractionSpec } from "../../src/battle/app/prompts/interaction-spec.ts";

const KEY = {
  workerGeneration: 1,
  sessionGeneration: 2,
  promptId: promptId("phase-bar"),
} as const;

function specWithChoices(
  entries: readonly [
    string,
    string,
    "battlePhase" | "mainPhase2" | "endPhase",
  ][],
): ActiveInteractionSpec {
  return {
    key: KEY,
    globalChoices: new Map(
      entries.map(([id, label, action]) => [
        choiceId(id),
        { id: choiceId(id), label, action },
      ]),
    ),
  } as unknown as ActiveInteractionSpec;
}

function chipIds(container: Element): string[] {
  return [...container.children].map(
    (element) => element.getAttribute("data-cy") ?? "",
  );
}

afterEach(() => {
  cleanup();
});

describe("PhaseBar", () => {
  /* The bar reads left to right as two phase timelines. End Turn now lives in
     the field corner, so the player half stops at Main 2 while the opponent's
     inert End phase remains visible. */
  it("renders the player half before the opponent half in timeline order", () => {
    render(PhaseBar);

    const bar = document.querySelector('[data-cy="phase-bar"]');
    const opponent = document.querySelector('[data-cy="phase-bar-opponent"]');
    const player = document.querySelector('[data-cy="phase-bar-player"]');
    expect(bar).not.toBeNull();
    expect(chipIds(bar!)).toEqual(["phase-bar-player", "phase-bar-opponent"]);
    expect(opponent?.getAttribute("role")).toBe("group");
    expect(opponent?.getAttribute("aria-label")).toBe("Opponent phases");
    expect(player?.getAttribute("role")).toBe("group");
    expect(player?.getAttribute("aria-label")).toBe("Your phases");
    expect(chipIds(player!)).toEqual([
      "phase-bar-you-draw",
      "phase-bar-you-standby",
      "phase-bar-you-main1",
      "phase-bar-you-battle",
      "phase-bar-you-main2",
    ]);
    expect(chipIds(opponent!)).toEqual([
      "phase-bar-opp-draw",
      "phase-bar-opp-standby",
      "phase-bar-opp-main1",
      "phase-bar-opp-battle",
      "phase-bar-opp-main2",
      "phase-bar-opp-end",
    ]);
  });

  it("renders only offered player transitions as buttons", () => {
    const spec = specWithChoices([
      ["battle", "Enter Battle Phase", "battlePhase"],
      ["end", "End turn", "endPhase"],
    ]);
    render(PhaseBar, { phase: "main1", spec });

    expect(
      document.querySelector('[data-cy="phase-bar-you-battle"]')?.tagName,
    ).toBe("BUTTON");
    for (const slot of ["draw", "standby", "main1", "main2"]) {
      const chip = document.querySelector(`[data-cy="phase-bar-you-${slot}"]`);
      expect(chip?.tagName).toBe("SPAN");
      expect(chip?.getAttribute("role")).toBe("presentation");
    }
    expect(
      document.querySelector('[data-cy="phase-bar-opp-battle"]')?.tagName,
    ).toBe("SPAN");
    expect(
      document.querySelector('[data-cy="field-end-turn-button"]'),
    ).toBeNull();
  });

  it("dispatches an offered player transition", async () => {
    const spec = specWithChoices([
      ["battle", "Enter Battle Phase", "battlePhase"],
    ]);
    const oninteraction = vi.fn();
    render(PhaseBar, { phase: "main1", spec, oninteraction });

    await fireEvent.click(
      document.querySelector('[data-cy="phase-bar-you-battle"]')!,
    );

    expect(oninteraction).toHaveBeenCalledOnce();
    expect(oninteraction).toHaveBeenCalledWith({
      type: "chooseChoice",
      choiceId: choiceId("battle"),
      key: spec.key,
    });
  });

  it("routes current phase to the opponent half", () => {
    render(PhaseBar, { phase: "main1", turnPlayer: 1 });

    const opponent = document.querySelector('[data-cy="phase-bar-opponent"]');
    const player = document.querySelector('[data-cy="phase-bar-player"]');
    expect(opponent?.getAttribute("data-current-phase")).toBe("main1");
    expect(player?.hasAttribute("data-current-phase")).toBe(false);
    expect(
      document
        .querySelector('[data-cy="phase-bar-opp-main1"]')
        ?.classList.contains("is-current"),
    ).toBe(true);
    expect(
      document
        .querySelector('[data-cy="phase-bar-you-main1"]')
        ?.classList.contains("is-current"),
    ).toBe(false);
    expect(document.querySelectorAll(".phase-chip.is-current")).toHaveLength(1);
  });

  it("routes battle-family phases to the player battle chip", () => {
    render(PhaseBar, { phase: "damageCalculation", turnPlayer: 0 });

    expect(
      document
        .querySelector('[data-cy="phase-bar-you-battle"]')
        ?.classList.contains("is-current"),
    ).toBe(true);
    expect(
      document
        .querySelector('[data-cy="phase-bar-player"]')
        ?.getAttribute("data-current-phase"),
    ).toBe("battle");
  });

  it("makes every transition inert while disabled", async () => {
    const spec = specWithChoices([
      ["battle", "Enter Battle Phase", "battlePhase"],
      ["main2", "Enter Main Phase 2", "mainPhase2"],
      ["end", "End turn", "endPhase"],
    ]);
    const oninteraction = vi.fn();
    render(PhaseBar, { spec, disabled: true, oninteraction });

    expect(document.querySelectorAll("button.phase-chip")).toHaveLength(0);
    const battleChip = document.querySelector(
      '[data-cy="phase-bar-you-battle"]',
    );
    expect(battleChip?.tagName).toBe("SPAN");
    expect(
      document.querySelector('[data-cy="field-end-turn-button"]'),
    ).toBeNull();

    await fireEvent.click(battleChip!);
    expect(oninteraction).not.toHaveBeenCalled();
  });

  it("renders no player current chip during End Phase", () => {
    render(PhaseBar, { phase: "end", turnPlayer: 0 });

    expect(
      document
        .querySelector('[data-cy="phase-bar-player"]')
        ?.getAttribute("data-current-phase"),
    ).toBe("end");
    expect(document.querySelectorAll(".phase-chip.is-current")).toHaveLength(0);
    expect(
      document.querySelector('[data-cy="field-end-turn-button"]'),
    ).toBeNull();
  });

  it("describes current and available transitions to assistive technology", () => {
    const spec = specWithChoices([
      ["battle", "Enter Battle Phase", "battlePhase"],
    ]);
    render(PhaseBar, { phase: "battle", turnPlayer: 0, spec });

    expect(
      document
        .querySelector('[data-cy="phase-bar-you-battle"]')
        ?.getAttribute("aria-label"),
    ).toBe("Battle phase, current, available");
  });

  it("has no current carrier when phase is unknown", () => {
    render(PhaseBar, { phase: "unknown" });

    expect(document.querySelectorAll("[data-current-phase]")).toHaveLength(0);
    expect(document.querySelectorAll(".phase-chip.is-current")).toHaveLength(0);
  });
});
