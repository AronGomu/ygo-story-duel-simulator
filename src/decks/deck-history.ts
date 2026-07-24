import type {
  DeckCardLists,
  DeckCardUpdate,
  DeckHistory,
  DeckId,
} from "./deck-contracts.ts";
import { cloneCardLists } from "./deck-contracts.ts";

export const MAXIMUM_DECK_UPDATES = 50;

export function emptyDeckHistory(): DeckHistory {
  return Object.freeze({
    undo: Object.freeze([]),
    redo: Object.freeze([]),
    nextSequence: 1,
  });
}

export function pushDeckUpdate(
  history: DeckHistory,
  input: {
    readonly deckId: DeckId;
    readonly before: DeckCardLists;
    readonly after: DeckCardLists;
    readonly reason: DeckCardUpdate["reason"];
    readonly beforeImportedNeedsReview?: boolean;
    readonly afterImportedNeedsReview?: boolean;
    readonly now?: Date;
    readonly id?: string;
  },
): DeckHistory {
  if (
    sameCards(input.before, input.after) &&
    (input.beforeImportedNeedsReview ?? false) ===
      (input.afterImportedNeedsReview ?? false)
  )
    return history;
  const update: DeckCardUpdate = Object.freeze({
    id: input.id ?? crypto.randomUUID(),
    deckId: input.deckId,
    sequence: history.nextSequence,
    createdAt: (input.now ?? new Date()).toISOString(),
    before: cloneCardLists(input.before),
    after: cloneCardLists(input.after),
    beforeImportedNeedsReview: input.beforeImportedNeedsReview ?? false,
    afterImportedNeedsReview: input.afterImportedNeedsReview ?? false,
    reason: input.reason,
  });
  return Object.freeze({
    undo: Object.freeze([...history.undo, update].slice(-MAXIMUM_DECK_UPDATES)),
    redo: Object.freeze([]),
    nextSequence: history.nextSequence + 1,
  });
}

export function undoDeckUpdate(history: DeckHistory): Readonly<{
  history: DeckHistory;
  cards: DeckCardLists;
  importedNeedsReview: boolean;
}> | null {
  const update = history.undo.at(-1);
  if (update === undefined) return null;
  return Object.freeze({
    cards: cloneCardLists(update.before),
    importedNeedsReview: update.beforeImportedNeedsReview,
    history: Object.freeze({
      undo: Object.freeze(history.undo.slice(0, -1)),
      redo: Object.freeze([update, ...history.redo]),
      nextSequence: history.nextSequence,
    }),
  });
}

export function redoDeckUpdate(history: DeckHistory): Readonly<{
  history: DeckHistory;
  cards: DeckCardLists;
  importedNeedsReview: boolean;
}> | null {
  const update = history.redo[0];
  if (update === undefined) return null;
  return Object.freeze({
    cards: cloneCardLists(update.after),
    importedNeedsReview: update.afterImportedNeedsReview,
    history: Object.freeze({
      undo: Object.freeze(
        [...history.undo, update].slice(-MAXIMUM_DECK_UPDATES),
      ),
      redo: Object.freeze(history.redo.slice(1)),
      nextSequence: history.nextSequence,
    }),
  });
}

function sameCards(left: DeckCardLists, right: DeckCardLists): boolean {
  return (
    left.main.join(",") === right.main.join(",") &&
    left.extra.join(",") === right.extra.join(",") &&
    left.side.join(",") === right.side.join(",")
  );
}
