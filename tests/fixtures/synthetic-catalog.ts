import type { DeckBuilderCardView } from "../../src/decks/catalog/ocg-card-mapper.ts";
import { PROTOTYPE_CATALOG } from "../../src/deck-editor/fixtures/catalog.ts";

/**
 * Generates `count` synthetic `DeckBuilderCardView` entries by cloning the
 * prototype cards round-robin, assigning unique codes and suffixed names.
 * Used in performance tests and differential tests.
 */
export function syntheticCatalog(
  count: number,
): readonly DeckBuilderCardView[] {
  const proto = PROTOTYPE_CATALOG;
  return Array.from({ length: count }, (_, i) => {
    const base = proto[i % proto.length]!;
    return {
      ...base,
      code: base.code + i * 1_000_000,
      name: `${base.name} ${i}`,
    };
  });
}

/** Deterministic catalog with production-like name-prefix diversity. */
export function highEntropyCatalog(
  count: number,
): readonly DeckBuilderCardView[] {
  const proto = PROTOTYPE_CATALOG;
  return Array.from({ length: count }, (_, i) => {
    const base = proto[i % proto.length]!;
    const prefix = (Math.imul(i + 1, 2_654_435_761) >>> 0)
      .toString(36)
      .padStart(7, "0");
    const punctuation = i % 97 === 0 ? '"' : i % 89 === 0 ? "@" : "";
    const accent = i % 211 === 0 ? "é" : "";
    return {
      ...base,
      code: base.code + i * 1_000_000,
      name: `${punctuation}${prefix}${accent} ${base.name} ${i}`,
    };
  });
}
