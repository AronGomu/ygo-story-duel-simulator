import type { DeckBuilderCardView } from "./ocg-card-mapper.ts";

const COLLATOR = new Intl.Collator("en", { sensitivity: "base" });

export function compareDeckCatalogCards(
  left: DeckBuilderCardView,
  right: DeckBuilderCardView,
): number {
  return COLLATOR.compare(left.name, right.name) || left.code - right.code;
}

export function sortDeckCatalogCards(
  source: readonly DeckBuilderCardView[],
): readonly DeckBuilderCardView[] {
  return Object.freeze([...source].sort(compareDeckCatalogCards));
}
