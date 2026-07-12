import path from "node:path";
import { uniqueDeckCodes, validateDeck } from "../duel/presets/deck-parser.ts";
import { loadMvpPreset } from "../duel/presets/mvp-preset.ts";
import { loadActiveDuelDependenciesNode } from "./assets/active-duel-dependencies-node.ts";
import { buildRuntimeSnapshotManifest } from "./assets/runtime-snapshot-node.ts";
import { DuelWorkerRuntime } from "./DuelWorkerRuntime.ts";
import { loadVendoredCoreNode } from "./engine/load-vendored-core-node.ts";

export function createNodeDuelWorkerRuntime(
  projectRoot = process.cwd(),
): DuelWorkerRuntime {
  return new DuelWorkerRuntime(async (progress) => {
    progress("manifest", 0);
    const assetRoot = path.join(projectRoot, "generated", "assets", "current");
    const vendorRoot = path.join(
      projectRoot,
      "vendor",
      "ocgcore-wasm",
      "0.1.2",
    );
    const manifest = await buildRuntimeSnapshotManifest(assetRoot, vendorRoot);
    progress("engine", 0.25);
    const adapter = await loadVendoredCoreNode();
    if (adapter.getVersion()[0] !== manifest.engine.coreVersion[0]) {
      throw new Error(
        "Vendored engine version does not match the runtime snapshot",
      );
    }
    progress("preset", 0.5);
    const preset = await loadMvpPreset();
    const dependencies = await loadActiveDuelDependenciesNode(
      assetRoot,
      uniqueDeckCodes(preset.player, preset.opponent),
    );
    const catalogCodes = new Set(dependencies.cards.keys());
    validateDeck(preset.player, catalogCodes);
    validateDeck(preset.opponent, catalogCodes);
    progress("ready", 1);
    return { adapter, dependencies, preset, snapshotId: manifest.snapshotId };
  });
}
