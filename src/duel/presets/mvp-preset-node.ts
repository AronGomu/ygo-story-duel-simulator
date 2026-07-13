import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { createMvpPreset, type MvpPreset } from "./mvp-preset.ts";

export async function loadMvpPreset(): Promise<MvpPreset> {
  const [playerSource, opponentSource] = await Promise.all([
    readFile(
      fileURLToPath(new URL("./decks/player.ydk", import.meta.url)),
      "utf8",
    ),
    readFile(
      fileURLToPath(new URL("./decks/opponent.ydk", import.meta.url)),
      "utf8",
    ),
  ]);
  return createMvpPreset(playerSource, opponentSource);
}
