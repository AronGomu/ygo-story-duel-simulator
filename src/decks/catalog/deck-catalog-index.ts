import type { DeckBuilderCardView } from "./ocg-card-mapper.ts";
import {
  EMPTY_ADVANCED_DECK_CATALOG_FILTERS,
  compileAdvancedDeckCatalogMatcher,
  prepareAdvancedDeckCatalogIndex,
} from "./deck-catalog-advanced.ts";
import type { DeckCatalogQuery } from "./deck-catalog.ts";
import type { DeckCatalogIndex } from "./deck-catalog-index-base.ts";

export {
  buildDeckCatalogIndex,
  filterQuickDeckCatalogIndex,
  type DeckCatalogIndex,
} from "./deck-catalog-index-base.ts";

export function filterDeckCatalogIndex(
  index: DeckCatalogIndex,
  query: DeckCatalogQuery,
  isAvailable: (card: DeckBuilderCardView) => boolean,
): readonly DeckBuilderCardView[] {
  const needle = query.name.trim().toLowerCase();
  const nameMode = query.advanced.nameMatch;
  const matchesAdvanced =
    query.advanced === EMPTY_ADVANCED_DECK_CATALOG_FILTERS
      ? null
      : compileAdvancedDeckCatalogMatcher(query.advanced);
  const advanced = prepareAdvancedDeckCatalogIndex(index);
  if (
    query.types.length === 0 &&
    matchesAdvanced === null &&
    nameMode === "contains"
  ) {
    const out: DeckBuilderCardView[] = [];
    for (let position = 0; position < advanced.order.length; position++) {
      const offset = advanced.order[position]!;
      const card = index.cards[offset]!;
      if (
        isAvailable(card) &&
        (needle.length === 0 || index.lowerNames[offset]!.includes(needle))
      )
        out.push(card);
    }
    return Object.freeze(out);
  }
  let family: string | null = null;
  let attribute: string | null = null;
  let race: string | null = null;
  const subtypes: string[] = [];
  for (const tag of query.types)
    switch (tag.category) {
      case "family":
        if (family !== null && family !== tag.value) return Object.freeze([]);
        family = tag.value;
        break;
      case "attribute":
        if (attribute !== null && attribute !== tag.value)
          return Object.freeze([]);
        attribute = tag.value;
        break;
      case "race":
        if (race !== null && race !== tag.value) return Object.freeze([]);
        race = tag.value;
        break;
      case "subtype":
        if (!subtypes.includes(tag.value)) subtypes.push(tag.value);
    }
  const out: DeckBuilderCardView[] = [];
  cardLoop: for (
    let position = 0;
    position < advanced.order.length;
    position++
  ) {
    const offset = advanced.order[position]!;
    const card = index.cards[offset]!;
    if (!isAvailable(card)) continue;
    if (needle) {
      const name = index.lowerNames[offset]!;
      if (
        nameMode === "contains"
          ? !name.includes(needle)
          : nameMode === "exact"
            ? name !== needle
            : nameMode === "starts-with"
              ? !name.startsWith(needle)
              : name.includes(needle)
      )
        continue;
    }
    if (family !== null && card.family !== family) continue;
    if (attribute !== null && card.attribute !== attribute) continue;
    if (race !== null && card.race !== race) continue;
    for (let subtype = 0; subtype < subtypes.length; subtype++)
      if (!card.subtypes.includes(subtypes[subtype]!)) continue cardLoop;
    if (matchesAdvanced !== null && !matchesAdvanced(card)) continue;
    out.push(card);
  }
  return Object.freeze(out);
}
