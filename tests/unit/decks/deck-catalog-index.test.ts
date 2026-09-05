import { describe, expect, it } from "vitest";
import {
  EMPTY_CATALOG_FILTERS,
  catalogTypeOptions,
  filterDeckCatalog,
  type DeckCatalogFilters,
} from "../../../src/decks/catalog/deck-catalog.ts";
import {
  buildDeckCatalogIndex,
  filterDeckCatalogIndex,
} from "../../../src/decks/catalog/deck-catalog-index.ts";
import { PROTOTYPE_CATALOG } from "../../../src/deck-editor/fixtures/catalog.ts";
import { syntheticCatalog } from "../../fixtures/synthetic-catalog.ts";

const CARDS = syntheticCatalog(14_794);
const OPTIONS = catalogTypeOptions(CARDS);
const query = (
  name: string,
  ids: readonly string[] = [],
): DeckCatalogFilters => ({
  name,
  types: OPTIONS.filter((option) => ids.includes(option.id)),
});

const FILTERS: readonly DeckCatalogFilters[] = [
  EMPTY_CATALOG_FILTERS,
  query("blue-eyes"),
  query("", ["family:monster"]),
  query("", ["family:spell"]),
  query("", ["family:monster", "attribute:DARK"]),
  query("", ["subtype:Normal", "attribute:DARK", "race:Dragon"]),
  query("", ["family:monster", "family:spell"]),
  query("dragon", ["attribute:DARK", "race:Dragon"]),
];

describe("deck-catalog-index", () => {
  const index = buildDeckCatalogIndex(CARDS);

  for (const filters of FILTERS) {
    it(`matches reference for ${JSON.stringify(filters)}`, () => {
      expect([...filterDeckCatalogIndex(index, filters)]).toEqual([
        ...filterDeckCatalog(CARDS, filters),
      ]);
    });
  }

  it("matches reference on small fixture with cross-category AND", () => {
    const options = catalogTypeOptions(PROTOTYPE_CATALOG);
    const filters = {
      name: "",
      types: options.filter(({ id }) =>
        ["attribute:DARK", "race:Spellcaster"].includes(id),
      ),
    };
    expect(
      filterDeckCatalogIndex(buildDeckCatalogIndex(PROTOTYPE_CATALOG), filters),
    ).toEqual(filterDeckCatalog(PROTOTYPE_CATALOG, filters));
    expect(
      filterDeckCatalogIndex(
        buildDeckCatalogIndex(PROTOTYPE_CATALOG),
        filters,
      ).map(({ name }) => name),
    ).toEqual(["Dark Magician"]);
  });
});
