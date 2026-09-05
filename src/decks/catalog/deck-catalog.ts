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

const EMPTY_TYPES: readonly CatalogTypeTag[] = Object.freeze([]);

export const EMPTY_CATALOG_FILTERS: DeckCatalogFilters = Object.freeze({
  name: "",
  types: EMPTY_TYPES,
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

const TYPE_CATEGORY_ORDER: readonly CatalogTypeCategory[] = [
  "family",
  "subtype",
  "attribute",
  "race",
];

const FAMILY_LABELS: Readonly<Record<DeckBuilderCardView["family"], string>> =
  Object.freeze({ monster: "Monster", spell: "Spell", trap: "Trap" });

function typeTag(
  category: CatalogTypeCategory,
  value: string,
  label = value,
): CatalogTypeTag {
  return Object.freeze({
    id: `${category}:${value}`,
    category,
    value,
    label,
  });
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
    for (const subtype of card.subtypes) subtypes.add(subtype);
    if (card.attribute !== null) attributes.add(card.attribute);
    if (card.race !== null) races.add(card.race);
  }

  const options = [
    ...[...families].map((value) =>
      typeTag("family", value, FAMILY_LABELS[value]),
    ),
    ...[...subtypes].map((value) => typeTag("subtype", value)),
    ...[...attributes].map((value) => typeTag("attribute", value)),
    ...[...races].map((value) => typeTag("race", value)),
  ];
  options.sort(
    (left, right) =>
      TYPE_CATEGORY_ORDER.indexOf(left.category) -
        TYPE_CATEGORY_ORDER.indexOf(right.category) ||
      left.label.localeCompare(right.label, "en") ||
      left.id.localeCompare(right.id, "en"),
  );
  return Object.freeze(options);
}

/* UI uses `filterDeckCatalogIndex`; this obvious predicate remains its
   differential-test oracle. */
export function filterDeckCatalog(
  cards: readonly DeckBuilderCardView[],
  filters: DeckCatalogFilters,
): readonly DeckBuilderCardView[] {
  const name = filters.name.trim().toLocaleLowerCase();
  return Object.freeze(
    cards.filter(
      (card) =>
        (name.length === 0 || card.name.toLocaleLowerCase().includes(name)) &&
        filters.types.every((tag) => cardMatchesCatalogType(card, tag)),
    ),
  );
}
