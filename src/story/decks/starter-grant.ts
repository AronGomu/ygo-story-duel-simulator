/* The deck a new story save opens with, and the cards behind it.

   Built without a catalog on purpose: `reduceStory` is a pure synchronous
   function while `runtimeCatalog()` is an asynchronous read of 64 card shards
   and 64 text shards, so `new-game` has no catalog to wait for and must not
   start one. Only the card-level checks in `validateDeckDraft` need it, and
   the verdict stored here is a cache rather than an authority: `resolveDeck`
   and the editor's library refresh both recompute it against the live catalog
   before anything reads it, and the save layer checks only its shape. What a
   catalog would decide is pinned by `tests/unit/decks/starter-deck.test.ts`
   instead, which validates the same list against the real card database. */

import legacyStarterYdk from "../../decks/starter-deck.ydk?raw";
import type { DeckBuilderCardView } from "../../decks/catalog/ocg-card-mapper.ts";
import { PROTOTYPE_RULESET } from "../../decks/catalog/pinned-ruleset.ts";
import type { DeckCardLists } from "../../decks/deck-contracts.ts";
import { applyDeckCommand, createBlankDeck } from "../../decks/deck-model.ts";
import { validateDeckDraft } from "../../decks/deck-validation.ts";
import {
  STARTER_DECK_LIST,
  STARTER_DECK_NAME,
} from "../../decks/starter-deck.ts";
import { importYdk } from "../../decks/ydk-adapter.ts";
import type { StoryDeck } from "../model/story-state.ts";

const EMPTY_CATALOG: ReadonlyMap<number, DeckBuilderCardView> = new Map();

/* Fixed rather than generated, so two new games produce the same deck byte for
   byte and a save can be diffed against another without the identifiers moving
   underneath. Only one save ever holds this id, because a grant only happens
   where there is no library yet. */
const STARTER_DECK_ID = "story-starter-deck";
const STARTER_DECK_STAMP = "2026-08-20T00:00:00.000Z";

export interface StarterGrant {
  readonly deck: StoryDeck;
  /** Owned count per card code, in the shape the save's collection uses. */
  readonly collection: Readonly<Record<number, number>>;
}

export function buildStarterGrant(): StarterGrant {
  return grantFromList(STARTER_DECK_LIST, STARTER_DECK_NAME);
}

/** Old-schema reads must not grant a different historical deck after an update. */
export function buildLegacyStarterGrant(): StarterGrant {
  return grantFromList(legacyStarterYdk, "Starter Deck");
}

function grantFromList(source: string, name: string): StarterGrant {
  const imported = importYdk(source);
  /* Unreachable in a build that shipped — the list is compiled in, not player
     input — and refused rather than swallowed, because a save granted half a
     deck is worse than a new game that will not start. */
  if (imported.type !== "ready")
    throw new Error(`Starter deck list is unreadable: ${imported.message}`);
  const draft = createBlankDeck(name, EMPTY_CATALOG, PROTOTYPE_RULESET, {
    id: STARTER_DECK_ID,
    now: new Date(STARTER_DECK_STAMP),
  });
  const result = applyDeckCommand(
    draft,
    { type: "import", cards: imported.cards },
    EMPTY_CATALOG,
    PROTOTYPE_RULESET,
  );
  if (result.type === "rejected") throw new Error(result.reason);
  /* Not flagged for import review: the player did not import this list, the
     build granted it, and a review banner on a deck nobody chose is noise. */
  const cards = { ...result.cards, importedNeedsReview: false };
  return Object.freeze({
    deck: Object.freeze({
      ...draft,
      ...cards,
      validation: validateDeckDraft(cards, EMPTY_CATALOG, PROTOTYPE_RULESET),
    }),
    collection: Object.freeze(copiesByCode(result.cards)),
  });
}

/* Every copy the deck uses, credited to the collection: a deck built from cards
   the save does not own is a deck the ownership rule refuses at the first duel,
   which is the whole point of granting the two together.

   Counts only, and no rarity: the collection is code to count, and what a card
   sells for is decided at sell time by `resolveCardRarity` from the shop's own
   set data. The grant cannot price what it gives away; capping that belongs
   to the economy and the save schema, not here. */
function copiesByCode(cards: DeckCardLists): Record<number, number> {
  const counts: Record<number, number> = {};
  for (const code of [...cards.main, ...cards.extra, ...cards.side])
    counts[code] = (counts[code] ?? 0) + 1;
  return counts;
}
