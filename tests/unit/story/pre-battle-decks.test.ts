import { ASSET_SOURCES } from "../../../scripts/lib/asset-roots.ts";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import {
  catalogByCode,
  PROTOTYPE_RULESET,
} from "../../../src/decks/catalog/pinned-ruleset.ts";
import {
  packagedCatalog,
  type PackagedCardText,
} from "../../../src/decks/catalog/packaged-catalog.ts";
import {
  CATALOG_SHARD_COUNT,
  catalogShardName,
} from "../../../src/decks/catalog/runtime-catalog.ts";
import type {
  AssetDeckCardRecord,
  DeckBuilderCardView,
} from "../../../src/decks/catalog/ocg-card-mapper.ts";
import { PROTOTYPE_CATALOG } from "../../../src/deck-editor/fixtures/catalog.ts";
import {
  preBattleBlock,
  preBattleDeckOptions,
  preBattleSelection,
} from "../../../src/story/decks/pre-battle-decks.ts";
import { reduceStory } from "../../../src/story/model/story-reducer.ts";
import {
  createInitialStoryState,
  type StoryDeck,
  type StoryState,
} from "../../../src/story/model/story-state.ts";
import {
  fieldableStoryDeck,
  storyDeckFixture,
} from "../../fixtures/story-decks.ts";

/* The gate a story encounter starts through. Two halves are pinned here and
   they fail apart: the verdict — which of this save's decks may be fielded —
   and the block, which is why Start refuses and where it sends the player
   instead. A gate that refuses everything is worse than one that offers too
   much: the decks live in the save, so a save with no way past this screen is
   a story that cannot continue. */

const FIXTURE_CATALOG = catalogByCode(PROTOTYPE_CATALOG);

const FIELDABLE = fieldableStoryDeck();
const OWNED = FIELDABLE.collection;
/** One card out of the deck below, as the shop would leave it after a sale. */
const SOLD = FIXTURE_CATALOG.get(FIELDABLE.deck.main[0]!)!;
const SOLD_OUT: Record<number, number> = { ...OWNED, [SOLD.code]: 0 };

function save(overrides: Partial<StoryState> = {}): StoryState {
  return {
    ...createInitialStoryState(),
    screen: "pre-battle",
    progressExists: true,
    collection: OWNED,
    ...overrides,
  };
}

/** Forty owned cards: legal but for the two empty-zone warnings. */
function legalDeck(id: string): StoryDeck {
  return storyDeckFixture(id, { main: [...FIELDABLE.deck.main] });
}

/** One card short of a Main Deck, which is an error rather than a warning and
    needs no collection of its own to stay one. */
function shortDeck(id: string): StoryDeck {
  return storyDeckFixture(id, { main: [FIELDABLE.deck.main[0]!] });
}

describe("which decks a story save may duel with", () => {
  it("a deck the save owns every copy of is offered", () => {
    const deck = legalDeck("a");
    const [option] = preBattleDeckOptions(
      save({ decks: [deck] }),
      FIXTURE_CATALOG,
    );

    expect(option).toEqual({
      id: deck.id,
      name: deck.name,
      legal: true,
      bundled: false,
      issue: null,
    });
  });

  /* Warnings are not errors. The one deck a fresh save has carries two of them
     — no Extra Deck, no Side Deck — so a gate that demanded a clean verdict
     would lock every new player out of their first encounter. */
  it("a deck carrying warnings but no errors is offered", () => {
    const [option] = preBattleDeckOptions(
      save({ decks: [legalDeck("warned")] }),
      FIXTURE_CATALOG,
    );

    expect(option?.legal).toBe(true);
    expect(option?.issue).toBeNull();
  });

  /* Nobody edited this deck; the save sold a card out from under it. T26 warns
     before the sale commits and T25 badges the library row — this refuses the
     duel, off the same collection and the same `not-owned` error. */
  it("a deck using a card the save sold is refused and names it", () => {
    const [option] = preBattleDeckOptions(
      save({ decks: [legalDeck("sold")], collection: SOLD_OUT }),
      FIXTURE_CATALOG,
    );

    expect(option?.legal).toBe(false);
    expect(option?.issue).toContain(SOLD.name);
    expect(option?.issue).toContain("you own 0");
  });

  it("a deck that breaks a build rule is refused and says which", () => {
    const [option] = preBattleDeckOptions(
      save({ decks: [shortDeck("short")] }),
      FIXTURE_CATALOG,
    );

    expect(option?.legal).toBe(false);
    expect(option?.issue).toContain("Main Deck needs 39 more");
  });

  /* The verdict stored on the record was computed with an empty catalog, which
     calls every card missing — `starter-grant.ts` writes exactly that into
     every new save. Reading it back instead of recomputing would refuse the
     one deck a first-time player has. */
  it("recomputes rather than trusting the verdict stored on the save", () => {
    const stale = storyDeckFixture("stale", {
      main: [...FIELDABLE.deck.main],
      validation: {
        status: "errors",
        issues: [
          {
            id: "missing-card:deck-1",
            code: "missing-card",
            severity: "error",
            message: "Card 1 is missing from the pinned catalog.",
          },
        ],
        rulesetRevision: PROTOTYPE_RULESET.revision,
      },
    });
    const [option] = preBattleDeckOptions(
      save({ decks: [stale] }),
      FIXTURE_CATALOG,
    );

    expect(option?.legal).toBe(true);
  });

  it("keeps the save's own deck order", () => {
    const decks = [legalDeck("c"), legalDeck("a"), legalDeck("b")];
    const options = preBattleDeckOptions(save({ decks }), FIXTURE_CATALOG);

    expect(options.map(({ id }) => id)).toEqual(["c", "a", "b"]);
  });
});

describe("which deck a story encounter starts on", () => {
  it("preselects the save's default deck", () => {
    const decks = [legalDeck("a"), legalDeck("b"), legalDeck("c")];
    const options = preBattleDeckOptions(
      save({ decks, defaultDeckId: "b" }),
      FIXTURE_CATALOG,
    );

    expect(preBattleSelection(options, "b")).toBe("b");
  });

  /* The default is shown as it stands, errors and all: a save whose default
     broke has to be told so, not quietly handed a deck it never chose. Every
     legal deck is still one click away, so nothing here is unrecoverable. */
  it("preselects a broken default rather than substituting for it", () => {
    const options = preBattleDeckOptions(
      save({ decks: [shortDeck("broken"), legalDeck("fine")] }),
      FIXTURE_CATALOG,
    );

    expect(preBattleSelection(options, "broken")).toBe("broken");
  });

  it("falls back to the first legal deck when there is no default", () => {
    const options = preBattleDeckOptions(
      save({ decks: [shortDeck("broken"), legalDeck("fine")] }),
      FIXTURE_CATALOG,
    );

    expect(preBattleSelection(options, null)).toBe("fine");
  });

  it("falls back when the default names a deck this save no longer has", () => {
    const options = preBattleDeckOptions(
      save({ decks: [legalDeck("a")] }),
      FIXTURE_CATALOG,
    );

    expect(preBattleSelection(options, "deleted")).toBe("a");
  });

  it("selects nothing when no deck can be fielded", () => {
    const options = preBattleDeckOptions(
      save({ decks: [shortDeck("broken")] }),
      FIXTURE_CATALOG,
    );

    expect(preBattleSelection(options, null)).toBeNull();
  });
});

describe("why a story encounter refuses to start", () => {
  it("does not block on a legal selection", () => {
    const options = preBattleDeckOptions(
      save({ decks: [legalDeck("a")] }),
      FIXTURE_CATALOG,
    );

    expect(preBattleBlock(options, "a")).toBeNull();
  });

  /* A save with no decks at all is reachable rather than theoretical: the deck
     editor stopped seeding one into a story save, and a player may delete every
     deck they own. The way out is building one, so that is what it says. */
  it("sends a save with no decks to build one", () => {
    expect(preBattleBlock([], null)).toEqual({
      reason: expect.stringContaining("no decks"),
      action: "build",
    });
  });

  it("names the deck and the reason when the selection is illegal", () => {
    const options = preBattleDeckOptions(
      save({ decks: [legalDeck("broken")], collection: SOLD_OUT }),
      FIXTURE_CATALOG,
    );
    const block = preBattleBlock(options, "broken");

    expect(block?.action).toBe("repair");
    expect(block?.reason).toContain("Deck broken");
    expect(block?.reason).toContain(SOLD.name);
  });

  it("asks for a repair when the save has decks but none can be fielded", () => {
    const options = preBattleDeckOptions(
      save({ decks: [shortDeck("broken")] }),
      FIXTURE_CATALOG,
    );

    expect(preBattleBlock(options, null)?.action).toBe("repair");
  });
});

/* The exact save a first-time player reaches their first encounter with, put
   through the gate against the card database this build ships. Every other
   case above uses the 27-card fixture; this one cannot, because what is under
   test is the real forty-card grant against the real catalog. */
describe("a brand-new save's first encounter", () => {
  let snapshot: ReadonlyMap<number, DeckBuilderCardView>;

  beforeAll(async () => {
    const shards = Array.from({ length: CATALOG_SHARD_COUNT }, (_, index) =>
      catalogShardName(index),
    );
    const read = async <T>(kind: string, shard: string): Promise<T> =>
      JSON.parse(
        await readFile(
          path.resolve(
            `${ASSET_SOURCES.data.source}/catalog/${kind}/${shard}.json`,
          ),
          "utf8",
        ),
      ) as T;
    const [cards, texts] = await Promise.all([
      Promise.all(
        shards.map((shard) =>
          read<readonly AssetDeckCardRecord[]>("cards", shard),
        ),
      ),
      Promise.all(
        shards.map((shard) =>
          read<readonly PackagedCardText[]>("texts/en", shard),
        ),
      ),
    ]);
    snapshot = catalogByCode(packagedCatalog(cards.flat(), texts.flat()));
  });

  it("can duel with the deck it was granted", () => {
    const fresh = reduceStory(createInitialStoryState(), { type: "new-game" });
    const options = preBattleDeckOptions(fresh, snapshot);

    expect(options).toHaveLength(1);
    expect(options[0]?.legal).toBe(true);
    expect(preBattleSelection(options, fresh.defaultDeckId)).toBe(
      fresh.defaultDeckId,
    );
    expect(preBattleBlock(options, fresh.defaultDeckId)).toBeNull();
  });
});
