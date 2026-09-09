import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { cardCode } from "../../src/battle/duel/contracts/ids.ts";
import {
  DECK_CATALOG,
  type DeckId,
} from "../../src/battle/duel/presets/deck-catalog.ts";
import {
  parseYdk,
  type ParsedDeck,
} from "../../src/battle/duel/presets/deck-parser.ts";
import { loadDeckSources } from "../../src/battle/duel/presets/deck-sources-node.ts";
import { reviewedCardPool } from "../../src/battle/duel/presets/reviewed-card-pool.ts";
import {
  selectedDeckPairRulesProfile,
  TYPE_LINK,
} from "../../src/battle/duel/presets/duel-rules-profile.ts";
import { loadActiveDuelDependenciesNode } from "../../src/battle/worker/assets/active-duel-dependencies-node.ts";

const TYPE_MONSTER = 0x1;
const TYPE_FUSION = 0x40;
const TYPE_SYNCHRO = 0x2000;
const TYPE_XYZ = 0x800000;

function deck(
  main: readonly number[],
  extra: readonly number[] = [],
  side: readonly number[] = [],
): ParsedDeck {
  return Object.freeze({
    main: Object.freeze(main.map(cardCode)),
    extra: Object.freeze(extra.map(cardCode)),
    side: Object.freeze(side.map(cardCode)),
  });
}

const LINK_FREE_TYPES = new Map<number, { readonly type: number }>([
  [1, { type: TYPE_MONSTER }],
  [2, { type: TYPE_MONSTER | TYPE_FUSION }],
  [3, { type: TYPE_MONSTER | TYPE_SYNCHRO }],
  [4, { type: TYPE_MONSTER | TYPE_XYZ }],
]);

describe("selectedDeckPairRulesProfile", () => {
  it("chooses MR3 without Extra Monster Zones when neither deck has a Link monster", () => {
    const profile = selectedDeckPairRulesProfile(
      deck([1, 2], [2, 3, 4]),
      deck([1], [3, 4]),
      LINK_FREE_TYPES,
    );

    expect(profile).toEqual({ rules: "mr3", extraMonsterZones: false });
    expect(Object.isFrozen(profile)).toBe(true);
  });

  it.each([
    ["player main", 0, "main"],
    ["player extra", 0, "extra"],
    ["player side", 0, "side"],
    ["opponent main", 1, "main"],
    ["opponent extra", 1, "extra"],
    ["opponent side", 1, "side"],
  ] as const)(
    "chooses MR5 with Extra Monster Zones for a Link monster in the %s",
    (_label, owner, section) => {
      const cards = new Map(LINK_FREE_TYPES);
      cards.set(9, { type: TYPE_MONSTER | TYPE_LINK });
      const linkDeck = deck(
        section === "main" ? [1, 9] : [1],
        section === "extra" ? [9] : [2],
        section === "side" ? [9] : [],
      );
      const plainDeck = deck([1], [2]);

      expect(
        selectedDeckPairRulesProfile(
          owner === 0 ? linkDeck : plainDeck,
          owner === 0 ? plainDeck : linkDeck,
          cards,
        ),
      ).toEqual({ rules: "mr5", extraMonsterZones: true });
    },
  );

  it("detects the Link bit inside a combined type mask", () => {
    const cards = new Map(LINK_FREE_TYPES);
    cards.set(9, { type: TYPE_LINK | TYPE_MONSTER | TYPE_XYZ | 0x10 });

    expect(
      selectedDeckPairRulesProfile(deck([1], [9]), deck([1], [2]), cards),
    ).toEqual({ rules: "mr5", extraMonsterZones: true });
  });

  it("throws instead of assuming a missing card is Link-free", () => {
    expect(() =>
      selectedDeckPairRulesProfile(deck([1, 77]), deck([1]), LINK_FREE_TYPES),
    ).toThrow("Missing card type for selected deck code: 77");
  });

  it("throws for a missing opponent code even when a Link was already found", () => {
    const cards = new Map(LINK_FREE_TYPES);
    cards.set(9, { type: TYPE_MONSTER | TYPE_LINK });

    expect(() =>
      selectedDeckPairRulesProfile(deck([1], [9]), deck([1, 78]), cards),
    ).toThrow("Missing card type for selected deck code: 78");
  });
});

describe("bundled Chapter 1 pair matrix", () => {
  let decks: ReadonlyMap<DeckId, ParsedDeck>;
  let cards: ReadonlyMap<number, { readonly type: number }>;

  beforeAll(async () => {
    const sources = await loadDeckSources();
    decks = new Map(
      [...sources].map(([id, source]) => [id, parseYdk(source)] as const),
    );
    const dependencies = await loadActiveDuelDependenciesNode(
      path.resolve("generated/assets/current"),
      new Set([...reviewedCardPool(sources)].map(cardCode)),
    );
    cards = dependencies.cards;
  });

  it("keeps every ordered bundled pair Link-free", () => {
    const pairs = DECK_CATALOG.flatMap((player) =>
      DECK_CATALOG.map((opponent) => [player.id, opponent.id] as const),
    );

    expect(pairs).toHaveLength(4);
    for (const [playerId, opponentId] of pairs) {
      const player = decks.get(playerId);
      const opponent = decks.get(opponentId);
      if (player === undefined || opponent === undefined)
        throw new Error(`Missing bundled deck: ${playerId} or ${opponentId}`);
      expect(
        selectedDeckPairRulesProfile(player, opponent, cards),
        `${playerId} vs ${opponentId}`,
      ).toEqual({ rules: "mr3", extraMonsterZones: false });
    }
  });
});
