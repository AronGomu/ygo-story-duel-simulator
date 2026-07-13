import path from "node:path";
import { describe, expect, it } from "vitest";
import { loadActiveDuelDependenciesNode } from "../../src/worker/assets/active-duel-dependencies-node.ts";
import {
  uniqueDeckCodes,
  validateDeck,
} from "../../src/duel/presets/deck-parser.ts";
import { loadMvpPreset } from "../../src/duel/presets/mvp-preset-node.ts";

describe("real MVP dependency snapshot", () => {
  it("resolves every preset card, text, image, global, and available card script", async () => {
    const preset = await loadMvpPreset();
    const codes = uniqueDeckCodes(preset.player, preset.opponent);
    const dependencies = await loadActiveDuelDependenciesNode(
      path.resolve("generated/assets/current"),
      codes,
    );
    const catalogCodes = new Set(dependencies.cards.keys());
    validateDeck(preset.player, catalogCodes);
    validateDeck(preset.opponent, catalogCodes);

    expect(dependencies.counts.cards).toBeGreaterThanOrEqual(codes.size);
    expect(dependencies.counts.texts).toBe(dependencies.counts.cards);
    expect(dependencies.counts.images).toBe(dependencies.counts.cards);
    expect(dependencies.scripts.has("constant.lua")).toBe(true);
    expect(dependencies.scripts.has("utility.lua")).toBe(true);
    expect(dependencies.scripts.has("c83764718.lua")).toBe(true);
  });
});
