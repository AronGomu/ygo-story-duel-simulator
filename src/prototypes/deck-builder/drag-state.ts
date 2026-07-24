import type { DeckZone } from "../../decks/deck-contracts.ts";

export type PickedCard = Readonly<{
  code: number;
  source: "catalog" | DeckZone;
}>;
