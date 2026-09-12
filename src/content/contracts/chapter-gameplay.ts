import type { ChapterId } from "./chapter-id.ts";
import type { ChapterCard } from "./chapter-card.ts";
import type { ChapterDeck } from "./chapter-deck.ts";
import type { ChapterFileRef } from "./chapter-file-ref.ts";
import type { ChapterOpponent } from "./chapter-opponent.ts";
import type { ChapterSet } from "./chapter-set.ts";

export interface ChapterGameplay {
  readonly schemaVersion: 1;
  readonly chapterId: ChapterId;
  readonly cards: readonly ChapterCard[];
  readonly sets: readonly ChapterSet[];
  readonly decks: readonly ChapterDeck[];
  readonly opponents: readonly ChapterOpponent[];
  readonly defaults: {
    readonly starterDeckId: string;
    readonly opponentId: string;
  };
  readonly story: {
    readonly contentId: "prototype-prologue-v1";
    readonly document: ChapterFileRef;
  } | null;
}
