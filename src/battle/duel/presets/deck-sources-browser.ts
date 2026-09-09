import starterSource from "./decks/chapter-one-starter.ydk?raw";
import practiceSource from "./decks/chapter-one-practice.ydk?raw";
import type { DeckId } from "./deck-catalog.ts";

export const DECK_SOURCES: ReadonlyMap<DeckId, string> = Object.freeze(
  new Map<DeckId, string>([
    ["chapter-one-starter", starterSource],
    ["chapter-one-practice", practiceSource],
  ]),
);
