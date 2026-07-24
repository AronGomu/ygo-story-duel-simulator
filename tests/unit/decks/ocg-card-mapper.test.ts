import { describe, expect, it } from "vitest";
import { mapDeckBuilderCard } from "../../../src/decks/catalog/ocg-card-mapper.ts";
import {
  OCG_ATTRIBUTE,
  OCG_RACE,
  OCG_TYPE,
} from "../../../src/decks/catalog/ocg-mask.ts";
import { PROTOTYPE_CATALOG_RECORDS } from "../../../src/prototypes/deck-builder/fixtures/catalog.ts";

describe("OCG deck-builder card mapping", () => {
  it("derives card families, labels, attributes, races, and canonical zones", () => {
    const cards = PROTOTYPE_CATALOG_RECORDS.map(mapDeckBuilderCard);
    const fusion = cards.find(
      ({ name }) => name === "Gate Guardians Combined",
    )!;
    const spell = cards.find(({ name }) => name === "Raigeki")!;
    const trap = cards.find(({ name }) => name === "Mirror Force")!;
    const dragon = cards.find(({ name }) => name === "Blue-Eyes White Dragon")!;

    expect(fusion).toMatchObject({
      family: "monster",
      canonicalZone: "extra",
      ratingLabel: "Level",
    });
    expect(fusion.subtypes).toContain("Fusion");
    expect(spell.family).toBe("spell");
    expect(trap.family).toBe("trap");
    expect(dragon).toMatchObject({ attribute: "LIGHT", race: "Dragon" });
  });

  it("maps Synchro, Xyz, Link, Pendulum, and spell/trap subtypes", () => {
    const cards = PROTOTYPE_CATALOG_RECORDS.map(mapDeckBuilderCard);
    const byName = new Map(cards.map((card) => [card.name, card]));
    expect(byName.get("D/D/D Gust High King Alexander")?.canonicalZone).toBe(
      "extra",
    );
    expect(byName.get("Outer Entity Nyarla")?.ratingLabel).toBe("Rank");
    expect(byName.get("SPYRAL Double Helix")).toMatchObject({
      ratingLabel: "Link",
      defense: null,
      canonicalZone: "extra",
    });
    expect(byName.get("Angello Vaalmonica")?.pendulumScales).toEqual([3, 3]);
    expect(byName.get("Dangers of the Divine")?.subtypes).toContain(
      "Quick-Play",
    );
    expect(byName.get("D - Force")?.subtypes).toContain("Continuous");
    expect(byName.get("Grand Horn of Heaven")?.subtypes).toContain("Counter");
  });

  it("rejects mismatched card/text joins", () => {
    const record = PROTOTYPE_CATALOG_RECORDS[0]!;
    expect(() =>
      mapDeckBuilderCard({
        ...record,
        text: { ...record.text, code: record.card.code + 1 },
      }),
    ).toThrow(/Card\/text code mismatch/);
  });

  it("keeps local masks aligned with vendored OCG values", () => {
    expect(OCG_TYPE.FUSION).toBe(64);
    expect(OCG_TYPE.LINK).toBe(67108864);
    expect(OCG_ATTRIBUTE.DARK).toBe(32);
    expect(OCG_RACE.DRAGON).toBe(8192n);
  });
});
