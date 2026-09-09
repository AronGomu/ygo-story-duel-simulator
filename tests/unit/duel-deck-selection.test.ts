import { describe, expect, it } from "vitest";
import { DuelCommandValidationError } from "../../src/battle/duel/contracts/duel-command.ts";
import { parseDuelDeckSelection } from "../../src/battle/duel/contracts/duel-deck-selection.ts";

/* Forty distinct codes: the minimum legal Main Deck, with no code repeated, so
   a copy-limit failure in one of these tests can only come from what that test
   added. */
const MAIN_40 = Array.from({ length: 40 }, (_, index) => 1_000 + index);

function cards(overrides: Record<string, unknown> = {}): unknown {
  return { kind: "cards", main: MAIN_40, extra: [], side: [], ...overrides };
}

describe("parseDuelDeckSelection", () => {
  it("parses a preset selection", () => {
    const selection = parseDuelDeckSelection({
      kind: "preset",
      deckId: "chapter-one-starter",
    });
    expect(selection).toEqual({
      kind: "preset",
      deckId: "chapter-one-starter",
    });
    expect(Object.isFrozen(selection)).toBe(true);
  });

  it("rejects an unknown preset", () => {
    expect(() =>
      parseDuelDeckSelection({ kind: "preset", deckId: "nope" }),
    ).toThrow(DuelCommandValidationError);
  });

  it("parses a card selection into frozen copies", () => {
    const source = [...MAIN_40];
    const selection = parseDuelDeckSelection({
      kind: "cards",
      main: source,
      extra: [],
      side: [],
    });
    if (selection.kind !== "cards") throw new Error("Expected a card list");
    expect(selection.main).toEqual(MAIN_40);
    expect(Object.isFrozen(selection)).toBe(true);
    expect(Object.isFrozen(selection.main)).toBe(true);
    /* A copy, not the caller's array: a sender that keeps mutating its own
       list after posting must not be able to change what was validated. */
    expect(selection.main).not.toBe(source);
    source[0] = 999_999;
    expect(selection.main[0]).toBe(MAIN_40[0]);
  });

  it("rejects a short main deck", () => {
    expect(() =>
      parseDuelDeckSelection(cards({ main: MAIN_40.slice(1) })),
    ).toThrow(/40-60/);
  });

  it("rejects an oversized main deck", () => {
    const main = Array.from({ length: 61 }, (_, index) => 1_000 + (index % 20));
    expect(() => parseDuelDeckSelection(cards({ main }))).toThrow(/40-60/);
  });

  it("rejects an oversized extra deck", () => {
    const extra = Array.from({ length: 16 }, (_, index) => 5_000 + index);
    expect(() => parseDuelDeckSelection(cards({ extra }))).toThrow(
      DuelCommandValidationError,
    );
  });

  it("rejects an oversized side deck", () => {
    const side = Array.from({ length: 16 }, (_, index) => 6_000 + index);
    expect(() => parseDuelDeckSelection(cards({ side }))).toThrow(
      DuelCommandValidationError,
    );
  });

  it("rejects a fourth copy of a card", () => {
    const main = [...MAIN_40.slice(0, 37), 7_777, 7_777, 7_777];
    expect(() => parseDuelDeckSelection(cards({ main }))).not.toThrow();
    expect(() =>
      parseDuelDeckSelection(cards({ main, extra: [7_777] })),
    ).toThrow(/3 copies/);
  });

  it("counts copies across main, extra and side together", () => {
    const main = [...MAIN_40.slice(0, 38), 8_888, 8_888];
    expect(() =>
      parseDuelDeckSelection(cards({ main, extra: [8_888], side: [8_888] })),
    ).toThrow(/3 copies/);
  });

  it.each([
    ["a fractional code", 1.5],
    ["a negative code", -3],
    ["a zero code", 0],
    ["a string code", "7"],
    ["NaN", Number.NaN],
    ["Infinity", Number.POSITIVE_INFINITY],
    ["an unsafe integer", Number.MAX_SAFE_INTEGER + 2],
    ["null", null],
    ["a bigint", 7n],
  ])("rejects %s in a card list", (_label, code) => {
    expect(() =>
      parseDuelDeckSelection(cards({ main: [...MAIN_40.slice(1), code] })),
    ).toThrow(DuelCommandValidationError);
  });

  it("rejects a sparse card list", () => {
    const main: unknown[] = [...MAIN_40];
    delete main[3];
    expect(() => parseDuelDeckSelection(cards({ main }))).toThrow(
      /dense array/,
    );
  });

  it.each([
    ["a non-array main deck", { main: "40 cards" }],
    ["an object posing as a list", { main: { length: 40 } }],
    ["a typed array", { main: new Uint32Array(40) }],
  ])("rejects %s", (_label, override) => {
    expect(() => parseDuelDeckSelection(cards(override))).toThrow(
      DuelCommandValidationError,
    );
  });

  it("rejects an extra key on a card selection", () => {
    expect(() => parseDuelDeckSelection(cards({ seed: 42 }))).toThrow(
      DuelCommandValidationError,
    );
  });

  it("rejects an extra key on a preset selection", () => {
    expect(() =>
      parseDuelDeckSelection({
        kind: "preset",
        deckId: "chapter-one-starter",
        seed: 42,
      }),
    ).toThrow(DuelCommandValidationError);
  });

  it("rejects a missing side deck rather than defaulting it", () => {
    expect(() =>
      parseDuelDeckSelection({ kind: "cards", main: MAIN_40, extra: [] }),
    ).toThrow(DuelCommandValidationError);
  });

  it.each([
    [
      "__proto__",
      '{"kind":"cards","main":[],"extra":[],"side":[],"__proto__":{"admin":true}}',
    ],
    [
      "constructor",
      '{"kind":"cards","main":[],"extra":[],"side":[],"constructor":1}',
    ],
    [
      "prototype",
      '{"kind":"preset","deckId":"chapter-one-starter","prototype":1}',
    ],
  ])("rejects the polluting key %s", (_label, json) => {
    /* `JSON.parse` is the only way to build an own `__proto__` key, and it is
       also how a forged message would arrive over the wire. */
    expect(() => parseDuelDeckSelection(JSON.parse(json))).toThrow(
      DuelCommandValidationError,
    );
    expect(({} as Record<string, unknown>).admin as unknown).toBeUndefined();
  });

  it.each([
    ["null", null],
    ["an array", []],
    ["a string", "chapter-one-starter"],
    ["a number", 7],
    ["undefined", undefined],
  ])("rejects %s as a selection", (_label, value) => {
    expect(() => parseDuelDeckSelection(value)).toThrow(
      DuelCommandValidationError,
    );
  });

  it("rejects an unknown selection kind", () => {
    expect(() =>
      parseDuelDeckSelection({ kind: "ydk", source: "#main" }),
    ).toThrow(DuelCommandValidationError);
  });

  it("rejects a duplicate key rather than validating the discarded one", () => {
    /* A wire payload can name a field twice; the last one wins and is the one
       that would reach the engine, so it is the one that must be validated. */
    const json = `{"kind":"cards","main":${JSON.stringify(MAIN_40)},"extra":[],"side":[],"main":"nope"}`;
    expect(JSON.parse(json).main).toBe("nope");
    expect(() => parseDuelDeckSelection(JSON.parse(json))).toThrow(
      DuelCommandValidationError,
    );
  });

  it("survives a structured clone unchanged", () => {
    /* A frozen plain object of plain arrays is the only shape that reaches the
       Worker intact; a class instance or a getter would be dropped or throw. */
    const selection = parseDuelDeckSelection(cards({ extra: [4_001] }));
    expect(structuredClone(selection)).toEqual(selection);
  });
});
