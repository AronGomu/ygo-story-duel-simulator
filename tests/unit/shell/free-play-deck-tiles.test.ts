import { describe, expect, it } from "vitest";
import {
  DECK_CATALOG,
  presetSelectableDecks,
  type SelectableDeck,
} from "../../../src/battle/index.ts";
import type { DeckBuilderCardView } from "../../../src/decks/catalog/ocg-card-mapper.ts";
import { deckId } from "../../../src/decks/deck-contracts.ts";
import { PROTOTYPE_CATALOG } from "../../../src/deck-editor/fixtures/catalog.ts";
import { freePlayDeckTile } from "../../../src/shell/screens/free-play-deck-tiles.ts";

/* How free play describes one deck to the shared selection screen. Pure, so it
   is tested against real bundled decks rather than through the screen: the
   cover rule and default flag are the whole of the mapping. */

const PRACTICE = presetSelectableDecks(DECK_CATALOG).find(
  (deck) => deck.key === "preset:chapter-one-practice",
)!;
const UPDATED_AT = "2026-08-20T10:00:00.000Z";
const LOCAL_DECK_ID = deckId("built-deck");

/** A catalog row for one code, borrowing every field the mapping never reads
    from the editor's own fixture. */
function card(code: number): DeckBuilderCardView {
  return {
    ...PROTOTYPE_CATALOG[0]!,
    code,
    name: `Card ${code}`,
    imageUrl: `/images/${code}.jpg`,
  };
}

function catalogOf(...codes: readonly number[]) {
  return new Map(codes.map((code) => [code, card(code)]));
}

function localDeck(
  lists: SelectableDeck["lists"] = { main: [7], extra: [], side: [] },
): SelectableDeck {
  return {
    key: `local:${LOCAL_DECK_ID}:3`,
    label: "Built Deck",
    source: "local",
    selection: {
      kind: "local",
      deck: {
        ref: { type: "local", deckId: LOCAL_DECK_ID, revision: 3 },
        name: "Built Deck",
        main: lists.main,
        extra: lists.extra,
        side: lists.side,
        validationDigest: "digest",
      },
    },
    lists,
    updatedAt: UPDATED_AT,
  };
}

function context(
  overrides: Partial<Parameters<typeof freePlayDeckTile>[1]> = {},
) {
  return {
    catalog: catalogOf(),
    defaultDeckId: null,
    aiOwnerByDeckKey: new Map<string, string>(),
    ...overrides,
  };
}

describe("freePlayDeckTile", () => {
  it("describes a bundled deck an AI owns", () => {
    const cover = PRACTICE.lists.main[0]!;
    const tile = freePlayDeckTile(
      PRACTICE,
      context({
        catalog: catalogOf(cover, PRACTICE.lists.main[0]!),
        aiOwnerByDeckKey: new Map([
          ["preset:chapter-one-practice", "Vault Warden"],
        ]),
      }),
    );

    expect(tile.key).toBe("preset:chapter-one-practice");
    expect(tile.name).toBe(PRACTICE.label);
    expect(tile.bundled).toBe(true);
    expect(tile.meta).toBe("Bundled");
    expect(tile.lockedBy).toBe("Vault Warden");
    /* Chapter 1 practice has no Extra Deck; the first Main card is its cover. */
    expect(tile.coverImageUrl).toBe(`/images/${cover}.jpg`);
    /* Free play never lists a deck it cannot play, so every tile is legal and
       none of them is deletable from a bundled row. */
    expect(tile.legal).toBe(true);
    expect(tile.blockReason).toBeNull();
    expect(tile.deletable).toBe(false);
    expect(tile.updatedAt).toBeNull();
  });

  it("describes a deck the player built", () => {
    const deck = localDeck({ main: [11, 12], extra: [], side: [13] });
    const tile = freePlayDeckTile(
      deck,
      context({
        catalog: catalogOf(11),
        defaultDeckId: LOCAL_DECK_ID,
      }),
    );

    expect(tile.key).toBe(deck.key);
    expect(tile.name).toBe("Built Deck");
    expect(tile.bundled).toBe(false);
    expect(tile.meta).toBe("Local deck");
    expect("favourite" in tile).toBe(false);
    expect(tile.isDefault).toBe(true);
    expect(tile.deletable).toBe(true);
    expect(tile.lockedBy).toBeNull();
    expect(tile.updatedAt).toBe(UPDATED_AT);
    /* No Extra Deck, so the cover falls back to the first Main Deck card. */
    expect(tile.coverImageUrl).toBe("/images/11.jpg");
  });

  /* A key carries the deck revision, so default comparison uses deck id. */
  it("keeps another deck's default off this tile", () => {
    const tile = freePlayDeckTile(
      localDeck(),
      context({ defaultDeckId: deckId("other-deck") }),
    );

    expect(tile.isDefault).toBe(false);
  });

  /* A deck whose cover card this build has no art for still fills its tile:
     the tile draws its own placeholder from a null URL. */
  it("has no cover when the catalog cannot draw one", () => {
    expect(freePlayDeckTile(localDeck(), context()).coverImageUrl).toBeNull();
    expect(
      freePlayDeckTile(
        localDeck({ main: [], extra: [], side: [] }),
        context({ catalog: catalogOf(7) }),
      ).coverImageUrl,
    ).toBeNull();
  });
});
