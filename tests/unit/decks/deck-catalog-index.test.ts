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
import { availableCopies } from "../../../src/deck-editor/catalog-availability.ts";
import type { CardOwnership } from "../../../src/decks/card-ownership.ts";
import type { DeckBuilderCardView } from "../../../src/decks/catalog/ocg-card-mapper.ts";
import {
  PROTOTYPE_RULESET,
  quantityLimit,
} from "../../../src/decks/catalog/pinned-ruleset.ts";
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

function oracleNumeric(
  value: number,
  criterion: NonNullable<DeckCatalogQuery["advanced"]["attack"]>,
): boolean {
  if (criterion.op === "range")
    return (
      (criterion.min === null || value >= criterion.min) &&
      (criterion.max === null || value <= criterion.max)
    );
  if (criterion.op === "eq") return value === criterion.value;
  if (criterion.op === "lt") return value < criterion.value;
  if (criterion.op === "lte") return value <= criterion.value;
  if (criterion.op === "gt") return value > criterion.value;
  return value >= criterion.value;
}

function oracleText(description: string, query: string): boolean {
  const terms = [
    ...query.toLowerCase().matchAll(/(-?)"([^"]*)"|(-?)"([^"]*)$|(-?\S+)/gu),
  ];
  return terms.every((match) => {
    const raw = match[2] ?? match[4] ?? match[5] ?? "";
    const excluded =
      match[1] === "-" || match[3] === "-" || raw.startsWith("-");
    const value = (raw.startsWith("-") ? raw.slice(1) : raw).trim();
    return (
      value === "" || description.toLowerCase().includes(value) !== excluded
    );
  });
}

function oracleAdvanced(
  card: DeckBuilderCardView,
  query: DeckCatalogQuery,
): boolean {
  const filter = query.advanced;
  const name = card.name.toLowerCase();
  const needle = query.name.trim().toLowerCase();
  if (needle) {
    if (filter.nameMatch === "contains" && !name.includes(needle)) return false;
    if (filter.nameMatch === "exact" && name !== needle) return false;
    if (filter.nameMatch === "starts-with" && !name.startsWith(needle))
      return false;
    if (filter.nameMatch === "exclude" && name.includes(needle)) return false;
  }
  const code = filter.code.trim();
  if (/^\d{8}$/u.test(code) && card.code !== Number(code)) return false;
  if (!oracleText(card.description, filter.text)) return false;
  if (filter.family !== null && card.family !== filter.family) return false;
  if (filter.attribute !== null && card.attribute !== filter.attribute)
    return false;
  if (filter.race !== null && card.race !== filter.race) return false;
  if (
    filter.summonFrame !== null &&
    !card.subtypes.includes(filter.summonFrame)
  )
    return false;
  if (!filter.traits.every((trait) => card.subtypes.includes(trait)))
    return false;
  for (const [criterion, value] of [
    [filter.attack, card.attack],
    [filter.defense, card.defense],
  ] as const) {
    if (
      criterion !== null &&
      (value === null ||
        (value < 0 && !filter.includeUnknownAttackDefense) ||
        !oracleNumeric(value, criterion))
    )
      return false;
  }
  if (
    filter.levelRank !== null &&
    (card.levelRankLink === null ||
      !["Level", "Rank"].includes(card.ratingLabel ?? "") ||
      !oracleNumeric(card.levelRankLink, filter.levelRank))
  )
    return false;
  if (
    filter.linkRating !== null &&
    (card.ratingLabel !== "Link" ||
      card.levelRankLink === null ||
      !oracleNumeric(card.levelRankLink, filter.linkRating))
  )
    return false;
  if (
    filter.pendulumScale !== null &&
    (card.pendulumScales === null ||
      !card.pendulumScales.some((value) =>
        oracleNumeric(value, filter.pendulumScale!),
      ))
  )
    return false;
  const property = (values: readonly string[]) =>
    values.find((value) => card.subtypes.includes(value)) ?? "Normal";
  if (
    filter.spellProperty !== null &&
    (card.family !== "spell" ||
      property(["Continuous", "Equip", "Field", "Quick-Play", "Ritual"]) !==
        filter.spellProperty)
  )
    return false;
  if (
    filter.trapProperty !== null &&
    (card.family !== "trap" ||
      property(["Continuous", "Counter"]) !== filter.trapProperty)
  )
    return false;
  if (filter.linkMarkers.length > 0) {
    if (card.ratingLabel !== "Link") return false;
    const hits = filter.linkMarkers.filter((marker) =>
      card.linkMarkers.includes(marker),
    ).length;
    if (filter.linkMarkerRule === "any" && hits === 0) return false;
    if (filter.linkMarkerRule === "all" && hits !== filter.linkMarkers.length)
      return false;
    if (
      filter.linkMarkerRule === "exact" &&
      (hits !== filter.linkMarkers.length ||
        card.linkMarkers.length !== filter.linkMarkers.length)
    )
      return false;
  }
  return query.types.every((tag) => {
    if (tag.category === "family") return card.family === tag.value;
    if (tag.category === "subtype") return card.subtypes.includes(tag.value);
    if (tag.category === "attribute") return card.attribute === tag.value;
    return card.race === tag.value;
  });
}

function independentFilter(
  cards: readonly DeckBuilderCardView[],
  query: DeckCatalogQuery,
  isAvailable: (card: DeckBuilderCardView) => boolean,
): readonly DeckBuilderCardView[] {
  return cards
    .filter((card) => isAvailable(card) && oracleAdvanced(card, query))
    .sort(
      (left, right) =>
        left.name.localeCompare(right.name, "en", { sensitivity: "base" }) ||
        left.code - right.code,
    );
}

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
        independentFilter(CARDS, query, isAvailable),
      );
    }
  });

  it("applies each restriction with ownership and used-copy availability", () => {
    const ownership: CardOwnership = {
      isUnlimited: false,
      ownedCount: (code) => (code === 44095762 ? 0 : 3),
    };
    const copies = new Map([[12580477, 1]]);
    const counts: number[] = [];
    for (const restriction of [0, 1, 2, 3] as const) {
      const filters = {
        ...EMPTY_DECK_CATALOG_QUERY,
        advanced: { ...EMPTY_DECK_CATALOG_QUERY.advanced, restriction },
      };
      const available = (card: DeckBuilderCardView) => {
        const limit = quantityLimit(PROTOTYPE_RULESET, card.code);
        return (
          limit === restriction &&
          availableCopies(
            card.code,
            ownership,
            limit,
            copies.get(card.code) ?? 0,
          ) > 0
        );
      };
      const actual = filterDeckCatalogIndex(
        buildDeckCatalogIndex(PROTOTYPE_CATALOG),
        filters,
        available,
      );
      expect(actual).toEqual(
        independentFilter(PROTOTYPE_CATALOG, filters, available),
      );
      expect(
        actual.every(
          (card) => quantityLimit(PROTOTYPE_RULESET, card.code) === restriction,
        ),
      ).toBe(true);
      counts.push(actual.length);
    }
    expect(counts).toEqual([0, 0, 0, 21]);
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
