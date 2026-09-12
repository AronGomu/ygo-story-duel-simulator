// @vitest-environment jsdom

import "fake-indexeddb/auto";
import { cleanup, fireEvent, render } from "@testing-library/svelte";
import { tick } from "svelte";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import MainMenuScreen from "../../src/shell/screens/MainMenuScreen.svelte";
import {
  STORY_SAVES_DATABASE_NAME,
  storySaveExists,
} from "../../src/shell/screens/story-save-presence.ts";
import {
  createShellStore,
  type ShellState,
} from "../../src/shell/shell-store.ts";
import { createInitialStoryState } from "../../src/story/model/story-state.ts";
import { createStorySaveRepository } from "../../src/story/saves/story-save-repository.ts";

function query(selector: string): HTMLElement | null {
  return document.querySelector<HTMLElement>(`[data-cy="${selector}"]`);
}

function entryOrder(): readonly string[] {
  return [...query("main-menu-entries")!.querySelectorAll("button")].map(
    (button) => button.dataset.cy ?? "",
  );
}

function deleteStoryDatabase(): Promise<void> {
  return new Promise((resolve) => {
    const request = indexedDB.deleteDatabase(STORY_SAVES_DATABASE_NAME);
    request.onsuccess = () => resolve();
    request.onerror = () => resolve();
    request.onblocked = () => resolve();
  });
}

async function writeStorySave(): Promise<void> {
  await createStorySaveRepository(indexedDB).write(
    "autosave",
    createInitialStoryState(),
    null,
  );
}

/** Waits for the menu's own save probe to have settled. The menu opens the
    story-saves database in `onMount`, and IndexedDB serves open requests for
    one database in the order they were made, so a probe started after the
    render cannot answer before the menu's; one flush then applies it. */
async function settleSaveProbe(): Promise<void> {
  await storySaveExists(indexedDB);
  await tick();
}

function renderMenu(record: ShellState[] = []) {
  const hashes: string[] = [];
  const onfreeplaywarm = vi.fn();
  const store = createShellStore("#/", (hash) => hashes.push(hash));
  store.subscribe((state) => record.push(state));
  render(MainMenuScreen, { store, onfreeplaywarm });
  return {
    hashes,
    onfreeplaywarm,
    state: () => record[record.length - 1]!,
  };
}

beforeEach(async () => {
  await deleteStoryDatabase();
});

afterEach(() => {
  cleanup();
});

describe("MainMenuScreen", () => {
  it("renders the five entries with Free Play last", async () => {
    await writeStorySave();
    renderMenu();
    await settleSaveProbe();

    expect(entryOrder()).toEqual([
      "main-menu-new-game",
      "main-menu-continue",
      "main-menu-load",
      "main-menu-install-content",
      "main-menu-settings",
      "main-menu-free-play",
    ]);
    expect(query("main-menu-title")).not.toBeNull();
  });

  it("disables Continue when no compatible save exists", async () => {
    renderMenu();
    await settleSaveProbe();

    expect(query("main-menu-continue")).toHaveProperty("disabled", true);
    expect(entryOrder()).toEqual([
      "main-menu-new-game",
      "main-menu-continue",
      "main-menu-load",
      "main-menu-install-content",
      "main-menu-settings",
      "main-menu-free-play",
    ]);
  });

  it("navigates to the free-play route from the last entry", async () => {
    const menu = renderMenu();

    await fireEvent.click(query("main-menu-free-play")!);

    expect(menu.hashes).toEqual(["#/free-play"]);
    expect(menu.state().route).toStrictEqual({ kind: "free-play" });
  });

  /* Free play opens on a deck list, and reading that list means the whole
     packaged card database. Reaching for the entry is what starts that read,
     so it happens while the player is still travelling to the click — and
     never for a player who came for the story and passes it by (ADR-054). */
  it("reports a reach for Free Play before the click", async () => {
    const menu = renderMenu();

    await fireEvent.pointerEnter(query("main-menu-free-play")!);
    expect(menu.onfreeplaywarm).toHaveBeenCalledTimes(1);
    expect(menu.hashes).toEqual([]);

    await fireEvent.focus(query("main-menu-free-play")!);
    expect(menu.onfreeplaywarm).toHaveBeenCalledTimes(2);

    await fireEvent.pointerEnter(query("main-menu-new-game")!);
    expect(menu.onfreeplaywarm).toHaveBeenCalledTimes(2);
  });

  it("navigates into the story recording which entry was chosen", async () => {
    const menu = renderMenu();

    await fireEvent.click(query("main-menu-new-game")!);

    expect(menu.hashes).toEqual(["#/story"]);
    expect(menu.state().route).toStrictEqual({ kind: "story" });
    expect(menu.state().storyEntryIntent).toBe("new");
  });

  it("records the load intent on the same story route", async () => {
    const menu = renderMenu();

    await fireEvent.click(query("main-menu-load")!);

    expect(menu.hashes).toEqual(["#/story"]);
    expect(menu.state().storyEntryIntent).toBe("load");
  });

  it("records the continue intent once a save exists", async () => {
    await writeStorySave();
    const menu = renderMenu();
    await settleSaveProbe();

    await fireEvent.click(query("main-menu-continue")!);

    expect(menu.hashes).toEqual(["#/story"]);
    expect(menu.state().storyEntryIntent).toBe("continue");
  });

  it("opens the settings dialog in place, leaving the route alone", async () => {
    const menu = renderMenu();
    expect(query("shell-settings-dialog")).toBeNull();

    await fireEvent.click(query("main-menu-settings")!);

    expect(query("shell-settings-dialog")).not.toBeNull();
    expect(menu.hashes).toEqual([]);
    expect(menu.state().route).toStrictEqual({ kind: "home" });

    await fireEvent.click(query("shell-settings-close")!);
    expect(query("shell-settings-dialog")).toBeNull();
  });

  /* The browser owns fullscreen: the menu and the settings dialog only point
     at F11 rather than offering an in-app request. */
  it("points at F11 in the menu and in the settings dialog", async () => {
    renderMenu();
    expect(query("main-menu-fullscreen-hint")!.textContent).toContain("F11");

    await fireEvent.click(query("main-menu-settings")!);

    expect(query("shell-settings-fullscreen-hint")!.textContent).toContain(
      "F11",
    );
  });
});
