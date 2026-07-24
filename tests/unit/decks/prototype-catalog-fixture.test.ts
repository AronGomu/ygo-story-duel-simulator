import { describe, expect, it } from "vitest";
import { PROTOTYPE_CATALOG } from "../../../src/prototypes/deck-builder/fixtures/catalog.ts";

describe("prototype catalog fixture", () => {
  it("contains unique OCG-shaped review cards across every major family", () => {
    expect(PROTOTYPE_CATALOG.length).toBeGreaterThanOrEqual(24);
    expect(PROTOTYPE_CATALOG.length).toBeLessThanOrEqual(40);
    expect(new Set(PROTOTYPE_CATALOG.map(({ code }) => code)).size).toBe(
      PROTOTYPE_CATALOG.length,
    );
    expect(new Set(PROTOTYPE_CATALOG.map(({ family }) => family))).toEqual(
      new Set(["monster", "spell", "trap"]),
    );
    for (const subtype of [
      "Fusion",
      "Synchro",
      "Xyz",
      "Link",
      "Pendulum",
      "Ritual",
      "Quick-Play",
      "Continuous",
      "Counter",
    ])
      expect(
        PROTOTYPE_CATALOG.some(({ subtypes }) => subtypes.includes(subtype)),
      ).toBe(true);
    expect(
      PROTOTYPE_CATALOG.every(({ name, description }) => name && description),
    ).toBe(true);
  });
});
