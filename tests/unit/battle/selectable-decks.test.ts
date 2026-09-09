import { describe, expect, it } from "vitest";
import { buildActiveCardDataManifest } from "../../../scripts/lib/active-card-data-manifest.ts";
import { buildActiveCardTextManifest } from "../../../scripts/lib/active-card-text-manifest.ts";
import { buildActiveImageManifest } from "../../../scripts/lib/active-image-manifest.ts";
import {
  findSelectableDeck,
  listSelectableDecks,
  presetSelectableDecks,
} from "../../../src/battle/decks/selectable-decks.ts";
import { parseYdk } from "../../../src/battle/duel/presets/deck-parser.ts";
import { DECK_SOURCES } from "../../../src/battle/duel/presets/deck-sources-browser.ts";
import {
  catalogByCode,
  PROTOTYPE_RULESET,
  quantityLimit,
} from "../../../src/decks/catalog/pinned-ruleset.ts";
import { packagedCatalog } from "../../../src/decks/catalog/packaged-catalog.ts";
import { PROTOTYPE_CATALOG } from "../../../src/deck-editor/fixtures/catalog.ts";
import type { DeckRecord, DeckRepository } from "../../../src/decks/index.ts";
import { emptyDeckHistory } from "../../../src/decks/deck-history.ts";
import { createBlankDeck } from "../../../src/decks/deck-model.ts";
import { validateDeckDraft } from "../../../src/decks/deck-validation.ts";
import { DECK_CATALOG } from "../../../src/battle/duel/presets/deck-catalog.ts";

const catalog = catalogByCode(PROTOTYPE_CATALOG);
const mainCodes = PROTOTYPE_CATALOG.filter(
  (card) =>
    card.canonicalZone === "main" &&
    quantityLimit(PROTOTYPE_RULESET, card.code) === 3,
).map(({ code }) => code);
const validMain = Array.from(
  { length: 40 },
  (_, index) => mainCodes[index % mainCodes.length]!,
);

/** The moment a local deck was last saved, fixed so the listing's copy of it
    can be asserted rather than merely be a string. */
const UPDATED_AT = "2026-08-01T00:00:00.000Z";

function deckRecord(
  id: string,
  main: readonly number[],
  revision = 1,
): DeckRecord {
  const base = createBlankDeck(id, catalog, PROTOTYPE_RULESET, { id });
  return Object.freeze({
    ...base,
    revision,
    updatedAt: UPDATED_AT,
    main: Object.freeze([...main]),
    validation: validateDeckDraft(
      { main: [...main], extra: [], side: [] },
      catalog,
      PROTOTYPE_RULESET,
    ),
  });
}

/** Only the two methods the lister is allowed to reach for. A repository that
    could save is deliberately out of reach: listing never rewrites a deck. */
function repositoryOf(
  ...decks: readonly DeckRecord[]
): Pick<DeckRepository, "list" | "load"> {
  return {
    list: async () => decks,
    load: async (id) => {
      const deck = decks.find((candidate) => candidate.id === id);
      return deck === undefined ? null : { deck, history: emptyDeckHistory() };
    },
  };
}

async function list(repository: Pick<DeckRepository, "list" | "load">) {
  return await listSelectableDecks(
    DECK_CATALOG,
    repository,
    catalog,
    PROTOTYPE_RULESET,
  );
}

describe("listSelectableDecks", () => {
  it("lists every bundled preset even with an empty repository", async () => {
    const decks = await list(repositoryOf());

    expect(decks).toHaveLength(DECK_CATALOG.length);
    expect(decks.every((deck) => deck.source === "preset")).toBe(true);
    expect(decks.map((deck) => deck.key)).toEqual(
      DECK_CATALOG.map((preset) => `preset:${preset.id}`),
    );
    expect(decks[0]?.selection).toEqual({
      kind: "preset",
      deckId: DECK_CATALOG[0]?.id,
    });
  });

  it("lists a ready local deck", async () => {
    const decks = await list(repositoryOf(deckRecord("ready-deck", validMain)));
    const local = decks.filter((deck) => deck.source === "local");

    expect(local).toHaveLength(1);
    expect(local[0]?.key).toBe("local:ready-deck:1");
    expect(local[0]?.label).toBe("ready-deck");
    expect(local[0]?.selection).toEqual({
      kind: "local",
      deck: expect.objectContaining({
        ref: { type: "local", deckId: "ready-deck", revision: 1 },
        main: validMain,
      }),
    });
  });

  it("carries the record's save time and the snapshot's lists on a local deck", async () => {
    const decks = await list(repositoryOf(deckRecord("ready-deck", validMain)));
    const local = decks.filter((deck) => deck.source === "local");

    expect(local[0]?.updatedAt).toBe(UPDATED_AT);
    expect(local[0]?.lists).toEqual({
      main: validMain,
      extra: [],
      side: [],
    });
    expect(Object.isFrozen(local[0]?.lists)).toBe(true);
  });

  it("hides a deck that resolves invalid", async () => {
    const decks = await list(
      repositoryOf(deckRecord("short-deck", validMain.slice(0, 39))),
    );

    expect(decks.filter((deck) => deck.source === "local")).toEqual([]);
  });

  it("hides a deck the repository cannot load", async () => {
    const listed = deckRecord("ghost-deck", validMain);
    const decks = await list({
      list: async () => [listed],
      load: async () => null,
    });

    expect(decks.filter((deck) => deck.source === "local")).toEqual([]);
  });

  /* What keeps the picker from offering a deck the Worker would refuse: a code
     the active snapshot does not carry is a `missing-card` error in the
     catalog the deck is resolved against, so the deck never reaches a seat. */
  it("hides a ready deck holding a code the catalog does not carry", async () => {
    const decks = await listSelectableDecks(
      DECK_CATALOG,
      repositoryOf(deckRecord("ready-deck", validMain)),
      catalogByCode(
        PROTOTYPE_CATALOG.filter(({ code }) => code !== validMain[0]),
      ),
      PROTOTYPE_RULESET,
    );

    expect(decks.filter((deck) => deck.source === "local")).toEqual([]);
  });

  it("changes the key when the deck is saved again", async () => {
    const first = await list(
      repositoryOf(deckRecord("rev-deck", validMain, 1)),
    );
    const second = await list(
      repositoryOf(deckRecord("rev-deck", validMain, 2)),
    );

    expect(first.at(-1)?.key).toBe("local:rev-deck:1");
    expect(second.at(-1)?.key).toBe("local:rev-deck:2");
  });

  it("keeps presets ahead of local decks", async () => {
    const decks = await list(repositoryOf(deckRecord("ready-deck", validMain)));

    expect(decks.map((deck) => deck.source)).toEqual([
      ...DECK_CATALOG.map(() => "preset"),
      "local",
    ]);
  });
});

describe("presetSelectableDecks", () => {
  it("carries the card lists of every bundled deck, undated", () => {
    const decks = presetSelectableDecks(DECK_CATALOG);

    expect(decks).toHaveLength(DECK_CATALOG.length);
    for (const deck of decks) {
      expect(deck.lists.main.length).toBeGreaterThan(0);
      expect(Object.isFrozen(deck.lists)).toBe(true);
      /* Compiled into the build: no bundled deck has ever been saved. */
      expect(deck.updatedAt).toBeNull();
    }
  });

  /* Parsed rather than restated: a tile counting 40 cards is only worth
     showing if the count is the one the Worker will draw from. */
  it("reads each deck's lists from its own `.ydk` source", () => {
    const player = presetSelectableDecks(DECK_CATALOG).find(
      (deck) => deck.key === "preset:chapter-one-starter",
    );
    const parsed = parseYdk(DECK_SOURCES.get("chapter-one-starter")!);

    expect(player?.lists.main).toEqual(parsed.main);
    expect(player?.lists.extra).toEqual(parsed.extra);
    expect(player?.lists.side).toEqual(parsed.side);
  });
});

describe("findSelectableDeck", () => {
  it("returns the entry for a known key and null otherwise", async () => {
    const decks = await list(repositoryOf(deckRecord("ready-deck", validMain)));

    expect(findSelectableDeck(decks, "local:ready-deck:1")?.source).toBe(
      "local",
    );
    expect(
      findSelectableDeck(decks, "preset:chapter-one-starter")?.source,
    ).toBe("preset");
    expect(findSelectableDeck(decks, "local:ready-deck:2")).toBeNull();
    expect(findSelectableDeck([], "preset:chapter-one-starter")).toBeNull();
  });
});

/* The listing above is right, and it used to always say no: the editor built
   from a hand-written fixture while `__ACTIVE_IMAGE_MANIFEST__` was cut from
   the six bundled `.ydk` decks, so only eight cards were in both and the
   pinned ruleset capped those eight below the 40-card Main minimum. No deck a
   player could assemble was one this build could draw.

   The editor and the duel now await one runtime catalog read
   (`src/decks/catalog/runtime-catalog.ts`, ADR-043), so the editor's offer is
   the duel's card set less its Tokens, never a different set. This asserts that from the build's own manifests rather than
   from the browser globals, which is the earliest place the claim can be
   checked — and it goes red the day packaging shrinks back below a legal deck.
   `a local deck built from the packaged catalog duels` in
   `e2e/duel-smoke.spec.ts` walks the same claim end to end. */
describe("packaged local deck coverage", () => {
  it("packages enough legal cards to assemble a deck the duel can draw", () => {
    const packagedCodes = buildActiveImageManifest(
      process.cwd(),
      "coverage",
    ).files.map(({ code }) => code);
    const packaged = packagedCatalog(
      buildActiveCardDataManifest(process.cwd(), new Set(packagedCodes)),
      buildActiveCardTextManifest(process.cwd(), new Set(packagedCodes)),
    );
    const assemblableMain = packaged.filter(
      (card) => card.canonicalZone === "main",
    );
    const largestPlayableDeck = assemblableMain.reduce(
      (total, card) => total + quantityLimit(PROTOTYPE_RULESET, card.code),
      0,
    );

    expect(packaged).toHaveLength(packagedCodes.length);
    expect(largestPlayableDeck).toBeGreaterThanOrEqual(40);

    /* Assembled the way the editor would, then run through the validator the
       picker consults: legal to build is only worth asserting if it is also
       legal to duel. */
    const codes = assemblableMain
      .filter((card) => quantityLimit(PROTOTYPE_RULESET, card.code) === 3)
      .map(({ code }) => code);
    const main = Array.from(
      { length: 40 },
      (_, index) => codes[index % codes.length]!,
    );
    const validation = validateDeckDraft(
      { main, extra: [], side: [] },
      catalogByCode(packaged),
      PROTOTYPE_RULESET,
    );

    expect(
      validation.issues.filter((issue) => issue.severity === "error"),
    ).toEqual([]);
  });
});
