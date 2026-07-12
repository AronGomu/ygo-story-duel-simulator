import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { duelId } from "../contracts/ids.ts";
import { parseYdk, type ParsedDeck } from "./deck-parser.ts";

export const MVP_PRESET_ID = duelId("mvp-preset-v1");

export interface MvpPreset {
  readonly id: typeof MVP_PRESET_ID;
  readonly player: ParsedDeck;
  readonly opponent: ParsedDeck;
}

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
  return Object.freeze({
    id: MVP_PRESET_ID,
    player: parseYdk(playerSource),
    opponent: parseYdk(opponentSource),
  });
}
