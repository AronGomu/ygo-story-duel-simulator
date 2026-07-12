import { describe, expect, it } from "vitest";
import {
  createProductionSeed,
  validateProgrammedSeed,
} from "../../src/worker/engine/duel-seed.ts";

describe("duel seeds", () => {
  it("repairs an all-zero random source", () => {
    expect(createProductionSeed(() => [0n, 0n, 0n, 0n])).toEqual([
      1n,
      0n,
      0n,
      0n,
    ]);
  });

  it("rejects an all-zero programmed seed", () => {
    expect(() => validateProgrammedSeed([0n, 0n, 0n, 0n])).toThrow(
      /cannot contain four zero/,
    );
  });
});
