// @vitest-environment jsdom

import "fake-indexeddb/auto";
import { cleanup, render } from "@testing-library/svelte";
import { afterEach, expect, it, vi } from "vitest";
import FreePlayMatchSetup from "../../src/shell/screens/FreePlayMatchSetup.svelte";
import type * as FreePlayOpponentsModule from "../../src/shell/screens/free-play-opponents.ts";
import { createShellSettingsStore } from "../../src/shell/settings/shell-settings-store.ts";
import { installPrototypeActiveCatalog } from "../fixtures/active-catalog.ts";

// Exercise the unchanged unique-owner case without changing the shipped roster.
vi.mock(
  "../../src/shell/screens/free-play-opponents.ts",
  async (importOriginal) => {
    const actual = await importOriginal<typeof FreePlayOpponentsModule>();
    return {
      ...actual,
      FREE_PLAY_OPPONENTS: actual.FREE_PLAY_OPPONENTS.map((opponent) =>
        opponent.id === "practice-bot"
          ? { ...opponent, deckKey: "preset:chapter-one-starter" }
          : opponent,
      ),
    };
  },
);

installPrototypeActiveCatalog();
afterEach(() => cleanup());

it("keeps an exclusive roster owner's label while omitting shared owners", async () => {
  render(FreePlayMatchSetup, {
    settings: createShellSettingsStore(null),
    loadBattle: () => import("../../src/battle/index.ts"),
  });

  await vi.waitFor(() => {
    const exclusive = document.querySelector(
      '[data-cy="deck-tile-preset:chapter-one-starter"]',
    );
    expect(exclusive?.textContent).toContain("Bundled · Locked: Practice Bot");
    const shared = document.querySelector(
      '[data-cy="deck-tile-preset:chapter-one-practice"]',
    );
    expect(shared).not.toBeNull();
    expect(shared?.textContent).toContain("Bundled");
    expect(shared?.textContent).not.toContain("Locked:");
  });
});
