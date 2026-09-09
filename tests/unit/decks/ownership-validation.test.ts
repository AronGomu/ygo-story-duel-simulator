import { ASSET_SOURCES } from "../../../scripts/lib/asset-roots.ts";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { unlimitedCardOwnership } from "../../../src/decks/card-ownership.ts";
import {
  catalogByCode,
  PROTOTYPE_RULESET,
  quantityLimit,
} from "../../../src/decks/catalog/pinned-ruleset.ts";
import type {
  AssetDeckCardRecord,
  DeckBuilderCardView,
} from "../../../src/decks/catalog/ocg-card-mapper.ts";
import {
  packagedCatalog,
  type PackagedCardText,
} from "../../../src/decks/catalog/packaged-catalog.ts";
import {
  CATALOG_SHARD_COUNT,
  catalogShardName,
} from "../../../src/decks/catalog/runtime-catalog.ts";
import type { DeckCardLists } from "../../../src/decks/deck-contracts.ts";
import { validateDeckDraft } from "../../../src/decks/deck-validation.ts";
import { PROTOTYPE_CATALOG } from "../../../src/deck-editor/fixtures/catalog.ts";
import { storyCardOwnership } from "../../../src/story/decks/card-ownership.ts";
import { buildStarterGrant } from "../../../src/story/decks/starter-grant.ts";
import { createInitialStoryState } from "../../../src/story/model/story-state.ts";

/* Owning a card and being allowed to run it are two different questions, and
   this file is where the first one reaches deck validation (ADR-050). The
   ruleset's `copy-limit` already answers the second, so a deck that breaks both
   must say both: `not-owned` never stands in for a copy limit, and a save that
   owns nine copies still cannot run nine.

   Every case reads ownership through `storyCardOwnership`, the reader a real
   save hands the editor, rather than through a hand-written stub — a rule that
   passed against a stub and failed against the save would pass here. */

const catalog = catalogByCode(PROTOTYPE_CATALOG);
const mainCodes = PROTOTYPE_CATALOG.filter(
  (card) =>
    card.canonicalZone === "main" &&
    quantityLimit(PROTOTYPE_RULESET, card.code) === 3,
).map(({ code }) => code);
/* Forty legal cards: seventeen distinct codes, so no code lands above the
   ruleset's limit of three and the only issues left are the empty Extra and
   Side warnings. Anything this file reports beyond those is ownership. */
const validMain = Array.from(
  { length: 40 },
  (_, index) => mainCodes[index % mainCodes.length]!,
);
/* A code `validMain` uses exactly twice, which is the ticket's case: two copies
   in the deck against one in the collection. Found by counting rather than by
   index arithmetic over the fixture's length, so adding a card to
   `PROTOTYPE_CATALOG` cannot silently turn it into a three-copy code and break
   these cases for a reason that has nothing to do with ownership. */
const TWICE_USED = [...countBy(validMain)].find(([, count]) => count === 2)![0];

function ownershipOf(collection: Readonly<Record<number, number>>) {
  return storyCardOwnership({ ...createInitialStoryState(), collection });
}

function countBy(codes: readonly number[]): Map<number, number> {
  const counts = new Map<number, number>();
  for (const code of codes) counts.set(code, (counts.get(code) ?? 0) + 1);
  return counts;
}

function copiesByCode(cards: DeckCardLists): Record<number, number> {
  return Object.fromEntries(
    countBy([...cards.main, ...cards.extra, ...cards.side]),
  );
}

describe("ownership deck validation", () => {
  it("a deck using an unowned card is an error", () => {
    const owned = copiesByCode({ main: validMain, extra: [], side: [] });
    const summary = validateDeckDraft(
      { main: validMain, extra: [], side: [] },
      catalog,
      PROTOTYPE_RULESET,
      ownershipOf({ ...owned, [TWICE_USED]: 1 }),
    );
    const raised = summary.issues.filter(({ code }) => code === "not-owned");
    expect(raised).toHaveLength(1);
    expect(raised[0]).toMatchObject({
      code: "not-owned",
      severity: "error",
      cardCode: TWICE_USED,
    });
    expect(summary.status).toBe("errors");
  });

  /* T26 and T27 show this string to a player who never touched the deck, so it
     has to say which card and how far short the collection falls. Asserted whole
     rather than by substring: "2" and "1" both appear whichever way round the
     counts are printed, and a message that swapped them would tell the player to
     buy a card they already have. */
  it("the issue names the card and both counts", () => {
    const [issue] = validateDeckDraft(
      { main: validMain, extra: [], side: [] },
      catalog,
      PROTOTYPE_RULESET,
      ownershipOf({ [TWICE_USED]: 1 }),
    ).issues.filter(({ cardCode }) => cardCode === TWICE_USED);
    expect(issue?.message).toBe(
      `This deck uses 2 copy/copies of ${catalog.get(TWICE_USED)!.name}; you own 1.`,
    );
  });

  /* The distinction the whole design turns on, and the one an "improvement"
     would collapse first: a deck can be over the ruleset limit and short of the
     collection at the same time, and the player fixes those in two different
     places. One code standing in for the other sends them to the wrong one. */
  it("a card over both limits reports both", () => {
    /* Four copies of a card pinned to three, owning three: over the ruleset by
       one and over the collection by one, from the same four cards. */
    const limited = mainCodes[0]!;
    expect(quantityLimit(PROTOTYPE_RULESET, limited)).toBe(3);
    const codes = validateDeckDraft(
      { main: Array<number>(4).fill(limited), extra: [], side: [] },
      catalog,
      PROTOTYPE_RULESET,
      ownershipOf({ [limited]: 3 }),
    )
      .issues.filter(({ cardCode }) => cardCode === limited)
      .map(({ code }) => code)
      .sort();
    expect(codes).toEqual(["copy-limit", "not-owned"]);
  });

  it("a deck within its owned copies is clean", () => {
    const summary = validateDeckDraft(
      { main: validMain, extra: [], side: [] },
      catalog,
      PROTOTYPE_RULESET,
      ownershipOf(copiesByCode({ main: validMain, extra: [], side: [] })),
    );
    expect(summary.issues.some(({ code }) => code === "not-owned")).toBe(false);
    expect(summary.status).toBe("warnings");
  });

  /* A copy is a copy wherever it sits: the same card sleeved into Main and Side
     is two copies of one card, and a per-zone count would call that legal. */
  it("the issue counts across zones", () => {
    const raised = validateDeckDraft(
      { main: [TWICE_USED], extra: [], side: [TWICE_USED] },
      catalog,
      PROTOTYPE_RULESET,
      ownershipOf({ [TWICE_USED]: 1 }),
    ).issues.filter(({ code }) => code === "not-owned");
    expect(raised).toHaveLength(1);
    expect(raised[0]?.cardCode).toBe(TWICE_USED);
  });

  it("free play never raises it", () => {
    const summary = validateDeckDraft(
      { main: validMain, extra: [], side: [] },
      catalog,
      PROTOTYPE_RULESET,
      unlimitedCardOwnership(),
    );
    expect(summary.issues.some(({ code }) => code === "not-owned")).toBe(false);
    expect(summary.status).toBe("warnings");
  });

  /* Free play owning every card is not a licence to run every card: the ruleset
     answers the copy limit in both worlds, and this is the pair T22 asked to be
     kept apart. */
  it("free play still obeys the ruleset copy limit", () => {
    const summary = validateDeckDraft(
      {
        main: [...validMain.slice(0, 36), ...Array<number>(4).fill(TWICE_USED)],
        extra: [],
        side: [],
      },
      catalog,
      PROTOTYPE_RULESET,
      unlimitedCardOwnership(),
    );
    expect(summary.issues.some(({ code }) => code === "copy-limit")).toBe(true);
    expect(summary.issues.some(({ code }) => code === "not-owned")).toBe(false);
  });

  it("existing issue codes are unaffected", () => {
    const main = validMain.slice(0, 39);
    const summary = validateDeckDraft(
      { main, extra: [], side: [] },
      catalog,
      PROTOTYPE_RULESET,
      ownershipOf(copiesByCode({ main, extra: [], side: [] })),
    );
    expect(
      summary.issues.some(({ code }) => code === "main-under-minimum"),
    ).toBe(true);
    expect(summary.issues.some(({ code }) => code === "not-owned")).toBe(false);
  });

  it("a caller that names no ownership raises nothing", () => {
    const summary = validateDeckDraft(
      { main: validMain, extra: [], side: [] },
      catalog,
      PROTOTYPE_RULESET,
    );
    expect(summary.issues.some(({ code }) => code === "not-owned")).toBe(false);
  });
});

/* The one case a wrong rule locks a player out of the game entirely: the deck
   the build hands a brand-new save. It is granted together with the cards
   behind it, so used equals owned for every code — the exact boundary
   `count > owned` must not trip — and its honest verdict is two warnings, which
   must stay warnings. A legality check that reads warnings as illegal, or that
   is off by one at the boundary, means a fresh save cannot duel with the deck
   it was just given. */
describe("the granted starter deck", () => {
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

  it("is legal for the save it was granted to", () => {
    const grant = buildStarterGrant();
    const summary = validateDeckDraft(
      grant.deck,
      snapshot,
      PROTOTYPE_RULESET,
      ownershipOf(grant.collection),
    );
    expect(
      summary.issues.filter(({ severity }) => severity === "error"),
    ).toEqual([]);
    expect(summary.issues.map(({ code }) => code).sort()).toEqual([
      "empty-extra",
    ]);
    expect(summary.status).toBe("warnings");
  });

  /* Selling is unrestricted (T26 warns, it does not refuse), so the deck the
     save started with is the first deck ownership can turn illegal. */
  it("selling a card it uses turns it illegal", () => {
    const grant = buildStarterGrant();
    const sold = Number(Object.keys(grant.collection)[0]);
    const summary = validateDeckDraft(
      grant.deck,
      snapshot,
      PROTOTYPE_RULESET,
      ownershipOf({ ...grant.collection, [sold]: 0 }),
    );
    const raised = summary.issues.filter(({ code }) => code === "not-owned");
    expect(raised).toHaveLength(1);
    expect(raised[0]?.cardCode).toBe(sold);
    expect(raised[0]?.message).toContain(snapshot.get(sold)!.name);
    expect(summary.status).toBe("errors");
  });
});
