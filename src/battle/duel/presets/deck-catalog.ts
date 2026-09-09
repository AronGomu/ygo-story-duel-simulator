export type DeckId = "chapter-one-starter" | "chapter-one-practice";

export interface DeckMetadata {
  readonly id: DeckId;
  readonly name: string;
  /** File name inside `src/battle/duel/presets/decks/`. */
  readonly fileName: string;
}

export const DECK_CATALOG: readonly DeckMetadata[] = Object.freeze([
  Object.freeze({
    id: "chapter-one-starter",
    name: "Chapter 1 Starter",
    fileName: "chapter-one-starter.ydk",
  }),
  Object.freeze({
    id: "chapter-one-practice",
    name: "Chapter 1 Practice",
    fileName: "chapter-one-practice.ydk",
  }),
]);

export const DEFAULT_PLAYER_DECK_ID: DeckId = "chapter-one-starter";
export const DEFAULT_OPPONENT_DECK_ID: DeckId = "chapter-one-practice";

export function deckMetadata(id: DeckId): DeckMetadata {
  return DECK_CATALOG.find((metadata) => metadata.id === id)!;
}

export function isDeckId(value: string): value is DeckId {
  return DECK_CATALOG.some(({ id }) => id === value);
}
