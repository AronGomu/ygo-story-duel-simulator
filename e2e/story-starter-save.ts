import { readFileSync } from "node:fs";
import { deckId } from "../src/decks/deck-contracts.ts";
import { importYdk } from "../src/decks/ydk-adapter.ts";
import type { StoryDeck } from "../src/story/model/story-state.ts";

/* The deck and cards a new game is granted, as a browser test can build them.

   Every save that reaches an encounter has both: the briefing refuses to start
   one for a save holding no deck it can field, and the duel is now fought with
   that deck rather than a bundled preset — so a fixture without one cannot
   reach a duel at all.

   Read off the bundled list here rather than through `buildStarterGrant`,
   because that module reaches the list through a Vite `?raw` import and
   Playwright loads these files without Vite. The list is the same one, and
   `tests/unit/decks/starter-deck.test.ts` is what pins it legal against the
   shipped card database. The stored verdict below is a placeholder: every
   reader recomputes against the live catalog, which is the whole point of the
   gate the briefing applies. */

export interface StoryStarterSave {
  readonly deck: StoryDeck;
  readonly collection: Record<number, number>;
}

export function storyStarterSave(): StoryStarterSave {
  const imported = importYdk(
    readFileSync("src/decks/chapter-one-starter.ydk", "utf8"),
  );
  if (imported.type !== "ready")
    throw new Error(`Starter deck list is unreadable: ${imported.message}`);
  const { main, extra, side } = imported.cards;
  const collection: Record<number, number> = {};
  for (const code of [...main, ...extra, ...side])
    collection[code] = (collection[code] ?? 0) + 1;
  return {
    deck: {
      schemaVersion: 1,
      id: deckId("story-starter-deck"),
      revision: 1,
      name: "Chapter 1 Starter",
      createdAt: "2026-08-20T00:00:00.000Z",
      updatedAt: "2026-08-20T00:00:00.000Z",
      main: [...main],
      extra: [...extra],
      side: [...side],
      validation: {
        status: "valid",
        issues: [],
        rulesetRevision: "prototype-2026-01",
      },
      importedNeedsReview: false,
      illustrationCardCode: null,
    },
    collection,
  };
}
