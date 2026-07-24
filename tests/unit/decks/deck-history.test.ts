import { describe, expect, it } from "vitest";
import { deckId } from "../../../src/decks/deck-contracts.ts";
import {
  emptyDeckHistory,
  MAXIMUM_DECK_UPDATES,
  pushDeckUpdate,
  redoDeckUpdate,
  undoDeckUpdate,
} from "../../../src/decks/deck-history.ts";

describe("bounded deck history", () => {
  it("retains exactly 50 card updates with monotonic sequence", () => {
    let history = emptyDeckHistory();
    for (let index = 0; index < 51; index += 1) {
      history = pushDeckUpdate(history, {
        id: `update-${index}`,
        deckId: deckId("deck-a"),
        now: new Date(index * 1000),
        before: { main: [index], extra: [], side: [] },
        after: { main: [index + 1], extra: [], side: [] },
        reason: "add",
      });
    }
    expect(history.undo).toHaveLength(MAXIMUM_DECK_UPDATES);
    expect(history.undo[0]?.sequence).toBe(2);
    expect(history.undo.at(-1)?.sequence).toBe(51);
    expect(history.nextSequence).toBe(52);
  });

  it("undoes, redoes, then clears redo after a branched edit", () => {
    const id = deckId("deck-a");
    const first = pushDeckUpdate(emptyDeckHistory(), {
      id: "first",
      deckId: id,
      before: { main: [], extra: [], side: [] },
      after: { main: [1], extra: [], side: [] },
      reason: "add",
    });
    const undone = undoDeckUpdate(first)!;
    expect(undone.cards.main).toEqual([]);
    expect(undone.history.redo).toHaveLength(1);
    const redone = redoDeckUpdate(undone.history)!;
    expect(redone.cards.main).toEqual([1]);
    const branch = pushDeckUpdate(undone.history, {
      id: "branch",
      deckId: id,
      before: undone.cards,
      after: { main: [2], extra: [], side: [] },
      reason: "add",
    });
    expect(branch.redo).toEqual([]);
  });

  it("records import-review changes even when card lists match", () => {
    const history = pushDeckUpdate(emptyDeckHistory(), {
      id: "same-cards-import",
      deckId: deckId("deck-a"),
      before: { main: [1], extra: [], side: [] },
      after: { main: [1], extra: [], side: [] },
      beforeImportedNeedsReview: false,
      afterImportedNeedsReview: true,
      reason: "import",
    });
    expect(history.undo).toHaveLength(1);
    expect(undoDeckUpdate(history)?.importedNeedsReview).toBe(false);
  });

  it("restores import review state with import cards", () => {
    const history = pushDeckUpdate(emptyDeckHistory(), {
      id: "import",
      deckId: deckId("deck-a"),
      before: { main: [1], extra: [], side: [] },
      after: { main: [2], extra: [], side: [] },
      beforeImportedNeedsReview: false,
      afterImportedNeedsReview: true,
      reason: "import",
    });
    const undone = undoDeckUpdate(history)!;
    expect(undone.importedNeedsReview).toBe(false);
    expect(redoDeckUpdate(undone.history)?.importedNeedsReview).toBe(true);
  });

  it("does not record rejected/no-op content", () => {
    const history = emptyDeckHistory();
    expect(
      pushDeckUpdate(history, {
        deckId: deckId("deck-a"),
        before: { main: [], extra: [], side: [] },
        after: { main: [], extra: [], side: [] },
        reason: "move",
      }),
    ).toBe(history);
  });
});
