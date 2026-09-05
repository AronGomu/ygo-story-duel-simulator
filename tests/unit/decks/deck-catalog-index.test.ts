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

  it("matches reference across generated advanced queries and availability", () => {
    const cases: readonly Partial<DeckCatalogQuery["advanced"]>[] = [
      { nameMatch: "exclude", text: "dragon" },
      { text: 'monster -"special summon"' },
      { code: "89631139" },
      { family: "monster" },
      { attribute: "DARK" },
      { race: "Dragon" },
      { summonFrame: "Link" },
      { traits: ["Tuner"] },
      { attack: { op: "eq", value: 3000 } },
      { defense: { op: "lt", value: 2000 } },
      { levelRank: { op: "range", min: 4, max: 8 } },
      { linkRating: { op: "gte", value: 2 } },
      { pendulumScale: { op: "lte", value: 8 } },
      { includeUnknownAttackDefense: true, attack: { op: "eq", value: -2 } },
      { spellProperty: "Quick-Play" },
      { trapProperty: "Counter" },
      { linkMarkerRule: "any", linkMarkers: ["Bottom"] },
      { linkMarkerRule: "all", linkMarkers: ["Bottom", "Left"] },
      { linkMarkerRule: "exact", linkMarkers: ["Bottom"] },
      { restriction: 0 },
      { restriction: 1 },
      { restriction: 2 },
      { restriction: 3 },
    ];
    for (let run = 0; run < 64; run++) {
      const first = cases[run % cases.length]!;
      const second = cases[(run * 7 + 3) % cases.length]!;
      const query: DeckCatalogQuery = {
        ...EMPTY_DECK_CATALOG_QUERY,
        name: run % 4 === 0 ? "dragon" : "",
        advanced: {
          ...EMPTY_DECK_CATALOG_QUERY.advanced,
          ...first,
          ...second,
        },
      };
      const divisor = 2 + (run % 5);
      const isAvailable = ({ code }: { readonly code: number }) =>
        code % divisor !== 0;
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
