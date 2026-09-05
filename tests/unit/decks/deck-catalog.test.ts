import { describe, expect, it } from "vitest";
import {
  EMPTY_CATALOG_FILTERS,
  EMPTY_ADVANCED_DECK_CATALOG_FILTERS,
  cardMatchesCatalogType,
  catalogTypeOptions,
  filterDeckCatalog,
  numericCriterionError,
  type AdvancedDeckCatalogFilters,
  type CatalogTypeTag,
  type DeckCatalogQuery,
} from "../../../src/decks/catalog/deck-catalog.ts";
import { PROTOTYPE_CATALOG } from "../../../src/deck-editor/fixtures/catalog.ts";

function tag(
  category: CatalogTypeTag["category"],
  value: string,
  label = value,
): CatalogTypeTag {
  return { id: `${category}:${value}`, category, value, label };
}

const AVAILABLE = () => true;

function advanced(
  overrides: Partial<AdvancedDeckCatalogFilters> = {},
): DeckCatalogQuery {
  return {
    ...EMPTY_CATALOG_FILTERS,
    advanced: { ...EMPTY_ADVANCED_DECK_CATALOG_FILTERS, ...overrides },
  };
}

describe("deck catalog filters", () => {
  it("filters case-insensitive names", () => {
    expect(
      filterDeckCatalog(
        PROTOTYPE_CATALOG,
        {
          ...advanced(),
          name: "blue-eyes",
        },
        AVAILABLE,
      ).map(({ name }) => name),
    ).toEqual(["Blue-Eyes White Dragon"]);
  });

  it("ANDs tags across categories", () => {
    expect(
      filterDeckCatalog(
        PROTOTYPE_CATALOG,
        {
          ...advanced(),
          types: [tag("attribute", "DARK"), tag("race", "Spellcaster")],
        },
        AVAILABLE,
      ).map(({ name }) => name),
    ).toEqual(["Dark Magician"]);
  });

  it("ANDs same-category subtype tags", () => {
    const fusionEffect = PROTOTYPE_CATALOG.find(
      (card) =>
        card.subtypes.includes("Fusion") && card.subtypes.includes("Effect"),
    );
    expect(fusionEffect).toBeDefined();
    expect(
      filterDeckCatalog(
        PROTOTYPE_CATALOG,
        {
          ...advanced(),
          types: [tag("subtype", "Fusion"), tag("subtype", "Effect")],
        },
        AVAILABLE,
      ),
    ).toContainEqual(fusionEffect);
  });

  it("returns no cards for contradictory family tags", () => {
    expect(
      filterDeckCatalog(
        PROTOTYPE_CATALOG,
        {
          ...advanced(),
          types: [
            tag("family", "monster", "Monster"),
            tag("family", "spell", "Spell"),
          ],
        },
        AVAILABLE,
      ),
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

  it("applies name modes, text grammar and exact passcode", () => {
    expect(
      filterDeckCatalog(
        PROTOTYPE_CATALOG,
        advanced({ nameMatch: "exact" }),
        AVAILABLE,
      ),
    ).toHaveLength(PROTOTYPE_CATALOG.length);
    expect(
      filterDeckCatalog(
        PROTOTYPE_CATALOG,
        { ...advanced({ nameMatch: "starts-with" }), name: "dark" },
        AVAILABLE,
      ).map(({ name }) => name),
    ).toEqual(["Dark Hole", "Dark Magician"]);
    expect(
      filterDeckCatalog(
        PROTOTYPE_CATALOG,
        advanced({ text: '"special summon" -opponent' }),
        AVAILABLE,
      ).map(({ name }) => name),
    ).toContain("Call of the Haunted");
    expect(
      filterDeckCatalog(
        PROTOTYPE_CATALOG,
        advanced({ code: "46986414" }),
        AVAILABLE,
      ).map(({ name }) => name),
    ).toEqual(["Dark Magician"]);
    expect(
      filterDeckCatalog(
        PROTOTYPE_CATALOG,
        advanced({ code: "4698" }),
        AVAILABLE,
      ),
    ).toHaveLength(PROTOTYPE_CATALOG.length);
  });

  it("applies identity, stats, properties and marker set rules", () => {
    expect(
      filterDeckCatalog(
        PROTOTYPE_CATALOG,
        advanced({
          family: "monster",
          attribute: "EARTH",
          race: "Warrior",
          summonFrame: "Link",
          attack: { op: "gte", value: 1900 },
          linkRating: { op: "eq", value: 2 },
          linkMarkerRule: "exact",
          linkMarkers: ["Bottom", "Left"],
        }),
        AVAILABLE,
      ).map(({ name }) => name),
    ).toEqual(["SPYRAL Double Helix"]);
    expect(
      filterDeckCatalog(
        PROTOTYPE_CATALOG,
        advanced({ spellProperty: "Quick-Play" }),
        AVAILABLE,
      ).map(({ name }) => name),
    ).toEqual(["Dangers of the Divine"]);
    expect(
      filterDeckCatalog(
        PROTOTYPE_CATALOG,
        advanced({ trapProperty: "Counter" }),
        AVAILABLE,
      ).map(({ name }) => name),
    ).toEqual(["Grand Horn of Heaven"]);
  });

  it("rejects invalid numeric criteria and gates observed -2 unknown stats", () => {
    const unknown = {
      ...PROTOTYPE_CATALOG[0]!,
      code: 69838592,
      name: "Unknown",
      attack: -2,
      defense: -2,
    };
    expect(
      filterDeckCatalog(
        [unknown],
        advanced({ attack: { op: "eq", value: -2 } }),
        AVAILABLE,
      ),
    ).toEqual([]);
    expect(
      filterDeckCatalog(
        [unknown],
        advanced({
          attack: { op: "eq", value: -2 },
          includeUnknownAttackDefense: true,
        }),
        AVAILABLE,
      ),
    ).toEqual([unknown]);
    expect(
      filterDeckCatalog(
        PROTOTYPE_CATALOG,
        advanced({ attack: { op: "eq", value: Number.NaN } }),
        AVAILABLE,
      ),
    ).toEqual([]);
    expect(
      filterDeckCatalog(
        PROTOTYPE_CATALOG,
        advanced({ attack: { op: "range", min: 3000, max: 1000 } }),
        AVAILABLE,
      ),
    ).toEqual([]);
  });

  it("supports every numeric operator plus level/rank and pendulum scales", () => {
    const names = (filters: Partial<AdvancedDeckCatalogFilters>) =>
      filterDeckCatalog(PROTOTYPE_CATALOG, advanced(filters), AVAILABLE).map(
        ({ name }) => name,
      );
    expect(names({ attack: { op: "eq", value: 3000 } })).toContain(
      "Blue-Eyes White Dragon",
    );
    expect(names({ attack: { op: "lt", value: 1 } })).toContain(
      "Outer Entity Nyarla",
    );
    expect(names({ attack: { op: "lte", value: 300 } })).toContain("Kuriboh");
    expect(names({ attack: { op: "gt", value: 3000 } })).toContain(
      "Gate Guardians Combined",
    );
    expect(names({ attack: { op: "gte", value: 4000 } })).toEqual([
      "Obelisk the Tormentor",
    ]);
    expect(names({ attack: { op: "range", min: 2400, max: 2500 } })).toEqual([
      "Dark Magician",
      "Red-Eyes Black Dragon",
    ]);
    expect(names({ levelRank: { op: "eq", value: 4 } })).toContain(
      "Outer Entity Nyarla",
    );
    expect(names({ levelRank: { op: "eq", value: 2 } })).not.toContain(
      "SPYRAL Double Helix",
    );
    expect(names({ pendulumScale: { op: "eq", value: 3 } })).toEqual([
      "Angello Vaalmonica",
    ]);
  });

  it("rejects out-of-domain Level/Rank, Link Rating and Pendulum criteria", () => {
    expect(numericCriterionError({ op: "eq", value: -1 }, 0, 13)).toBe(
      "Enter a valid value.",
    );
    expect(numericCriterionError({ op: "range", min: 0, max: 14 }, 0, 13)).toBe(
      "Enter a valid value.",
    );
    expect(numericCriterionError({ op: "eq", value: 0 }, 1, 8)).toBe(
      "Enter a valid value.",
    );
    expect(
      numericCriterionError({ op: "range", min: 1, max: 8 }, 1, 8),
    ).toBeNull();
    for (const filters of [
      { levelRank: { op: "eq" as const, value: 14 } },
      { linkRating: { op: "eq" as const, value: 0 } },
      { pendulumScale: { op: "range" as const, min: -1, max: 13 } },
    ]) {
      expect(
        filterDeckCatalog(PROTOTYPE_CATALOG, advanced(filters), AVAILABLE),
      ).toEqual([]);
    }
  });

  it("covers name modes, passcode forms, identities, traits and availability", () => {
    const names = (
      query: DeckCatalogQuery,
      available: (
        card: (typeof PROTOTYPE_CATALOG)[number],
      ) => boolean = AVAILABLE,
    ) =>
      filterDeckCatalog(PROTOTYPE_CATALOG, query, available).map(
        ({ name }) => name,
      );
    expect(
      names({ ...advanced({ nameMatch: "contains" }), name: "dark" }),
    ).toEqual(["Dark Hole", "Dark Magician", "Sword of Dark Destruction"]);
    expect(
      names({ ...advanced({ nameMatch: "exact" }), name: "dark magician" }),
    ).toEqual(["Dark Magician"]);
    expect(
      names({ ...advanced({ nameMatch: "exclude" }), name: "dark" }),
    ).not.toContain("Dark Magician");
    expect(names(advanced({ code: "not-code" }))).toHaveLength(
      PROTOTYPE_CATALOG.length,
    );
    expect(names(advanced({ code: "46986414" }))).toEqual(["Dark Magician"]);
    expect(
      names(advanced({ family: "trap" })).every(
        (name) =>
          PROTOTYPE_CATALOG.find((card) => card.name === name)?.family ===
          "trap",
      ),
    ).toBe(true);
    expect(names(advanced({ attribute: "DARK", race: "Spellcaster" }))).toEqual(
      ["Dark Magician"],
    );
    expect(names(advanced({ traits: ["Tuner"] })).length).toBeGreaterThan(0);
    expect(
      names(advanced({ restriction: 1 }), ({ code }) => code === 12580477),
    ).toEqual(["Raigeki"]);
  });

  it("implements any/all/exact marker rules and all selected traits", () => {
    const helix = "SPYRAL Double Helix";
    for (const [rule, markers, matches] of [
      ["any", ["Bottom", "Top"], true],
      ["all", ["Bottom", "Left"], true],
      ["all", ["Bottom", "Top"], false],
      ["exact", ["Bottom", "Left"], true],
      ["exact", ["Bottom"], false],
    ] as const) {
      expect(
        filterDeckCatalog(
          PROTOTYPE_CATALOG,
          advanced({ linkMarkerRule: rule, linkMarkers: markers }),
          AVAILABLE,
        )
          .map(({ name }) => name)
          .includes(helix),
      ).toBe(matches);
    }
    expect(
      filterDeckCatalog(
        PROTOTYPE_CATALOG,
        advanced({ traits: ["Tuner", "Flip"] }),
        AVAILABLE,
      ),
    ).toEqual([]);
  });

  it("treats unmatched text quotes literally and delegates current restriction availability", () => {
    expect(
      filterDeckCatalog(
        PROTOTYPE_CATALOG,
        advanced({ text: '"ultimate wizard' }),
        AVAILABLE,
      ).map(({ name }) => name),
    ).toEqual(["Dark Magician"]);
    const restricted = advanced({ restriction: 1 });
    expect(
      filterDeckCatalog(
        PROTOTYPE_CATALOG,
        restricted,
        (card) => card.code === 12580477,
      ).map(({ name }) => name),
    ).toEqual(["Raigeki"]);
  });

  it("always excludes unavailable cards and sorts Name A-Z with code tie-break", () => {
    const twins = [
      { ...PROTOTYPE_CATALOG[0]!, code: 2, name: "alpha" },
      { ...PROTOTYPE_CATALOG[0]!, code: 1, name: "Alpha" },
      { ...PROTOTYPE_CATALOG[0]!, code: 3, name: "Beta" },
    ];
    expect(
      filterDeckCatalog(twins, advanced(), ({ code }) => code !== 3).map(
        ({ code }) => code,
      ),
    ).toEqual([1, 2]);
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
