import { describe, expect, it } from "vitest";
import { deckId } from "../../../src/decks/deck-contracts.ts";
import { emptyDeckHistory } from "../../../src/decks/deck-history.ts";
import { createBlankDeck } from "../../../src/decks/deck-model.ts";
import { resolveDeck } from "../../../src/decks/deck-resolver.ts";
import { validateDeckDraft } from "../../../src/decks/deck-validation.ts";
import {
  catalogByCode,
  PROTOTYPE_RULESET,
  quantityLimit,
} from "../../../src/decks/catalog/pinned-ruleset.ts";
import { PROTOTYPE_CATALOG } from "../../../src/prototypes/deck-builder/fixtures/catalog.ts";

const catalog = catalogByCode(PROTOTYPE_CATALOG);
const codes = PROTOTYPE_CATALOG.filter(
  (card) =>
    card.canonicalZone === "main" &&
    quantityLimit(PROTOTYPE_RULESET, card.code) === 3,
).map(({ code }) => code);
const validMain = Array.from(
  { length: 40 },
  (_, index) => codes[index % codes.length]!,
);

function reader(deck: ReturnType<typeof createBlankDeck> | null) {
  return {
    load: async () =>
      deck === null ? null : { deck, history: emptyDeckHistory() },
  };
}

describe("resolveDeck", () => {
  it("returns immutable ready snapshots for valid deck IDs", async () => {
    const base = createBlankDeck("Valid", catalog, PROTOTYPE_RULESET, {
      id: "valid",
    });
    const deck = {
      ...base,
      revision: 4,
      main: validMain,
      validation: validateDeckDraft(
        { main: validMain, extra: [], side: [] },
        catalog,
        PROTOTYPE_RULESET,
      ),
    };
    const result = await resolveDeck(
      deck.id,
      reader(deck),
      catalog,
      PROTOTYPE_RULESET,
    );
    expect(result.type).toBe("ready");
    if (result.type === "ready") {
      expect(result.deck.ref).toEqual({
        type: "local",
        deckId: deck.id,
        revision: 4,
      });
      expect(result.deck.main).toHaveLength(40);
      expect(result.deck.validationDigest).toMatch(/^fnv1a-/);
    }
  });

  it("returns invalid and missing without module-owned selection state", async () => {
    const invalid = createBlankDeck("Invalid", catalog, PROTOTYPE_RULESET, {
      id: "invalid",
    });
    await expect(
      resolveDeck(invalid.id, reader(invalid), catalog, PROTOTYPE_RULESET),
    ).resolves.toMatchObject({ type: "invalid", deckId: invalid.id });
    await expect(
      resolveDeck(deckId("missing"), reader(null), catalog, PROTOTYPE_RULESET),
    ).resolves.toEqual({ type: "missing", deckId: "missing" });
  });
});
