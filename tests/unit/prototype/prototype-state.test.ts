import { describe, expect, it } from "vitest";
import { PROLOGUE } from "../../../src/prototype/content/prologue.ts";
import {
  createInitialPrototypeState,
  PROTOTYPE_SCREENS,
} from "../../../src/prototype/model/prototype-state.ts";
import { reducePrototype } from "../../../src/prototype/model/prototype-reducer.ts";

describe("prototype state model", () => {
  it("declares every review screen and starts New Game at first narrative beat", () => {
    expect(PROTOTYPE_SCREENS).toEqual([
      "launcher",
      "title",
      "load",
      "narrative",
      "map",
      "pre-battle",
      "battle-mock",
      "outcome",
      "reward",
      "end",
    ]);
    const state = reducePrototype(createInitialPrototypeState(), {
      type: "new-game",
    });
    expect(state).toMatchObject({
      screen: "narrative",
      narrativeIndex: 0,
      progressExists: true,
    });
  });

  it("continues mock progress and loads only occupied manual/autosave slots", () => {
    const fresh = createInitialPrototypeState();
    expect(reducePrototype(fresh, { type: "continue" })).toBe(fresh);
    const continued = reducePrototype(
      { ...fresh, progressExists: true, savedScreen: "map" },
      { type: "continue" },
    );
    expect(continued.screen).toBe("map");
    expect(reducePrototype(fresh, { type: "load", slot: "empty" })).toBe(fresh);
    expect(
      reducePrototype(fresh, { type: "load", slot: "manual" }).screen,
    ).toBe("narrative");
    expect(
      reducePrototype(fresh, { type: "load", slot: "autosave" }).screen,
    ).toBe("map");
  });

  it("advances one beat per unique input and records one choice", () => {
    let state = reducePrototype(createInitialPrototypeState(), {
      type: "new-game",
    });
    state = reducePrototype(state, { type: "advance", inputId: 1 });
    const duplicate = reducePrototype(state, { type: "advance", inputId: 1 });
    expect(duplicate.narrativeIndex).toBe(1);
    state = reducePrototype(duplicate, { type: "choose", choice: "trust-rin" });
    const repeated = reducePrototype(state, {
      type: "choose",
      choice: "challenge-rin",
    });
    expect(repeated.choice).toBe("trust-rin");
    expect(repeated.choiceResponse).toMatch(/trust/i);
    const challenged = reducePrototype(
      reducePrototype(createInitialPrototypeState(), { type: "new-game" }),
      { type: "choose", choice: "challenge-rin" },
    );
    expect(challenged.choiceResponse).not.toBe(repeated.choiceResponse);
  });

  it("retains choice for later map acknowledgment", () => {
    const state = reducePrototype(
      reducePrototype(createInitialPrototypeState(), { type: "new-game" }),
      { type: "choose", choice: "observe-first" },
    );
    expect(
      reducePrototype(state, { type: "go-to-map" }).laterAcknowledgment,
    ).toMatch(/watched|observe/i);
  });

  it("allows available map destinations only", () => {
    const map = { ...createInitialPrototypeState(), screen: "map" as const };
    expect(
      reducePrototype(map, { type: "select-location", locationId: "old-arena" })
        .screen,
    ).toBe("pre-battle");
    expect(
      reducePrototype(map, { type: "select-location", locationId: "archive" }),
    ).toBe(map);
    expect(
      reducePrototype(map, {
        type: "select-location",
        locationId: "hidden-gate",
      }),
    ).toBe(map);
  });

  it.each(["win", "loss", "abort", "failure"] as const)(
    "models %s as distinct battle result",
    (result) => {
      const battle = {
        ...createInitialPrototypeState(),
        screen: "battle-mock" as const,
      };
      expect(
        reducePrototype(battle, { type: "battle-result", result }),
      ).toMatchObject({ screen: "outcome", outcome: result });
    },
  );

  it("routes win/loss separately and grants resolved rewards once", () => {
    const battle = {
      ...createInitialPrototypeState(),
      screen: "battle-mock" as const,
    };
    const win = reducePrototype(battle, {
      type: "battle-result",
      result: "win",
    });
    const loss = reducePrototype(battle, {
      type: "battle-result",
      result: "loss",
    });
    expect(win.outcomeScene).not.toBe(loss.outcomeScene);
    const rewarded = reducePrototype(win, { type: "continue-outcome" });
    expect(rewarded).toMatchObject({ screen: "reward", rewardGranted: true });
    expect(reducePrototype(rewarded, { type: "continue-outcome" })).toBe(
      rewarded,
    );
  });

  it("returns repeat completed battles to map without a second reward", () => {
    const repeatOutcome = {
      ...createInitialPrototypeState(),
      screen: "outcome" as const,
      outcome: "win" as const,
      rewardGranted: true,
      rewardAcknowledged: true,
    };
    expect(
      reducePrototype(repeatOutcome, { type: "continue-outcome" }),
    ).toMatchObject({
      screen: "map",
      outcome: null,
      rewardGranted: true,
      rewardAcknowledged: true,
    });
  });

  it.each(["abort", "failure"] as const)(
    "never grants progress after %s",
    (result) => {
      const outcome = reducePrototype(
        { ...createInitialPrototypeState(), screen: "battle-mock" },
        { type: "battle-result", result },
      );
      expect(
        reducePrototype(outcome, { type: "continue-outcome" }),
      ).toMatchObject({ rewardGranted: false, screen: "map" });
    },
  );

  it("resets to pristine serializable state", () => {
    const changed = reducePrototype(createInitialPrototypeState(), {
      type: "new-game",
    });
    const reset = reducePrototype(changed, { type: "reset" });
    expect(reset).toEqual(createInitialPrototypeState());
    expect(() => JSON.parse(JSON.stringify(reset))).not.toThrow();
    expect(PROLOGUE.beats.length).toBeGreaterThanOrEqual(25);
    expect(PROLOGUE.beats.length).toBeLessThanOrEqual(40);
  });
});
