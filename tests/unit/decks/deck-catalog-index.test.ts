import { describe, expect, it } from "vitest";
import {
  EMPTY_DECK_CATALOG_QUERY,
  catalogTypeOptions,
  filterDeckCatalog,
  type DeckCatalogQuery,
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
): DeckCatalogQuery => ({
  ...EMPTY_DECK_CATALOG_QUERY,
  name,
  types: OPTIONS.filter((option) => ids.includes(option.id)),
});

const AVAILABLE = () => true;
const FILTERS: readonly DeckCatalogQuery[] = [
  EMPTY_DECK_CATALOG_QUERY,
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
      expect([...filterDeckCatalogIndex(index, filters, AVAILABLE)]).toEqual([
        ...filterDeckCatalog(CARDS, filters, AVAILABLE),
      ]);
    });
  }

  it("matches reference for generated advanced queries and availability", () => {
    const advancedQueries = [
      { nameMatch: "exclude" as const, text: "dragon" },
      {
        family: "monster" as const,
        attack: { op: "gte" as const, value: 2000 },
      },
      {
        summonFrame: "Link" as const,
        linkMarkerRule: "any" as const,
        linkMarkers: ["Bottom"],
      },
      { restriction: 1 as const },
    ];
    for (const advanced of advancedQueries) {
      const query = {
        ...EMPTY_DECK_CATALOG_QUERY,
        name: advanced.nameMatch === "exclude" ? "synthetic" : "",
        advanced: { ...EMPTY_DECK_CATALOG_QUERY.advanced, ...advanced },
      };
      const isAvailable = ({ code }: { readonly code: number }) =>
        code % 3 !== 0;
      expect(filterDeckCatalogIndex(index, query, isAvailable)).toEqual(
        filterDeckCatalog(CARDS, query, isAvailable),
      );
    }
  });

  it("matches reference on small fixture with cross-category AND", () => {
    const options = catalogTypeOptions(PROTOTYPE_CATALOG);
    const filters = {
      ...EMPTY_DECK_CATALOG_QUERY,
      name: "",
      types: options.filter(({ id }) =>
        ["attribute:DARK", "race:Spellcaster"].includes(id),
      ),
    };
    expect(
      filterDeckCatalogIndex(
        buildDeckCatalogIndex(PROTOTYPE_CATALOG),
        filters,
        AVAILABLE,
      ),
    ).toEqual(filterDeckCatalog(PROTOTYPE_CATALOG, filters, AVAILABLE));
    expect(
      filterDeckCatalogIndex(
        buildDeckCatalogIndex(PROTOTYPE_CATALOG),
        filters,
        AVAILABLE,
      ).map(({ name }) => name),
    ).toEqual(["Dark Magician"]);
  });
});
