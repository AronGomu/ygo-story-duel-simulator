import { describe, expect, it } from "vitest";
import {
  EMPTY_CATALOG_FILTERS,
  filterDeckCatalog,
} from "../../../src/decks/catalog/deck-catalog.ts";
import { PROTOTYPE_CATALOG } from "../../../src/prototypes/deck-builder/fixtures/catalog.ts";

describe("deck catalog filters", () => {
  it("filters case-insensitive names", () => {
    expect(
      filterDeckCatalog(PROTOTYPE_CATALOG, {
        ...EMPTY_CATALOG_FILTERS,
        name: "blue-eyes",
      }).map(({ name }) => name),
    ).toEqual(["Blue-Eyes White Dragon"]);
  });

  it("intersects family, subtype, Attribute, and monster type", () => {
    expect(
      filterDeckCatalog(PROTOTYPE_CATALOG, {
        name: "",
        family: "monster",
        subtype: "Normal",
        attribute: "DARK",
        race: "Dragon",
      }).map(({ name }) => name),
    ).toEqual(["Red-Eyes Black Dragon"]);
  });

  it("returns no result rather than broadening an impossible query", () => {
    expect(
      filterDeckCatalog(PROTOTYPE_CATALOG, {
        name: "not-a-card",
        family: null,
        subtype: null,
        attribute: null,
        race: null,
      }),
    ).toEqual([]);
  });
});
