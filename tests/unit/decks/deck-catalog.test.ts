import { describe, expect, it } from "vitest";
import {
  EMPTY_CATALOG_FILTERS,
  cardMatchesCatalogType,
  catalogTypeOptions,
  filterDeckCatalog,
  type CatalogTypeTag,
} from "../../../src/decks/catalog/deck-catalog.ts";
import { PROTOTYPE_CATALOG } from "../../../src/deck-editor/fixtures/catalog.ts";

function tag(
  category: CatalogTypeTag["category"],
  value: string,
  label = value,
): CatalogTypeTag {
  return { id: `${category}:${value}`, category, value, label };
}

describe("deck catalog filters", () => {
  it("filters case-insensitive names", () => {
    expect(
      filterDeckCatalog(PROTOTYPE_CATALOG, {
        ...EMPTY_CATALOG_FILTERS,
        name: "blue-eyes",
      }).map(({ name }) => name),
    ).toEqual(["Blue-Eyes White Dragon"]);
  });

  it("ANDs tags across categories", () => {
    expect(
      filterDeckCatalog(PROTOTYPE_CATALOG, {
        name: "",
        types: [tag("attribute", "DARK"), tag("race", "Spellcaster")],
      }).map(({ name }) => name),
    ).toEqual(["Dark Magician"]);
  });

  it("ANDs same-category subtype tags", () => {
    const fusionEffect = PROTOTYPE_CATALOG.find(
      (card) =>
        card.subtypes.includes("Fusion") && card.subtypes.includes("Effect"),
    );
    expect(fusionEffect).toBeDefined();
    expect(
      filterDeckCatalog(PROTOTYPE_CATALOG, {
        name: "",
        types: [tag("subtype", "Fusion"), tag("subtype", "Effect")],
      }),
    ).toContainEqual(fusionEffect);
  });

  it("returns no cards for contradictory family tags", () => {
    expect(
      filterDeckCatalog(PROTOTYPE_CATALOG, {
        name: "",
        types: [
          tag("family", "monster", "Monster"),
          tag("family", "spell", "Spell"),
        ],
      }),
    ).toEqual([]);
  });

  it("builds stable unique category-aware options from loaded cards", () => {
    const options = catalogTypeOptions([
      PROTOTYPE_CATALOG[0]!,
      PROTOTYPE_CATALOG[0]!,
      PROTOTYPE_CATALOG.find((card) => card.family === "spell")!,
    ]);
    expect(new Set(options.map(({ id }) => id)).size).toBe(options.length);
    expect(options).toContainEqual(tag("family", "monster", "Monster"));
    expect(options).toContainEqual(tag("family", "spell", "Spell"));
    expect(Object.isFrozen(options)).toBe(true);
    expect(options).toEqual(
      [...options].sort((left, right) => {
        const categories = ["family", "subtype", "attribute", "race"];
        return (
          categories.indexOf(left.category) -
            categories.indexOf(right.category) ||
          left.label.localeCompare(right.label, "en") ||
          left.id.localeCompare(right.id, "en")
        );
      }),
    );
  });

  it("matches tags only against their own card field", () => {
    const darkMagician = PROTOTYPE_CATALOG.find(
      ({ name }) => name === "Dark Magician",
    )!;
    expect(cardMatchesCatalogType(darkMagician, tag("attribute", "DARK"))).toBe(
      true,
    );
    expect(cardMatchesCatalogType(darkMagician, tag("race", "DARK"))).toBe(
      false,
    );
  });
});
