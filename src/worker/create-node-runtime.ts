import path from "node:path";
import {
  DuelOperationError,
  type DuelError,
} from "../duel/contracts/duel-error.ts";
import { uniqueDeckCodes, validateDeck } from "../duel/presets/deck-parser.ts";
import { loadMvpPreset } from "../duel/presets/mvp-preset.ts";
import { loadActiveDuelDependenciesNode } from "./assets/active-duel-dependencies-node.ts";
import {
  buildRuntimeSnapshotManifest,
  verifyRuntimeSnapshotFiles,
} from "./assets/runtime-snapshot-node.ts";
import { DuelWorkerRuntime } from "./DuelWorkerRuntime.ts";
import {
  safeWorkerLogger,
  workerLog,
  type WorkerLogger,
} from "./diagnostics/worker-log.ts";
import { loadVendoredCoreNode } from "./engine/load-vendored-core-node.ts";

export function createNodeDuelWorkerRuntime(
  projectRoot = process.cwd(),
  logger: WorkerLogger = workerLog,
): DuelWorkerRuntime {
  const runtimeId = globalThis.crypto.randomUUID();
  const safeLogger = safeWorkerLogger(logger);
  return new DuelWorkerRuntime(
    async (progress, signal) => {
      signal.throwIfAborted();
      progress("manifest", 0);
      const assetRoot = path.join(
        projectRoot,
        "generated",
        "assets",
        "current",
      );
      const vendorRoot = path.join(
        projectRoot,
        "vendor",
        "ocgcore-wasm",
        "0.1.2",
      );
      const manifest = await runInitializationStage(
        "snapshot_validation_failed",
        "Unable to validate the runtime snapshot",
        () => buildRuntimeSnapshotManifest(assetRoot, vendorRoot),
      );
      signal.throwIfAborted();
      progress("snapshot-files", 0.1);
      await runInitializationStage(
        "snapshot_validation_failed",
        "Unable to verify runtime snapshot files",
        () => verifyRuntimeSnapshotFiles(manifest, assetRoot),
      );
      signal.throwIfAborted();
      progress("engine", 0.25);
      const adapter = await loadVendoredCoreNode({
        onDiagnostic: ({ stream, message }) =>
          safeLogger[stream === "stderr" ? "warn" : "debug"]({
            event: "duel.worker.engine.initialization.diagnostic",
            runtimeId,
            stream,
            message,
          }),
      });
      signal.throwIfAborted();
      if (adapter.getVersion()[0] !== manifest.engine.coreVersion[0]) {
        throw new DuelOperationError({
          code: "engine_initialization_failed",
          message:
            "Vendored engine version does not match the runtime snapshot",
          recoverable: false,
        });
      }
      progress("preset", 0.5);
      const preset = await runInitializationStage(
        "deck_validation_failed",
        "Unable to load the MVP preset decks",
        loadMvpPreset,
      );
      signal.throwIfAborted();
      const dependencies = await runInitializationStage(
        "dependency_resolution_failed",
        "Unable to resolve active-duel dependencies",
        () =>
          loadActiveDuelDependenciesNode(
            assetRoot,
            uniqueDeckCodes(preset.player, preset.opponent),
          ),
      );
      signal.throwIfAborted();
      const catalogCodes = new Set(dependencies.cards.keys());
      await runInitializationStage(
        "deck_validation_failed",
        "The MVP preset decks failed validation",
        async () => {
          validateDeck(preset.player, catalogCodes);
          validateDeck(preset.opponent, catalogCodes);
        },
      );
      progress("ready", 1);
      return { adapter, dependencies, preset, snapshotId: manifest.snapshotId };
    },
    { runtimeId, logger: safeLogger },
  );
}

async function runInitializationStage<T>(
  code: DuelError["code"],
  message: string,
  operation: () => Promise<T>,
): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    const cause = error instanceof Error ? error.message : String(error);
    throw new DuelOperationError(
      {
        code,
        message: `${message}: ${cause}`,
        detail: { cause },
        recoverable: false,
      },
      error,
    );
  }
}
