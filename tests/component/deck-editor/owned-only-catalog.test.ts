// @vitest-environment jsdom

import "fake-indexeddb/auto";
import { cleanup, render, waitFor } from "@testing-library/svelte";
import { userEvent } from "@testing-library/user-event";
import { deleteDB } from "idb";
import { afterEach, describe, expect, it, vi } from "vitest";
import DeckEditorApp from "../../../src/deck-editor/index.ts";
import { DeckBuilderController } from "../../../src/deck-editor/deck-editor-store.ts";
import { PROTOTYPE_CATALOG } from "../../../src/deck-editor/fixtures/catalog.ts";
import {
  PROTOTYPE_RULESET,
  catalogByCode,
  quantityLimit,
} from "../../../src/decks/catalog/pinned-ruleset.ts";
import { setRuntimeCatalogForTests } from "../../../src/decks/catalog/runtime-catalog.ts";
import { deckId } from "../../../src/decks/deck-contracts.ts";
import { DECK_DATABASE_NAME } from "../../../src/decks/deck-database.ts";
import { emptyDeckHistory } from "../../../src/decks/deck-history.ts";
import { createBlankDeck } from "../../../src/decks/deck-model.ts";
import type { DeckContext } from "../../../src/decks/deck-repository-context.ts";
import type { DeckRepository } from "../../../src/decks/deck-repository.ts";
import { IndexedDbDeckRepository } from "../../../src/decks/indexeddb-deck-repository.ts";
import { storyCardOwnership } from "../../../src/story/decks/card-ownership.ts";
import { createStoryDeckRepository } from "../../../src/story/decks/story-deck-repository.ts";
import { reduceStory } from "../../../src/story/model/story-reducer.ts";
import {
  createInitialStoryState,
  type StoryState,
} from "../../../src/story/model/story-state.ts";
import { installPrototypeActiveCatalog } from "../../fixtures/active-catalog.ts";
import { prototypeCatalogMap } from "../../fixtures/deck-editor.ts";
import { storyDeckFixture } from "../../fixtures/story-decks.ts";
import {
  TOAST_CONTEXT_KEY,
  type ToastPublisher,
} from "../../../src/shell/index.ts";

/* A story save builds from the cards it owns. The catalog is the offer and the
   add path is the enforcement, so both are driven here through the editor the
   player actually uses rather than through the components in isolation: the
   ownership reader arrives from the bound context, and a filter applied at the
   wrong end of that thread would still pass a component-level assertion. */

installPrototypeActiveCatalog();

/* Five cards, so "only the owned ones" is a count worth reading. The two
   Main-deck neighbours are the pair every add case below runs on: one owned,
   one not, both at the ruleset's default limit of three. */
const MAIN_CARDS = PROTOTYPE_CATALOG.filter(
  (card) =>
    card.canonicalZone === "main" &&
    quantityLimit(PROTOTYPE_RULESET, card.code) === 3,
);
const OWNED = MAIN_CARDS[0]!;
const UNOWNED = MAIN_CARDS[1]!;
const CATALOG_FIVE = Object.freeze([OWNED, UNOWNED, ...MAIN_CARDS.slice(2, 5)]);
const FIVE_BY_CODE = catalogByCode(CATALOG_FIVE);

setRuntimeCatalogForTests(CATALOG_FIVE);

const STORY_DECK_ID = "story-owned-deck";

afterEach(async () => {
  cleanup();
  await deleteDB(DECK_DATABASE_NAME);
});

/** A save holding one empty deck and the collection handed in, wired exactly as
    `openStoryDeckContext` wires a real one: repository and ownership read off
    the same state, so they cannot describe two different worlds. */
function storyContext(collection: Readonly<Record<number, number>>): {
  readonly context: DeckContext;
  readonly repository: DeckRepository;
  readonly state: () => StoryState;
} {
  const deck = storyDeckFixture(STORY_DECK_ID, { main: [] });
  let state: StoryState = {
    ...createInitialStoryState(),
    screen: "map",
    savedScreen: "map",
    progressExists: true,
    collection,
    decks: [deck],
    defaultDeckId: deck.id,
  };
  const createRepository = (): DeckRepository =>
    createStoryDeckRepository({
      readState: () => state,
      dispatch: (command) => {
        state = reduceStory(state, command);
      },
      restore: (previous) => {
        state = previous;
      },
      persist: () => Promise.resolve(),
    });
  return {
    context: Object.freeze({
      kind: "story",
      label: "Owned only",
      ownership: storyCardOwnership(state),
      createRepository,
    }),
    repository: createRepository(),
    state: () => state,
  };
}

async function seedFreePlayDeck(id: string): Promise<void> {
  const repository = await IndexedDbDeckRepository.open();
  try {
    await repository.create(
      createBlankDeck("Free Deck", prototypeCatalogMap, PROTOTYPE_RULESET, {
        id,
        now: new Date("2026-01-01T00:00:00.000Z"),
      }),
      emptyDeckHistory(),
    );
  } finally {
    repository.close();
  }
}

function query(value: string): HTMLElement | null {
  return document.querySelector(`[data-cy="${value}"]`);
}

async function openCatalog(props: {
  readonly deckId: string;
  readonly context?: DeckContext;
  readonly toasts?: ToastPublisher;
}): Promise<void> {
  /* Nested under `props` because `context` is also a `render` option, and the
     harness refuses a props object that shares a name with one. */
  render(DeckEditorApp, {
    props: {
      deckId: deckId(props.deckId),
      onnavigate: vi.fn(),
      ...(props.context === undefined ? {} : { context: props.context }),
    },
    ...(props.toasts === undefined
      ? {}
      : { context: new Map([[TOAST_CONTEXT_KEY, props.toasts]]) }),
  });
  await waitFor(() => expect(query("deck-catalog-results")).not.toBeNull());
}

function catalogTile(code: number): HTMLElement | null {
  return document.querySelector(
    `[data-cy="deck-catalog-results"] [data-cy="catalog-tile-${code}"]`,
  );
}

function resultCount(): string {
  return query("deck-catalog-result-count")?.textContent ?? "";
}

function zoneCount(zone: "main" | "side"): string {
  return query(`deck-zone-count-${zone}`)?.textContent?.trim() ?? "";
}

describe("owned-only story catalog", () => {
  it("story catalog lists only owned cards", async () => {
    const { context } = storyContext({ [OWNED.code]: 1 });
    await openCatalog({ deckId: STORY_DECK_ID, context });

    expect(resultCount()).toBe("1 results");
    expect(catalogTile(OWNED.code)).not.toBeNull();
    expect(catalogTile(UNOWNED.code)).toBeNull();
  });

  it("free play lists the whole catalog", async () => {
    await seedFreePlayDeck("free-owned");
    await openCatalog({ deckId: "free-owned" });

    expect(resultCount()).toBe(`${CATALOG_FIVE.length} results`);
    expect(catalogTile(OWNED.code)).not.toBeNull();
    expect(catalogTile(UNOWNED.code)).not.toBeNull();
  });

  it("removes a card once its owned count is spent", async () => {
    const user = userEvent.setup();
    const { context } = storyContext({ [OWNED.code]: 1 });
    await openCatalog({ deckId: STORY_DECK_ID, context });

    await user.dblClick(catalogTile(OWNED.code)!);
    await waitFor(() => expect(zoneCount("main")).toBe("1/40"));
    await waitFor(() => expect(catalogTile(OWNED.code)).toBeNull());
    expect(zoneCount("main")).toBe("1/40");
  });

  it("removes a card once its ruleset limit is spent", async () => {
    const user = userEvent.setup();
    const { context } = storyContext({ [OWNED.code]: 5 });
    const show = vi.fn<ToastPublisher["show"]>(() => "toast-test");
    await openCatalog({
      deckId: STORY_DECK_ID,
      context,
      toasts: { show },
    });

    for (const copies of [1, 2, 3]) {
      await user.dblClick(catalogTile(OWNED.code)!);
      await waitFor(() => expect(zoneCount("main")).toBe(`${copies}/40`));
    }

    await waitFor(() => expect(catalogTile(OWNED.code)).toBeNull());
    expect(zoneCount("main")).toBe("3/40");
    expect(show).not.toHaveBeenCalled();
  });

  /* Driven through the controller rather than the tile, because the point of
     the guard is the path that never reaches a tile: a drag, a keyboard route
     or a stale view asking for a copy the save does not have. */
  it("the cap counts across zones", async () => {
    const { repository } = storyContext({ [OWNED.code]: 1 });
    const controller = new DeckBuilderController(
      repository,
      FIVE_BY_CODE,
      PROTOTYPE_RULESET,
      storyCardOwnership({
        ...createInitialStoryState(),
        collection: { [OWNED.code]: 1 },
      }),
    );
    await controller.initialize();
    await controller.openDeck(deckId(STORY_DECK_ID));

    await controller.mutate({ type: "add", cardCode: OWNED.code });
    const added = await repository.load(deckId(STORY_DECK_ID));
    expect(added?.deck.main).toStrictEqual([OWNED.code]);

    await controller.mutate({
      type: "add",
      cardCode: OWNED.code,
      zone: "side",
    });
    const capped = await repository.load(deckId(STORY_DECK_ID));
    expect(capped?.deck.side).toStrictEqual([]);
    expect(capped?.deck.main).toStrictEqual([OWNED.code]);
  });

  it("never renders unavailable card affordances", async () => {
    const user = userEvent.setup();
    const { context } = storyContext({ [OWNED.code]: 1 });
    await openCatalog({ deckId: STORY_DECK_ID, context });

    await user.dblClick(catalogTile(OWNED.code)!);
    await waitFor(() => expect(catalogTile(OWNED.code)).toBeNull());
    expect(query(`deck-catalog-cap-reason-${OWNED.code}`)).toBeNull();
  });

  it("search still filters the owned list", async () => {
    const user = userEvent.setup();
    const { context } = storyContext({
      [OWNED.code]: 1,
      [MAIN_CARDS[2]!.code]: 1,
    });
    await openCatalog({ deckId: STORY_DECK_ID, context });

    expect(resultCount()).toBe("2 results");

    await user.type(query("deck-catalog-name-input")!, OWNED.name.slice(0, 6));

    await waitFor(() => expect(resultCount()).toBe("1 results"));
    expect(catalogTile(OWNED.code)).not.toBeNull();
    expect(catalogTile(MAIN_CARDS[2]!.code)).toBeNull();
    expect(catalogTile(UNOWNED.code)).toBeNull();
  });
});
