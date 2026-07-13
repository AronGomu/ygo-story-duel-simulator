import { readFile } from "node:fs/promises";
import path from "node:path";
import {
  parseYdk,
  uniqueDeckCodes,
} from "../../src/duel/presets/deck-parser.ts";
import {
  loadActiveDuelDependencies,
  type ActiveDuelAssetReader,
} from "../../src/worker/assets/active-duel-dependencies.ts";

export async function resolveActiveRuntimeFiles(
  projectRoot: string,
): Promise<readonly string[]> {
  const assetRoot = path.join(projectRoot, "generated/assets/current");
  const requested = new Set<string>();
  const reader: ActiveDuelAssetReader = {
    async readJson<T>(relativePath: string): Promise<T> {
      requested.add(relativePath);
      return JSON.parse(
        await readFile(
          path.join(assetRoot, ...relativePath.split("/")),
          "utf8",
        ),
      ) as T;
    },
  };
  const [playerSource, opponentSource] = await Promise.all([
    readFile(
      path.join(projectRoot, "src/duel/presets/decks/player.ydk"),
      "utf8",
    ),
    readFile(
      path.join(projectRoot, "src/duel/presets/decks/opponent.ydk"),
      "utf8",
    ),
  ]);
  await loadActiveDuelDependencies(
    reader,
    uniqueDeckCodes(parseYdk(playerSource), parseYdk(opponentSource)),
  );
  return Object.freeze([...requested].sort());
}
