import {
  DECK_CATALOG,
  DEFAULT_OPPONENT_DECK_ID,
  DEFAULT_PLAYER_DECK_ID,
} from "../../src/battle/duel/presets/deck-catalog.ts";
import { parseYdk } from "../../src/battle/duel/presets/deck-parser.ts";
import { FREE_PLAY_OPPONENTS } from "../../src/shell/screens/free-play-opponents.ts";
import { MAX_SETUP_BYTES } from "./content-setup.ts";
import { readBounded } from "./content-setup-io.ts";

/** Current pickers expose DECK_CATALOG; unused files are not release prerequisites. */
export async function inspectPrototypeDecks(
  root: string,
  selectedCodes: ReadonlySet<number>,
): Promise<boolean> {
  const exposedIds = new Set<string>(DECK_CATALOG.map(({ id }) => id));
  if (
    !exposedIds.has(DEFAULT_PLAYER_DECK_ID) ||
    !exposedIds.has(DEFAULT_OPPONENT_DECK_ID) ||
    FREE_PLAY_OPPONENTS.some(
      ({ deckKey }) =>
        !deckKey.startsWith("preset:") || !exposedIds.has(deckKey.slice(7)),
    ) ||
    DECK_CATALOG.some(({ fileName }) => !/^[a-z0-9-]+\.ydk$/.test(fileName))
  )
    return false;
  for (const relative of [
    ...DECK_CATALOG.map(
      ({ fileName }) => `src/battle/duel/presets/decks/${fileName}`,
    ),
    "src/decks/chapter-one-starter.ydk",
  ]) {
    const bytes = await readBounded(root, relative, MAX_SETUP_BYTES);
    if (bytes === null) return false;
    try {
      const deck = parseYdk(
        new TextDecoder("utf-8", { fatal: true }).decode(bytes),
      );
      // Membership prerequisite only; engine/deck rules remain authoritative downstream.
      if (
        deck.main.length === 0 ||
        [...deck.main, ...deck.extra, ...deck.side].some(
          (code) => !selectedCodes.has(code),
        )
      )
        return false;
    } catch {
      // Parser diagnostics contain source values; expose only fixed setup blocker.
      return false;
    }
  }
  return true;
}
