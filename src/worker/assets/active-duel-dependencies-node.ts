import { readFile } from "node:fs/promises";
import type { CardCode } from "../../duel/contracts/ids.ts";
import {
  loadActiveDuelDependencies,
  type ActiveDuelAssetReader,
  type ActiveDependencyProgress,
  type ActiveDuelDependencies,
} from "./active-duel-dependencies.ts";
import { safeArtifactPath } from "./runtime-snapshot-node.ts";

export async function loadActiveDuelDependenciesNode(
  assetRoot: string,
  requestedCodes: ReadonlySet<CardCode>,
  onProgress?: ActiveDependencyProgress,
): Promise<ActiveDuelDependencies> {
  const reader: ActiveDuelAssetReader = {
    async readJson<T>(relativePath: string): Promise<T> {
      const source = await readFile(
        safeArtifactPath(assetRoot, relativePath),
        "utf8",
      );
      return JSON.parse(source) as T;
    },
  };
  return loadActiveDuelDependencies(reader, requestedCodes, onProgress);
}
