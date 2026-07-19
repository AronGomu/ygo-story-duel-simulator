import { DuelOperationError } from "../duel/contracts/duel-error.ts";
import { uniqueDeckCodes, validateDeck } from "../duel/presets/deck-parser.ts";
import { createMvpPreset } from "../duel/presets/mvp-preset.ts";
import opponentDeckSource from "../duel/presets/decks/opponent.ydk?raw";
import playerDeckSource from "../duel/presets/decks/player.ydk?raw";
import { loadActiveDuelDependencies } from "./assets/active-duel-dependencies.ts";
import {
  loadBrowserRuntimeAssets,
  type BrowserRuntimeAssetOptions,
} from "./assets/browser-runtime-assets.ts";
import { readCachedSnapshotFallbacks } from "./assets/browser-snapshot-pointer.ts";
import {
  safeWorkerLogger,
  workerLog,
  type WorkerLogger,
} from "./diagnostics/worker-log.ts";
import { DuelWorkerRuntime } from "./DuelWorkerRuntime.ts";
import { OcgCoreAdapter } from "./engine/OcgCoreAdapter.ts";
import { runDuelRuntimeInitializationStage } from "./runtime-initialization.ts";

export interface BrowserDuelWorkerRuntimeOptions {
  readonly applicationBaseUrl?: string;
  readonly fetch?: BrowserRuntimeAssetOptions["fetch"];
  readonly logger?: WorkerLogger;
}

export function createBrowserDuelWorkerRuntime(
  options: BrowserDuelWorkerRuntimeOptions = {},
): DuelWorkerRuntime {
  const runtimeId = globalThis.crypto.randomUUID();
  const logger = safeWorkerLogger(options.logger ?? workerLog);
  const applicationBaseUrl =
    options.applicationBaseUrl ?? resolveApplicationBaseUrl();

  return new DuelWorkerRuntime(
    async (progress, signal) => {
      let lastProgressStage = "";
      let lastProgressPercent = -1;
      let selectedImageManifestSha256 = __ACTIVE_IMAGE_MANIFEST_SHA256__;
      const assets = await runDuelRuntimeInitializationStage(
        "snapshot_validation_failed",
        "Unable to validate the browser runtime snapshot",
        async () => {
          const onProgress = (stage: string, value?: number): void => {
            const mapped = value === undefined ? undefined : value * 0.65;
            const percent =
              mapped === undefined ? -1 : Math.floor(mapped * 100);
            if (stage === lastProgressStage && percent === lastProgressPercent)
              return;
            lastProgressStage = stage;
            lastProgressPercent = percent;
            progress(stage, mapped);
          };
          const common = {
            ...(options.fetch === undefined ? {} : { fetch: options.fetch }),
            signal,
            onProgress,
          };
          try {
            return await loadBrowserRuntimeAssets(applicationBaseUrl, {
              ...common,
              expectedManifestSha256: __RUNTIME_MANIFEST_SHA256__,
              cacheSnapshotId: __RUNTIME_SNAPSHOT_ID__,
            });
          } catch (networkError) {
            logger.warn({
              event: "duel.worker.snapshot.current_load_failed",
              runtimeId,
              err: networkError,
            });
            try {
              return await loadBrowserRuntimeAssets(applicationBaseUrl, {
                ...common,
                expectedManifestSha256: __RUNTIME_MANIFEST_SHA256__,
                cacheOnlySnapshotId: __RUNTIME_SNAPSHOT_ID__,
              });
            } catch (currentCacheError) {
              const lookupFallbacks = (): Promise<
                Awaited<ReturnType<typeof readCachedSnapshotFallbacks>>
              > =>
                readCachedSnapshotFallbacks(__RUNTIME_SNAPSHOT_ID__).catch(
                  (error: unknown) => {
                    logger.warn({
                      event: "duel.worker.snapshot.fallback_lookup_failed",
                      runtimeId,
                      err: error,
                    });
                    return [];
                  },
                );
              let fallbacks = await lookupFallbacks();
              if (fallbacks.length === 0) {
                await abortableDelay(250, signal);
                fallbacks = await lookupFallbacks();
              }
              const fallbackErrors: unknown[] = [
                networkError,
                currentCacheError,
              ];
              for (const fallback of fallbacks) {
                progress("fallback-snapshot", 0.05);
                try {
                  const loaded = await loadBrowserRuntimeAssets(
                    applicationBaseUrl,
                    {
                      ...common,
                      expectedManifestSha256: fallback.runtimeManifestSha256,
                      cacheOnlySnapshotId: fallback.snapshotId,
                    },
                  );
                  selectedImageManifestSha256 =
                    fallback.activeImageManifestSha256;
                  return loaded;
                } catch (fallbackError) {
                  fallbackErrors.push(fallbackError);
                  logger.warn({
                    event: "duel.worker.snapshot.fallback_load_failed",
                    runtimeId,
                    snapshotId: fallback.snapshotId,
                    err: fallbackError,
                  });
                }
              }
              throw new AggregateError(
                fallbackErrors,
                "Current and fallback runtime snapshots are unavailable",
              );
            }
          }
        },
      );
      signal.throwIfAborted();
      progress("engine", 0.7);
      const adapter = await runDuelRuntimeInitializationStage(
        "engine_initialization_failed",
        "Unable to initialize the vendored engine",
        () =>
          OcgCoreAdapter.initialize({
            wasmBinary: assets.wasmBinary,
            onDiagnostic: ({ stream, message }) =>
              logger[stream === "stderr" ? "warn" : "debug"]({
                event: "duel.worker.engine.initialization.diagnostic",
                runtimeId,
                stream,
                message,
              }),
          }),
      );
      const coreVersion = adapter.getVersion();
      if (
        coreVersion[0] !== assets.manifest.engine.coreVersion[0] ||
        coreVersion[1] !== assets.manifest.engine.coreVersion[1]
      ) {
        throw new DuelOperationError({
          code: "engine_initialization_failed",
          message:
            "Vendored engine version does not match the runtime snapshot",
          recoverable: false,
        });
      }

      signal.throwIfAborted();
      progress("preset", 0.8);
      const preset = await runDuelRuntimeInitializationStage(
        "deck_validation_failed",
        "Unable to load the MVP preset decks",
        async () => createMvpPreset(playerDeckSource, opponentDeckSource),
      );
      signal.throwIfAborted();
      let dependencyGroupsLoaded = 0;
      const reportDependencyProgress = (group: string): void => {
        dependencyGroupsLoaded += 1;
        progress(
          `dependencies:${group}`,
          Math.min(0.98, 0.85 + dependencyGroupsLoaded * 0.018),
        );
      };
      progress("dependencies", 0.85);
      const dependencies = await runDuelRuntimeInitializationStage(
        "dependency_resolution_failed",
        "Unable to resolve active-duel dependencies",
        () =>
          loadActiveDuelDependencies(
            assets,
            uniqueDeckCodes(preset.player, preset.opponent),
            reportDependencyProgress,
          ),
      );
      const catalogCodes = new Set(dependencies.cards.keys());
      await runDuelRuntimeInitializationStage(
        "deck_validation_failed",
        "The MVP preset decks failed validation",
        async () => {
          validateDeck(
            preset.player,
            catalogCodes,
            undefined,
            dependencies.cards,
          );
          validateDeck(
            preset.opponent,
            catalogCodes,
            undefined,
            dependencies.cards,
          );
        },
      );
      signal.throwIfAborted();
      progress("ready", 1);
      return {
        adapter,
        dependencies,
        preset,
        snapshotId: assets.manifest.snapshotId,
        revisions: {
          babelCdb: assets.manifest.assets.babelCdbRevision,
          cardScripts: assets.manifest.assets.cardScriptsRevision,
          distribution: assets.manifest.assets.distributionRevision,
          activeImageManifestSha256: selectedImageManifestSha256,
        },
      };
    },
    { runtimeId, logger },
  );
}

function abortableDelay(
  milliseconds: number,
  signal: AbortSignal,
): Promise<void> {
  signal.throwIfAborted();
  return new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => {
      signal.removeEventListener("abort", abort);
      resolve();
    }, milliseconds);
    const abort = (): void => {
      clearTimeout(timeout);
      reject(signal.reason);
    };
    signal.addEventListener("abort", abort, { once: true });
  });
}

function resolveApplicationBaseUrl(): string {
  const basePath = import.meta.env.BASE_URL;
  return new URL(basePath, globalThis.location.origin).href;
}
