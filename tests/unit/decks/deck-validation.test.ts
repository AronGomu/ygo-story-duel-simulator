import { describe, expect, it } from "vitest";
import { validateDeckDraft } from "../../../src/decks/deck-validation.ts";
import {
  catalogByCode,
  PROTOTYPE_RULESET,
  quantityLimit,
} from "../../../src/decks/catalog/pinned-ruleset.ts";
import { PROTOTYPE_CATALOG } from "../../../src/prototypes/deck-builder/fixtures/catalog.ts";
import { OCG_TYPE } from "../../../src/decks/catalog/ocg-mask.ts";

const catalog = catalogByCode(PROTOTYPE_CATALOG);
const mainCodes = PROTOTYPE_CATALOG.filter(
  (card) =>
    card.canonicalZone === "main" &&
    quantityLimit(PROTOTYPE_RULESET, card.code) === 3,
).map(({ code }) => code);
const validMain = Array.from(
  { length: 40 },
  (_, index) => mainCodes[index % mainCodes.length]!,
);

describe("deck validation", () => {
  it("validates size, copy, zone, missing-card, and pinned ruleset failures", () => {
    expect(
      validateDeckDraft(
        { main: [], extra: [], side: [] },
        catalog,
        PROTOTYPE_RULESET,
      ).issues,
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "main-under-minimum",
          severity: "error",
        }),
      ]),
    );
    const invalid = validateDeckDraft(
      {
        main: [
          ...validMain,
          ...Array.from({ length: 21 }, () => 89631139),
          8505920,
          99999999,
        ],
        extra: [89631139],
        side: Array.from({ length: 16 }, () => 46986414),
      },
      catalog,
      PROTOTYPE_RULESET,
    );
    for (const code of [
      "main-over-maximum",
      "side-over-maximum",
      "copy-limit",
      "wrong-zone",
      "missing-card",
    ])
      expect(
        invalid.issues.some((issue) => issue.code === code),
        code,
      ).toBe(true);
    expect(invalid.status).toBe("errors");
  });

  it("reports Extra overflow and unsupported cards", () => {
    const tokenCode = 123456789;
    const unsupportedCatalog = new Map(catalog);
    unsupportedCatalog.set(tokenCode, {
      ...PROTOTYPE_CATALOG[1]!,
      code: tokenCode,
      rawType: OCG_TYPE.MONSTER | OCG_TYPE.TOKEN,
    });
    const result = validateDeckDraft(
      {
        main: [...validMain.slice(0, 39), tokenCode],
        extra: Array.from({ length: 16 }, () => 8505920),
        side: [],
      },
      unsupportedCatalog,
      PROTOTYPE_RULESET,
    );
    expect(result.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "extra-over-maximum" }),
        expect.objectContaining({
          code: "unsupported-card",
          cardCode: tokenCode,
        }),
      ]),
    );
  });

  it("allows warnings while preserving a resolver-ready deck", () => {
    const result = validateDeckDraft(
      { main: validMain, extra: [], side: [] },
      catalog,
      PROTOTYPE_RULESET,
    );
    expect(result.status).toBe("warnings");
    expect(result.issues.some(({ severity }) => severity === "error")).toBe(
      false,
    );
    expect(result.issues.some(({ code }) => code === "empty-extra")).toBe(true);
    expect(result.issues.some(({ code }) => code === "empty-side")).toBe(true);
  });

  it("marks forbidden and changed-ruleset state explicitly", () => {
    const result = validateDeckDraft(
      {
        main: [...validMain.slice(0, 39), 10000000],
        extra: [],
        side: [],
        storedRulesetRevision: "older",
      },
      catalog,
      PROTOTYPE_RULESET,
    );
    expect(result.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "forbidden" }),
        expect.objectContaining({ code: "ruleset-changed" }),
      ]),
    );
  });
});
