import type { DeckBuilderCardView } from "./ocg-card-mapper.ts";

export type CatalogTypeCategory = "family" | "subtype" | "attribute" | "race";

export interface CatalogTypeTag {
  readonly id: `${CatalogTypeCategory}:${string}`;
  readonly category: CatalogTypeCategory;
  readonly value: string;
  readonly label: string;
}

export interface DeckCatalogFilters {
  readonly name: string;
  readonly types: readonly CatalogTypeTag[];
}

export const EMPTY_CATALOG_FILTERS: DeckCatalogFilters = Object.freeze({
  name: "",
  types: Object.freeze([]),
});

export function cardMatchesCatalogType(
  card: DeckBuilderCardView,
  tag: CatalogTypeTag,
): boolean {
  switch (tag.category) {
    case "family":
      return card.family === tag.value;
    case "subtype":
      return card.subtypes.includes(tag.value);
    case "attribute":
      return card.attribute === tag.value;
    case "race":
      return card.race === tag.value;
  }
}

const CATEGORIES: readonly CatalogTypeCategory[] = [
  "family",
  "subtype",
  "attribute",
  "race",
];
const FAMILY_LABELS = Object.freeze({
  monster: "Monster",
  spell: "Spell",
  trap: "Trap",
});

function tag(
  category: CatalogTypeCategory,
  value: string,
  label = value,
): CatalogTypeTag {
  return Object.freeze({ id: `${category}:${value}`, category, value, label });
}

export function catalogTypeOptions(
  cards: readonly DeckBuilderCardView[],
): readonly CatalogTypeTag[] {
  const families = new Set<DeckBuilderCardView["family"]>();
  const subtypes = new Set<string>();
  const attributes = new Set<string>();
  const races = new Set<string>();
  for (const card of cards) {
    families.add(card.family);
    card.subtypes.forEach((value) => subtypes.add(value));
    if (card.attribute !== null) attributes.add(card.attribute);
    if (card.race !== null) races.add(card.race);
  }
  return Object.freeze(
    [
      ...[...families].map((value) =>
        tag("family", value, FAMILY_LABELS[value]),
      ),
      ...[...subtypes].map((value) => tag("subtype", value)),
      ...[...attributes].map((value) => tag("attribute", value)),
      ...[...races].map((value) => tag("race", value)),
    ].sort(
      (left, right) =>
        CATEGORIES.indexOf(left.category) -
          CATEGORIES.indexOf(right.category) ||
        left.label.localeCompare(right.label, "en") ||
        left.id.localeCompare(right.id, "en"),
    ),
  );
}
