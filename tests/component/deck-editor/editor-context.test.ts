// @vitest-environment jsdom

import "fake-indexeddb/auto";
import { cleanup, fireEvent, render } from "@testing-library/svelte";
import { deleteDB } from "idb";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PROTOTYPE_RULESET } from "../../../src/decks/catalog/pinned-ruleset.ts";
import { DECK_DATABASE_NAME } from "../../../src/decks/deck-database.ts";
import { emptyDeckHistory } from "../../../src/decks/deck-history.ts";
import { createBlankDeck } from "../../../src/decks/deck-model.ts";
import { IndexedDbDeckRepository } from "../../../src/decks/indexeddb-deck-repository.ts";
import AppShell from "../../../src/shell/AppShell.svelte";
import type { DomainLoaders } from "../../../src/shell/domain-loaders.ts";
import { createShellStore } from "../../../src/shell/shell-store.ts";
import {
  createInitialStoryState,
  type StoryState,
} from "../../../src/story/model/story-state.ts";
import {
  STORY_SAVES_DATABASE_NAME,
  type StorySaveReadResult,
  type StorySlotKey,
} from "../../../src/story/saves/story-save-contracts.ts";
import {
  createStorySaveRepository,
  type StorySaveRepository,
} from "../../../src/story/saves/story-save-repository.ts";
import { installPrototypeActiveCatalog } from "../../fixtures/active-catalog.ts";
import { prototypeCatalogMap } from "../../fixtures/deck-editor.ts";
import { storyDeckFixture } from "../../fixtures/story-decks.ts";

/* Which deck library the editor writes into is decided by the route, so it is
   asserted from the route: the shell is what binds a context, and mounting the
   editor directly would assert the default rather than the binding. The two
   worlds must stay disjoint — a deck built in a story save is not in free
   play, and free play's decks are not in the save. */

installPrototypeActiveCatalog();

/* The duel boots a Worker and the story mounts a whole domain; neither is
   under test here, and the deck editor is loaded for real. */
const never = () => new Promise<never>(() => {});

const loaders: DomainLoaders = {
  duel: never,
  decks: async () => await import("../../../src/deck-editor/index.ts"),
  story: never,
};

const storyLoaders: DomainLoaders = {
  ...loaders,
  story: async () => await import("../../../src/story/index.ts"),
};

/* Waiting on the deck editor's own chunk means waiting on a Vite transform of
   the module graph behind it, which the default one-second budget knows
   nothing about. */
const REAL_IMPORT = { timeout: 15_000 };

afterEach(async () => {
  cleanup();
  vi.restoreAllMocks();
  await Promise.all([
    deleteDB(DECK_DATABASE_NAME),
    deleteDB(STORY_SAVES_DATABASE_NAME),
  ]);
});

/** A story save store answering `manual:1` with `state` and every other slot
    with nothing, so what the editor binds is decided here. */
function savesHolding(state: StoryState | null): StorySaveRepository {
  return {
    read: (slot: StorySlotKey) =>
      Promise.resolve<StorySaveReadResult>(
        slot === "manual:1" && state !== null
          ? {
              kind: "ready",
              envelope: {
                schemaVersion: 4,
                slot,
                revision: 1,
                savedAt: 1,
                state,
              },
            }
          : { kind: "empty", slot },
      ),
    write: () => Promise.resolve({ kind: "written", revision: 2 }),
    list: () => Promise.resolve([]),
    clear: () => Promise.resolve(),
  };
}

/* A save as a real one arrives: a new game grants a deck and makes it the
   default, which is what keeps the editor's starter-deck seeding out of the
   way here as it does in the browser. */
function storySave(deckIds: readonly string[]): StoryState {
  const decks = deckIds.map((id) => storyDeckFixture(id));
  return {
    ...createInitialStoryState(),
    screen: "map",
    savedScreen: "map",
    progressExists: true,
    decks,
    defaultDeckId: decks[0]?.id ?? null,
  };
}

async function seedFreePlayDeck(id: string, name: string): Promise<void> {
  const repository = await IndexedDbDeckRepository.open();
  try {
    await repository.create(
      createBlankDeck(name, prototypeCatalogMap, PROTOTYPE_RULESET, {
        id,
        now: new Date("2026-01-01T00:00:00.000Z"),
      }),
      emptyDeckHistory(),
    );
  } finally {
    repository.close();
  }
}

function renderAt(hash: string, state: StoryState | null = null) {
  let current = hash;
  const store = createShellStore(hash, (next) => {
    current = next;
  });
  const rendered = render(AppShell, {
    store,
    loaders,
    saves: savesHolding(state),
  });
  return { ...rendered, store, hash: () => current };
}

function query(value: string): HTMLElement | null {
  return document.querySelector(`[data-cy="${value}"]`);
}

/** Waits for one `data-cy` the shell or a lazily loaded domain has yet to
    render, and hands it back. */
async function appears(value: string): Promise<HTMLElement> {
  return await vi.waitFor(() => {
    const found = query(value);
    expect(found, `${value} should render`).not.toBeNull();
    return found!;
  }, REAL_IMPORT);
}

/** The library tiles, once the editor has read whichever repository its context
    resolved to. */
async function libraryDeckNames(): Promise<readonly string[]> {
  await vi.waitFor(
    () => expect(query("deck-select-grid")).not.toBeNull(),
    REAL_IMPORT,
  );
  return [
    ...document.querySelectorAll<HTMLElement>('[data-cy^="deck-tile-name-"]'),
  ].map((name) => name.textContent?.trim() ?? "");
}

describe("deck editor context binding", () => {
  it("routes a persisted story snapshot into its owned-only editor", async () => {
    const manual = storySave(["from-manual"]);
    const autosave = {
      ...storySave(["from-autosave"]),
      collection: { 89631139: 1 },
    };
    vi.spyOn(Date, "now").mockReturnValue(1);
    const saves = createStorySaveRepository(globalThis.indexedDB, () => 1);
    expect((await saves.write("manual:1", manual, null)).kind).toBe("written");
    expect((await saves.write("autosave", autosave, null)).kind).toBe(
      "written",
    );

    let current = "#/";
    const store = createShellStore(current, (next) => {
      current = next;
    });
    render(AppShell, { store, loaders: storyLoaders, saves });
    store.enterStory("continue");

    await appears("story-map-screen");
    await fireEvent.click(await appears("story-top-bar-decks"));

    await vi.waitFor(() => expect(current).toBe("#/story/decks"), REAL_IMPORT);
    expect(await libraryDeckNames()).toStrictEqual(["Deck from-autosave"]);
    expect(query("deck-editor-context-banner")?.textContent).toContain(
      "The Signal Beneath the City · City map",
    );

    const persisted = await saves.read("autosave");
    if (persisted.kind !== "ready")
      throw new Error("expected story route to persist an autosave");
    expect(persisted.envelope.state.savedScreen).toBe("map");
    expect(persisted.envelope.state.decks.map(({ id }) => id)).toStrictEqual([
      "from-autosave",
    ]);

    await fireEvent.dblClick(await appears("deck-tile-press-from-autosave"));
    await vi.waitFor(
      () =>
        expect(query("deck-catalog-result-count")?.textContent).toBe(
          "0 results",
        ),
      REAL_IMPORT,
    );
    expect(query("catalog-tile-89631139")).toBeNull();
  });

  it("free-play route uses the free-play repository", async () => {
    await seedFreePlayDeck("free-one", "Free Deck One");
    renderAt("#/free-play/decks");

    expect(await libraryDeckNames()).toContain("Free Deck One");
  });

  it("story route uses the save adapter", async () => {
    await seedFreePlayDeck("free-one", "Free Deck One");
    renderAt("#/story/decks", storySave(["saved-one"]));

    const names = await libraryDeckNames();
    expect(names).toContain("Deck saved-one");
    expect(names).not.toContain("Free Deck One");
  });

  it("omits the free-play context row but names the story save", async () => {
    await seedFreePlayDeck("free-one", "Free Deck One");
    renderAt("#/free-play/decks");

    await libraryDeckNames();
    expect(query("deck-editor-context-banner")).toBeNull();

    cleanup();
    renderAt("#/story/decks", storySave(["saved-one"]));

    await vi.waitFor(
      () => expect(query("deck-editor-context-banner")).not.toBeNull(),
      REAL_IMPORT,
    );
    expect(query("deck-editor-context-banner")?.textContent).toContain(
      "The Signal Beneath the City · City map",
    );
  });

  it("story route without a save returns to the main menu", async () => {
    const { hash } = renderAt("#/story/decks", null);

    await vi.waitFor(
      () => expect(query("shell-region-home")).not.toBeNull(),
      REAL_IMPORT,
    );
    expect(hash()).toBe("#/");
    expect(query("shell-region-decks")).toBeNull();
    expect(query("deck-editor-context-banner")).toBeNull();
  });

  it("deck list shows the context's decks", async () => {
    await seedFreePlayDeck("free-one", "Free Deck One");
    await seedFreePlayDeck("free-two", "Free Deck Two");

    renderAt("#/free-play/decks");
    const freePlay = await libraryDeckNames();
    expect(
      freePlay.filter((name) => name.startsWith("Free Deck")),
    ).toHaveLength(2);

    cleanup();
    renderAt("#/story/decks", storySave(["saved-one"]));
    const story = await libraryDeckNames();
    expect(story).toStrictEqual(["Deck saved-one"]);
  });

  /* The way in to the collection, and the way back out of it. A player who can
     reach their cards but not leave them is inside a one-way door, so both
     halves of the round trip are one test: the deck menu the button was pressed
     in is the deck menu Back has to land on, in the world it was pressed in. */
  it("free play's deck menu opens the free-play collection and comes back", async () => {
    await seedFreePlayDeck("free-one", "Free Deck One");
    const { hash } = renderAt("#/free-play/decks");

    await fireEvent.click(await appears("deck-library-collection"));

    expect(hash()).toBe("#/free-play/collection");
    await appears("collection-screen");
    /* Free play owns everything, so it is the whole database rather than a
       collection, and nothing there is counted. */
    expect(query("collection-show-all")).toBeNull();

    await fireEvent.click(await appears("collection-back"));

    expect(hash()).toBe("#/free-play/decks");
    expect(await libraryDeckNames()).toContain("Free Deck One");
  });

  it("a save's deck menu opens the story collection and comes back", async () => {
    const { hash } = renderAt("#/story/decks", storySave(["saved-one"]));

    await fireEvent.click(await appears("deck-library-collection"));

    expect(hash()).toBe("#/story/collection");
    await appears("collection-screen");
    /* The save's own cards, not the database: what it owns is the list, and
       everything else is behind the checkbox this world alone offers. */
    expect(query("collection-show-all")).not.toBeNull();

    await fireEvent.click(await appears("collection-back"));

    expect(hash()).toBe("#/story/decks");
    expect(await libraryDeckNames()).toStrictEqual(["Deck saved-one"]);
  });

  /* Back out of a story deck route and the editor is over free play again. The
     region is the same region, so an editor kept across the crossing would go
     on writing into the save it opened while naming the library on screen — the
     one mistake this whole binding exists to prevent. */
  it("rebinds when the route crosses from one world to the other", async () => {
    await seedFreePlayDeck("free-one", "Free Deck One");
    const { store } = renderAt("#/story/decks", storySave(["saved-one"]));
    expect(await libraryDeckNames()).toStrictEqual(["Deck saved-one"]);

    store.syncFromHash("#/free-play/decks");

    await vi.waitFor(async () => {
      expect(await libraryDeckNames()).toContain("Free Deck One");
    }, REAL_IMPORT);
    expect(await libraryDeckNames()).not.toContain("Deck saved-one");
    expect(query("deck-editor-context-banner")).toBeNull();
  });
});
