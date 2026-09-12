// @vitest-environment jsdom

import "fake-indexeddb/auto";
import { cleanup, render } from "@testing-library/svelte";
import { userEvent } from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import AppShell from "../../src/shell/AppShell.svelte";
import type { DomainLoaders } from "../../src/shell/domain-loaders.ts";
import { createShellStore } from "../../src/shell/shell-store.ts";
import StoryApp from "../../src/story/StoryApp.svelte";
import { createInitialStoryState } from "../../src/story/model/story-state.ts";
import { STORY_SAVES_DATABASE_NAME } from "../../src/story/saves/story-save-contracts.ts";
import { createStorySaveRepository } from "../../src/story/saves/story-save-repository.ts";
import { installPrototypeActiveCatalog } from "../fixtures/active-catalog.ts";
import { fieldableStoryDeck } from "../fixtures/story-decks.ts";

/* The map is one click from the briefing, which revalidates the save's decks
   against the card database. jsdom has no runtime assets to serve one from. */
installPrototypeActiveCatalog();

/* Mounted through `AppShell` with the real story loader on purpose. The menu
   entry reaches the visual novel as a prop of `<svelte:component>`, which
   `svelte-check` does not prop-check: a story root that never declared the
   prop type-checked green while the three entries did nothing. Only the whole
   path — menu click, shell store, lazy domain load, story mount — can catch
   that, so no test here hands `StoryApp` props by hand. */
const loaders: DomainLoaders = {
  duel: () => new Promise<never>(() => {}),
  decks: () => new Promise<never>(() => {}),
  story: async () => await import("../../src/story/index.ts"),
};

/* Loading the story domain root is a Vite transform of the module graph behind
   it, which the default one-second budget knows nothing about. */
const REAL_IMPORT = { timeout: 15_000 };
const READY_CORE_GATE = {
  kind: "ready" as const,
  chapterIds: ["chapter-01" as const],
  generation: 1,
};

let hash = "#/";

function renderShell() {
  const store = createShellStore(hash, (next) => {
    hash = next;
  });
  return render(AppShell, {
    store,
    loaders,
    initialCoreGate: READY_CORE_GATE,
  });
}

function cy(value: string): HTMLElement | null {
  return document.querySelector<HTMLElement>(`[data-cy="${value}"]`);
}

async function waitForCy(value: string): Promise<HTMLElement> {
  await vi.waitFor(
    () =>
      expect(
        document.querySelector(`[data-cy="${value}"]`),
        `waiting for data-cy="${value}"`,
      ).not.toBeNull(),
    REAL_IMPORT,
  );
  return cy(value)!;
}

/** A save on the city map, holding the deck and cards a real one carries. */
async function seedMapSave(): Promise<void> {
  const { deck, collection } = fieldableStoryDeck();
  const result = await createStorySaveRepository(globalThis.indexedDB).write(
    "autosave",
    {
      ...createInitialStoryState(),
      screen: "map",
      savedScreen: "map",
      progressExists: true,
      decks: [deck],
      defaultDeckId: deck.id,
      collection,
    },
    null,
  );
  expect(result.kind).toBe("written");
}

async function deleteStorySaves(): Promise<void> {
  await new Promise<void>((resolve) => {
    const request = indexedDB.deleteDatabase(STORY_SAVES_DATABASE_NAME);
    request.onsuccess = () => resolve();
    request.onerror = () => resolve();
    request.onblocked = () => resolve();
  });
}

beforeEach(async () => {
  hash = "#/";
  await deleteStorySaves();
});

afterEach(async () => {
  cleanup();
  await deleteStorySaves();
});

describe("the main menu's story entries", () => {
  it("opens New Game on the prologue rather than on the story's own title", async () => {
    const user = userEvent.setup();
    renderShell();

    await user.click(await waitForCy("main-menu-new-game"));

    await waitForCy("story-narrative-stage");
    expect(hash).toBe("#/story");
    expect(cy("story-title-screen")).toBeNull();
  });

  it("resumes Continue on the saved screen, asking nothing a second time", async () => {
    await seedMapSave();
    const user = userEvent.setup();
    renderShell();

    await user.click(await waitForCy("main-menu-continue"));

    await waitForCy("story-map-screen");
    expect(cy("story-title-screen")).toBeNull();
  });

  it("opens Load on the story's load screen", async () => {
    await seedMapSave();
    const user = userEvent.setup();
    renderShell();

    await user.click(await waitForCy("main-menu-load"));

    await waitForCy("story-load-screen");
    expect(cy("story-title-screen")).toBeNull();
  });

  /* A mount that starts from a checkpoint is not on the title either. The shell
     drops the intent when the route leaves the story, so this cannot happen
     through it — but a resolution applied and then overwritten by an entry is a
     duel result the player never sees, so the story refuses it on its own. */
  it("never opens an entry over a state handed back from a duel", async () => {
    render(StoryApp, {
      storyEntryIntent: "new",
      resumeState: {
        ...createInitialStoryState(),
        screen: "map",
        savedScreen: "map",
        progressExists: true,
      },
    });

    await waitForCy("story-map-screen");
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(cy("story-map-screen")).not.toBeNull();
    expect(cy("story-narrative-stage")).toBeNull();
  });
});
