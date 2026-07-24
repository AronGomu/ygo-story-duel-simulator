import type { DeckBuilderState } from "../../src/prototypes/deck-builder/deck-builder-store.ts";
import type { DeckRecord } from "../../src/decks/deck-contracts.ts";
import { createBlankDeck } from "../../src/decks/deck-model.ts";
import { emptyDeckHistory } from "../../src/decks/deck-history.ts";
import { validateDeckDraft } from "../../src/decks/deck-validation.ts";
import {
  catalogByCode,
  PROTOTYPE_RULESET,
  quantityLimit,
} from "../../src/decks/catalog/pinned-ruleset.ts";
import { PROTOTYPE_CATALOG } from "../../src/prototypes/deck-builder/fixtures/catalog.ts";

export const prototypeCatalogMap = catalogByCode(PROTOTYPE_CATALOG);
const mainCodes = PROTOTYPE_CATALOG.filter(
  (card) =>
    card.canonicalZone === "main" &&
    quantityLimit(PROTOTYPE_RULESET, card.code) === 3,
).map(({ code }) => code);

export function deckFixture(mainCount = 0): DeckRecord {
  const base = createBlankDeck(
    "Prototype Control",
    prototypeCatalogMap,
    PROTOTYPE_RULESET,
    {
      id: "prototype-control",
      now: new Date("2026-01-01T00:00:00.000Z"),
    },
  );
  const main = Array.from(
    { length: mainCount },
    (_, index) => mainCodes[index % mainCodes.length]!,
  );
  return Object.freeze({
    ...base,
    revision: 1,
    main: Object.freeze(main),
    validation: validateDeckDraft(
      { main, extra: [], side: [] },
      prototypeCatalogMap,
      PROTOTYPE_RULESET,
    ),
  });
}

export function stateFixture(mainCount = 0): DeckBuilderState {
  const deck = deckFixture(mainCount);
  return Object.freeze({
    mode: "editor",
    decks: Object.freeze([deck]),
    current: Object.freeze({ deck, history: emptyDeckHistory() }),
    saveState: "saved",
    message: null,
  });
}
