import { ASSET_SOURCES } from "../../scripts/lib/asset-roots.ts";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { loadActiveDuelDependenciesNode } from "../../src/battle/worker/assets/active-duel-dependencies-node.ts";
import {
  MVP_DECK_CONSTRAINTS,
  uniqueDeckCodes,
  validateDeck,
} from "../../src/battle/duel/presets/deck-parser.ts";
import { loadMvpPreset } from "../../src/battle/duel/presets/mvp-preset-node.ts";

describe("real MVP dependency snapshot", () => {
  it("resolves every preset card, text, image, global, and available card script", async () => {
    const preset = await loadMvpPreset();
    const codes = uniqueDeckCodes(preset.player, preset.opponent);
    const dependencies = await loadActiveDuelDependenciesNode(
      path.resolve(ASSET_SOURCES.data.source),
      codes,
    );
    const catalogCodes = new Set(dependencies.cards.keys());
    // These are explicit historical MVP fixtures, no longer the active reviewed pool.
    const reviewedPool = codes;
    validateDeck(
      preset.player,
      catalogCodes,
      MVP_DECK_CONSTRAINTS,
      dependencies.cards,
      reviewedPool,
    );
    validateDeck(
      preset.opponent,
      catalogCodes,
      MVP_DECK_CONSTRAINTS,
      dependencies.cards,
      reviewedPool,
    );

    expect(dependencies.counts.cards).toBeGreaterThanOrEqual(codes.size);
    expect(dependencies.counts.texts).toBe(dependencies.counts.cards);
    expect(dependencies.counts.images).toBe(dependencies.counts.cards);
    expect(dependencies.scripts.has("constant.lua")).toBe(true);
    expect(dependencies.scripts.has("utility.lua")).toBe(true);
    expect(dependencies.scripts.has("c83764718.lua")).toBe(true);
  });
});
