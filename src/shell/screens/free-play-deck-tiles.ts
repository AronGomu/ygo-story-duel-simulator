import type { SelectableDeck } from "../../battle/index.ts";
import type { DeckTileModel } from "../../deck-select/index.ts";
import type { DeckBuilderCardView } from "../../decks/catalog/ocg-card-mapper.ts";
import { deckCoverImageUrl } from "../../decks/deck-cover.ts";

/** What free play knows about its decks beyond the decks themselves: cover
    art, default deck, and any exclusive AI owner of a bundled deck. */
export interface FreePlayDeckTileContext {
  readonly catalog: ReadonlyMap<number, DeckBuilderCardView>;
  /** The repository's default deck id, or `null` when none is set. */
  readonly defaultDeckId: string | null;
  /** Deck key → its sole AI owner; shared/unassigned roster decks are omitted. */
  readonly aiOwnerByDeckKey: ReadonlyMap<string, string>;
}

/**
 * One free-play deck as the shared selection screen renders it.
 *
 * Every deck the listing offers is playable — `listSelectableDecks` drops the
 * ones the pinned ruleset or the card snapshot refuses — so a tile from here
 * is always legal and never carries a block reason. The screen still has both
 * fields because the deck library will show refused decks with the reason;
 * free play simply never sees one.
 */
export function freePlayDeckTile(
  deck: SelectableDeck,
  context: FreePlayDeckTileContext,
): DeckTileModel {
  /* The deck id rather than the key's middle segment: a key carries the
     revision as well, and an id is only forbidden to contain `\0`, so parsing
     one back out of the key would be a guess where the selection is a fact. */
  const localId =
    deck.selection.kind === "local" ? deck.selection.deck.ref.deckId : null;
  /* The Extra Deck's first card is the deck's face — it names the strategy in
     a way the first Main Deck card rarely does — and derived per listing, so a
     deck edited into another theme never keeps yesterday's cover. */
  return {
    key: deck.key,
    name: deck.label,
    meta: deck.source === "preset" ? "Bundled" : "Local deck",
    coverImageUrl: deckCoverImageUrl(
      { ...deck.lists, illustrationCardCode: null },
      context.catalog,
    ),
    legal: true,
    blockReason: null,
    bundled: deck.source === "preset",
    lockedBy: context.aiOwnerByDeckKey.get(deck.key) ?? null,
    isDefault: localId !== null && localId === context.defaultDeckId,
    deletable: deck.source === "local",
    updatedAt: deck.updatedAt,
  };
}
