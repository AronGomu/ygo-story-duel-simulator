import type { DeckBuilderCardView } from "./ocg-card-mapper.ts";

export interface DeckCatalogFilters {
  readonly name: string;
  readonly family: "monster" | "spell" | "trap" | null;
  readonly subtype: string | null;
  readonly attribute: string | null;
  readonly race: string | null;
}

export const EMPTY_CATALOG_FILTERS: DeckCatalogFilters = Object.freeze({
  name: "",
  family: null,
  subtype: null,
  attribute: null,
  race: null,
});

export function filterDeckCatalog(
  cards: readonly DeckBuilderCardView[],
  filters: DeckCatalogFilters,
): readonly DeckBuilderCardView[] {
  const name = filters.name.trim().toLocaleLowerCase();
  return Object.freeze(
    cards.filter(
      (card) =>
        (name.length === 0 || card.name.toLocaleLowerCase().includes(name)) &&
        (filters.family === null || card.family === filters.family) &&
        (filters.subtype === null || card.subtypes.includes(filters.subtype)) &&
        (filters.attribute === null || card.attribute === filters.attribute) &&
        (filters.race === null || card.race === filters.race),
    ),
  );
}

export function catalogFilterOptions(cards: readonly DeckBuilderCardView[]): {
  readonly subtypes: readonly string[];
  readonly attributes: readonly string[];
  readonly races: readonly string[];
} {
  const values = (items: readonly (string | null)[]): readonly string[] =>
    Object.freeze(
      [
        ...new Set(items.filter((item): item is string => item !== null)),
      ].sort(),
    );
  return Object.freeze({
    subtypes: values(cards.flatMap((card) => card.subtypes)),
    attributes: values(cards.map((card) => card.attribute)),
    races: values(cards.map((card) => card.race)),
  });
}
