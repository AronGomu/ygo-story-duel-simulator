import { duelId } from "../contracts/ids.ts";
import { parseYdk, type ParsedDeck } from "./deck-parser.ts";

export const MVP_PRESET_ID = duelId("mvp-preset-v1");

export interface MvpPreset {
  readonly id: typeof MVP_PRESET_ID;
  readonly player: ParsedDeck;
  readonly opponent: ParsedDeck;
}

export function createMvpPreset(
  playerSource: string,
  opponentSource: string,
): MvpPreset {
  return Object.freeze({
    id: MVP_PRESET_ID,
    player: parseYdk(playerSource),
    opponent: parseYdk(opponentSource),
  });
}
