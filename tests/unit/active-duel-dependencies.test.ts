import { describe, expect, it } from "vitest";
import { normalizeRequestedScriptName } from "../../src/worker/assets/active-duel-dependencies.ts";

describe("active duel dependency resolver", () => {
  it("normalizes only supported pinned script names", () => {
    expect(normalizeRequestedScriptName("./official/c83764718.lua")).toBe(
      "c83764718.lua",
    );
    expect(normalizeRequestedScriptName("script\\utility.lua")).toBe(
      "utility.lua",
    );
    expect(() => normalizeRequestedScriptName("../../arbitrary.js")).toThrow(
      /Unsupported/,
    );
  });
});
