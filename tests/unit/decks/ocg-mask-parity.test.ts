// @vitest-environment node

import { describe, expect, it } from "vitest";
import {
  OcgAttribute,
  OcgRace,
  OcgType,
} from "../../../vendor/ocgcore-wasm/0.1.2/dist/index.js";
import {
  OCG_ATTRIBUTE,
  OCG_RACE,
  OCG_TYPE,
} from "../../../src/decks/catalog/ocg-mask.ts";

describe("client-safe OCG masks", () => {
  it("matches vendored runtime constants without importing core in client code", () => {
    for (const [key, value] of Object.entries(OCG_TYPE))
      expect(value, key).toBe(OcgType[key as keyof typeof OcgType]);
    for (const [key, value] of Object.entries(OCG_ATTRIBUTE))
      expect(value, key).toBe(OcgAttribute[key as keyof typeof OcgAttribute]);
    const raceAliases: Readonly<Record<string, keyof typeof OcgRace>> = {
      WINGED_BEAST: "WINGEDBEAST",
      BEAST_WARRIOR: "BEASTWARRIOR",
      SEA_SERPENT: "SEASERPENT",
      DIVINE_BEAST: "DIVINE",
      CREATOR_GOD: "CREATORGOD",
    };
    for (const [key, value] of Object.entries(OCG_RACE)) {
      const vendorKey = raceAliases[key] ?? (key as keyof typeof OcgRace);
      expect(value, key).toBe(OcgRace[vendorKey]);
    }
  });
});
