import { describe, expect, it } from "vitest";
import { DuelOperationError } from "../../src/battle/duel/contracts/duel-error.ts";
import { parseDuelDeckSelection } from "../../src/battle/duel/contracts/duel-deck-selection.ts";
import { cardCode } from "../../src/battle/duel/contracts/ids.ts";
import type { ParsedDeck } from "../../src/battle/duel/presets/deck-parser.ts";
import type { DuelPreset } from "../../src/battle/duel/presets/duel-preset.ts";
import {
  selectedDeckPairRulesProfile,
  TYPE_LINK,
} from "../../src/battle/duel/presets/duel-rules-profile.ts";
import { duelId } from "../../src/battle/duel/contracts/ids.ts";
import type { DuelRuntimeResources } from "../../src/battle/worker/DuelWorkerRuntime.ts";
import {
  assertSupportedCards,
  resolveDuelDecks,
} from "../../src/battle/worker/decks/resolve-duel-decks.ts";
import type { EngineCardData } from "../../src/battle/worker/engine/OcgCoreAdapter.ts";
import {
  createFakeOcgCoreAdapter,
  FAKE_DEPENDENCIES,
  FAKE_SNAPSHOT_ID,
} from "../fixtures/fake-ocgcore-adapter.ts";

const PLAYER_MAIN = Array.from({ length: 40 }, (_, index) => 1_000 + index);
const OPPONENT_MAIN = Array.from({ length: 40 }, (_, index) => 2_000 + index);
const LINK_CODE = 3_001;
const CUSTOM_MAIN = Array.from({ length: 40 }, (_, index) => 4_000 + index);

const adapter = (await createFakeOcgCoreAdapter(() => ({ steps: [] }))).adapter;

function deck(
  main: readonly number[],
  extra: readonly number[] = [],
): ParsedDeck {
  return Object.freeze({
    main: Object.freeze(main.map(cardCode)),
    extra: Object.freeze(extra.map(cardCode)),
    side: Object.freeze([]),
  });
}

const PRESET: DuelPreset = Object.freeze({
  id: duelId("bundled-v1:chapter-one-starter:vs:chapter-one-practice"),
  playerDeckId: "chapter-one-starter",
  opponentDeckId: "chapter-one-practice",
  player: deck(PLAYER_MAIN),
  opponent: deck(OPPONENT_MAIN),
});

function catalogEntry(code: number, type = 0x1): EngineCardData {
  return {
    code,
    alias: 0,
    setcodes: [],
    type,
    level: 4,
    attribute: 1,
    race: 1n,
    attack: 1_000,
    defense: 1_000,
    lscale: 0,
    rscale: 0,
    link_marker: 0,
  };
}

interface ResourceOverrides {
  readonly knownCodes?: readonly number[];
  readonly imageCodes?: readonly number[];
  readonly linkCodes?: readonly number[];
  readonly createPreset?: DuelRuntimeResources["createPreset"];
}

function resources(overrides: ResourceOverrides = {}): DuelRuntimeResources {
  const known = overrides.knownCodes ?? [
    ...PLAYER_MAIN,
    ...OPPONENT_MAIN,
    ...CUSTOM_MAIN,
    LINK_CODE,
  ];
  const links = new Set(overrides.linkCodes ?? []);
  const cards = new Map<number, EngineCardData>(
    known.map((code) => [
      code,
      catalogEntry(code, links.has(code) ? TYPE_LINK : 0x1),
    ]),
  );
  const images = new Map(
    (overrides.imageCodes ?? known).map((code) => [
      code,
      { code, full: `${code}.png`, cropped: `${code}-c.png` },
    ]),
  );
  return {
    adapter,
    dependencies: { ...FAKE_DEPENDENCIES, cards, images },
    createPreset:
      overrides.createPreset ??
      ((playerDeckId, opponentDeckId) =>
        Object.freeze({
          ...PRESET,
          playerDeckId,
          opponentDeckId,
          player:
            playerDeckId === "chapter-one-starter"
              ? PRESET.player
              : PRESET.opponent,
          opponent:
            opponentDeckId === "chapter-one-starter"
              ? PRESET.player
              : PRESET.opponent,
        })),
    snapshotId: FAKE_SNAPSHOT_ID,
  };
}

const PRESET_PLAYER = parseDuelDeckSelection({
  kind: "preset",
  deckId: "chapter-one-starter",
});
const PRESET_OPPONENT = parseDuelDeckSelection({
  kind: "preset",
  deckId: "chapter-one-practice",
});
const CUSTOM = parseDuelDeckSelection({
  kind: "cards",
  main: CUSTOM_MAIN,
  extra: [],
  side: [],
});

describe("resolveDuelDecks", () => {
  it("resolves a preset pair through createPreset and keeps the preset id", () => {
    const resolved = resolveDuelDecks(
      PRESET_PLAYER,
      PRESET_OPPONENT,
      resources(),
    );
    expect(resolved.player).toEqual(PRESET.player);
    expect(resolved.opponent).toEqual(PRESET.opponent);
    expect(resolved.presetId).toBe(PRESET.id);
  });

  it("resolves a mixed pair without a preset id", () => {
    const resolved = resolveDuelDecks(PRESET_PLAYER, CUSTOM, resources());
    expect(resolved.player).toEqual(PRESET.player);
    expect(resolved.opponent.main).toEqual(CUSTOM_MAIN);
    expect(resolved.presetId).toBeNull();
  });

  it("resolves a custom pair without a preset id", () => {
    const resolved = resolveDuelDecks(CUSTOM, CUSTOM, resources());
    expect(resolved.player.main).toEqual(CUSTOM_MAIN);
    expect(resolved.opponent.main).toEqual(CUSTOM_MAIN);
    expect(resolved.presetId).toBeNull();
  });

  it("refuses a code the active snapshot does not carry", () => {
    const selection = parseDuelDeckSelection({
      kind: "cards",
      main: [...CUSTOM_MAIN.slice(1), 909_090],
      extra: [],
      side: [],
    });
    let thrown: unknown;
    try {
      resolveDuelDecks(selection, PRESET_OPPONENT, resources());
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(DuelOperationError);
    expect((thrown as DuelOperationError).duelError.code).toBe(
      "unsupported_card",
    );
    expect((thrown as DuelOperationError).duelError.message).toContain(
      "909090",
    );
  });

  it("refuses a code that has card data but no packaged image", () => {
    const withoutImage = resources({
      imageCodes: [...PLAYER_MAIN, ...OPPONENT_MAIN, ...CUSTOM_MAIN.slice(1)],
    });
    expect(() =>
      resolveDuelDecks(CUSTOM, PRESET_OPPONENT, withoutImage),
    ).toThrow(/unsupported|outside the active snapshot/i);
  });

  /* The rejection message crosses back to the main thread, so it is the one
     place a refused start could disclose the seat it did not send. */
  it("names only the offending codes and never the opposing deck", () => {
    const selection = parseDuelDeckSelection({
      kind: "cards",
      main: [...CUSTOM_MAIN.slice(2), 909_090, 808_080],
      extra: [],
      side: [],
    });
    let message = "";
    try {
      resolveDuelDecks(selection, PRESET_OPPONENT, resources());
    } catch (error) {
      message = (error as DuelOperationError).duelError.message;
    }
    expect(message).toContain("909090");
    expect(message).toContain("808080");
    for (const code of OPPONENT_MAIN) {
      expect(message).not.toContain(String(code));
    }
  });

  it("reports at most ten offending codes", () => {
    const empty = resources({ knownCodes: [], imageCodes: [] });
    let message = "";
    try {
      resolveDuelDecks(CUSTOM, CUSTOM, empty);
    } catch (error) {
      message = (error as DuelOperationError).duelError.message;
    }
    expect(message.match(/\b4\d{3}\b/g) ?? []).toHaveLength(10);
    expect(message).toContain("40");
  });

  it("computes the rules profile from a resolved custom list", () => {
    const linked = resources({ linkCodes: [LINK_CODE] });
    const withLink = parseDuelDeckSelection({
      kind: "cards",
      main: CUSTOM_MAIN,
      extra: [LINK_CODE],
      side: [],
    });
    const resolved = resolveDuelDecks(withLink, PRESET_OPPONENT, linked);
    expect(
      selectedDeckPairRulesProfile(
        resolved.player,
        resolved.opponent,
        linked.dependencies.cards,
      ),
    ).toEqual({ rules: "mr5", extraMonsterZones: true });
  });

  it("keeps a Link-free custom pair on Master Rule 3", () => {
    const resolved = resolveDuelDecks(CUSTOM, PRESET_OPPONENT, resources());
    expect(
      selectedDeckPairRulesProfile(
        resolved.player,
        resolved.opponent,
        resources().dependencies.cards,
      ),
    ).toEqual({ rules: "mr3", extraMonsterZones: false });
  });
});

describe("assertSupportedCards", () => {
  it("accepts codes present in both the catalog and the image manifest", () => {
    expect(() =>
      assertSupportedCards(
        [1, 2],
        new Map([
          [1, {}],
          [2, {}],
        ]),
        new Set([1, 2]),
      ),
    ).not.toThrow();
  });

  it("rejects a code missing from the catalog", () => {
    expect(() =>
      assertSupportedCards([1, 3], new Map([[1, {}]]), new Set([1, 3])),
    ).toThrow(/3/);
  });

  it("rejects a code missing from the image manifest", () => {
    expect(() =>
      assertSupportedCards(
        [1, 2],
        new Map([
          [1, {}],
          [2, {}],
        ]),
        new Set([1]),
      ),
    ).toThrow(/2/);
  });

  it("accepts an empty list", () => {
    expect(() => assertSupportedCards([], new Map(), new Set())).not.toThrow();
  });
});
