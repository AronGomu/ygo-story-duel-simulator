// @vitest-environment jsdom

import "fake-indexeddb/auto";
import { cleanup, fireEvent, render } from "@testing-library/svelte";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  BattleRequestError,
  parseBattleRequest,
} from "../../src/battle/battle-contracts.ts";
import {
  findSelectableDeck,
  listSelectableDecks,
  presetSelectableDecks,
} from "../../src/battle/decks/selectable-decks.ts";
import { DECK_CATALOG } from "../../src/battle/duel/presets/deck-catalog.ts";
import {
  catalogByCode,
  PROTOTYPE_RULESET,
  quantityLimit,
} from "../../src/decks/catalog/pinned-ruleset.ts";
import { emptyDeckHistory } from "../../src/decks/deck-history.ts";
import { createBlankDeck } from "../../src/decks/deck-model.ts";
import { validateDeckDraft } from "../../src/decks/deck-validation.ts";
import { DECK_DATABASE_NAME } from "../../src/decks/index.ts";
import { IndexedDbDeckRepository } from "../../src/decks/indexeddb-deck-repository.ts";
import { PROTOTYPE_CATALOG } from "../../src/deck-editor/fixtures/catalog.ts";
import {
  TOAST_CONTEXT_KEY,
  type ToastPublisher,
} from "../../src/shell/index.ts";
import type { BattleDeckModule } from "../../src/shell/domain-loaders.ts";
import {
  listedFreePlayDecks,
  resetFreePlayDeckCacheForTests,
  warmFreePlayDecks,
} from "../../src/shell/screens/free-play-deck-listing.ts";
import FreePlayMatchSetup from "../../src/shell/screens/FreePlayMatchSetup.svelte";
import { createShellSettingsStore } from "../../src/shell/settings/shell-settings-store.ts";
import { installPrototypeActiveCatalog } from "../fixtures/active-catalog.ts";

installPrototypeActiveCatalog();

const catalog = catalogByCode(PROTOTYPE_CATALOG);
const mainCodes = PROTOTYPE_CATALOG.filter(
  (card) =>
    card.canonicalZone === "main" &&
    quantityLimit(PROTOTYPE_RULESET, card.code) === 3,
).map(({ code }) => code);
const VALID_MAIN = Array.from(
  { length: 40 },
  (_, index) => mainCodes[index % mainCodes.length]!,
);

/* Both active Chapter 1 decks, with real IDs checked by parseBattleRequest. */
const PRESETS = DECK_CATALOG;
const PLAYER_PRESET_KEY = "preset:chapter-one-starter";
const OPPONENT_PRESET_KEY = "preset:chapter-one-practice";
const LOCAL_KEY = "local:built-deck:1";
/* The same deck after one write: the key carries the revision, so every
   management operation on a deck moves the key the grid knows it by. */
const RENAMED_KEY = "local:built-deck:2";

/** The slice of the battle entry the screen loads, with the active Chapter 1 pair. Everything else is the production function. */
function battleModule(
  overrides: Partial<BattleDeckModule> = {},
): BattleDeckModule {
  return {
    DECK_CATALOG: PRESETS,
    DEFAULT_PLAYER_DECK_ID: "chapter-one-starter",
    DEFAULT_OPPONENT_DECK_ID: "chapter-one-practice",
    presetSelectableDecks,
    listSelectableDecks,
    findSelectableDeck,
    parseBattleRequest,
    ...overrides,
  };
}

function memoryStorage(entries: Record<string, string> = {}) {
  return {
    getItem: (key: string) => entries[key] ?? null,
    setItem: (key: string, value: string) => {
      entries[key] = value;
    },
  };
}

async function seedLocalDeck(): Promise<void> {
  const repository = await IndexedDbDeckRepository.open();
  try {
    const base = createBlankDeck("Built Deck", catalog, PROTOTYPE_RULESET, {
      id: "built-deck",
    });
    await repository.create(
      {
        ...base,
        main: Object.freeze([...VALID_MAIN]),
        validation: validateDeckDraft(
          { main: [...VALID_MAIN], extra: [], side: [] },
          catalog,
          PROTOTYPE_RULESET,
        ),
      },
      emptyDeckHistory(),
    );
  } finally {
    repository.close();
  }
}

function deleteDeckDatabase(): Promise<void> {
  return new Promise((resolve) => {
    const request = indexedDB.deleteDatabase(DECK_DATABASE_NAME);
    request.onsuccess = () => resolve();
    request.onerror = () => resolve();
    request.onblocked = () => resolve();
  });
}

function query(value: string): HTMLElement | null {
  return document.querySelector(`[data-cy="${value}"]`);
}

function control(value: string): HTMLButtonElement {
  return query(value) as HTMLButtonElement;
}

/** The tiles the grid shows, in the order it shows them. */
function gridKeys(): readonly string[] {
  return [...(query("deck-select-grid")?.children ?? [])].map((child) =>
    (child.getAttribute("data-cy") ?? "").replace("deck-tile-", ""),
  );
}

/** The deck filling a seat, matched from its name-only chip to the grid tile. */
function seatKey(which: "yours" | "opponent"): string | null {
  const chip = query(
    which === "yours"
      ? "duel-start-your-deck-name"
      : "duel-start-opponent-deck-name",
  );
  const name = chip?.textContent;
  if (name === undefined || name === null) return null;
  const match = [...(query("deck-select-grid")?.children ?? [])].find(
    (tile) =>
      tile.querySelector<HTMLElement>('[data-cy^="deck-tile-name-"]')
        ?.textContent === name,
  );
  return match?.getAttribute("data-cy")?.replace("deck-tile-", "") ?? null;
}

function startButton(): HTMLButtonElement {
  return control("deck-select-start");
}

interface RenderOptions {
  readonly storage?: ReturnType<typeof memoryStorage>;
  readonly module?: Partial<BattleDeckModule>;
  readonly loadBattle?: () => Promise<BattleDeckModule>;
  readonly toasts?: ToastPublisher;
}

function renderSetup(options: RenderOptions = {}) {
  const onstart = vi.fn();
  const onback = vi.fn();
  const ondecks = vi.fn();
  const onopendeck = vi.fn();
  const storage = options.storage ?? memoryStorage();
  const settings = createShellSettingsStore(storage);
  const props = {
    settings,
    loadBattle:
      options.loadBattle ?? (async () => battleModule(options.module)),
    onstart,
    onback,
    ondecks,
    onopendeck,
  };
  const rendered =
    options.toasts === undefined
      ? render(FreePlayMatchSetup, props)
      : render(FreePlayMatchSetup, {
          props,
          context: new Map([[TOAST_CONTEXT_KEY, options.toasts]]),
        });
  return {
    ...rendered,
    onstart,
    onback,
    ondecks,
    onopendeck,
    storage,
    settings,
  };
}

/** Rendered as far as the bundled decks, which need no library read. */
async function renderLoadedSetup(options: RenderOptions = {}) {
  const setup = renderSetup(options);
  await vi.waitFor(() => expect(gridKeys()).not.toHaveLength(0));
  return setup;
}

/** Rendered as far as the library behind those bundled decks, which is what
    puts the seeded local deck in the grid. */
async function renderListedSetup(options: RenderOptions = {}) {
  const setup = renderSetup(options);
  await vi.waitFor(() => expect(gridKeys()).toContain(LOCAL_KEY));
  return setup;
}

beforeEach(async () => {
  /* The listing is held for the life of the page, so one test's library would
     otherwise be the next one's first paint. */
  resetFreePlayDeckCacheForTests();
  await deleteDeckDatabase();
  await seedLocalDeck();
});

afterEach(async () => {
  cleanup();
  await deleteDeckDatabase();
});

describe("FreePlayMatchSetup", () => {
  it("opens on the shared selection screen with every deck as a tile", async () => {
    await renderListedSetup();

    expect(query("deck-select-screen")).not.toBeNull();
    expect(query("deck-select-eyebrow")?.textContent).toBe("Free play");
    expect(query("deck-select-title")?.textContent).toBe("Choose your deck");
    /* Newest first, and a preset has no stamp at all, so the deck the player
       built leads the bundled pair. */
    expect(gridKeys()).toEqual([
      LOCAL_KEY,
      PLAYER_PRESET_KEY,
      OPPONENT_PRESET_KEY,
    ]);
  });

  it("does not label the shared practice deck as exclusively owned by any persona", async () => {
    await renderLoadedSetup();

    expect(query("duel-start-opponent-name")?.textContent).toBe("Practice Bot");
    expect(seatKey("opponent")).toBe(OPPONENT_PRESET_KEY);
    const tile = query(`deck-tile-${OPPONENT_PRESET_KEY}`)!;
    expect(tile).not.toBeNull();
    expect(tile.textContent).toContain("Bundled");
    expect(tile.textContent).not.toContain("Locked:");
    for (const name of ["Vault Warden", "Blaze Circuit", "Practice Bot"])
      expect(tile.textContent).not.toContain(name);

    await fireEvent.click(control(`deck-tile-press-${OPPONENT_PRESET_KEY}`));
    expect(control("deck-select-delete").disabled).toBe(true);
  });

  it("maps a catalog miss to a normal frame without art", async () => {
    const missingCode = 987654321;
    const missingDecks = presetSelectableDecks(PRESETS).map((deck) =>
      deck.key === PLAYER_PRESET_KEY
        ? {
            ...deck,
            lists: {
              ...deck.lists,
              main: [missingCode],
            },
          }
        : deck,
    );
    await renderLoadedSetup({
      module: {
        presetSelectableDecks: () => missingDecks,
        listSelectableDecks: async () => missingDecks,
      },
    });

    await fireEvent.pointerEnter(query(`deck-tile-${PLAYER_PRESET_KEY}`)!);
    await vi.waitFor(() =>
      expect(
        query(`deck-select-seat-list-player-row-${missingCode}`),
      ).not.toBeNull(),
    );

    const row = query(
      `deck-select-seat-list-player-row-${missingCode}`,
    ) as HTMLElement;
    expect(row.style.getPropertyValue("--fc")).toBe("#b8985a");
    expect(
      query(`deck-select-seat-list-player-row-name-${missingCode}`)
        ?.textContent,
    ).toBe(String(missingCode));
    expect(
      query(`deck-select-seat-list-player-row-art-${missingCode}`),
    ).toBeNull();
    expect(
      query(`deck-select-seat-list-player-row-fade-${missingCode}`),
    ).toBeNull();
  });

  /* The screen manages the library it is picking from: the kebab and the
     footer cluster are two paths to the same three operations. A bundled deck
     is nobody's to delete, so the control that would is inert on one. */
  it("offers deck management from the kebab and the footer", async () => {
    await renderListedSetup();

    expect(query(`deck-tile-menu-${LOCAL_KEY}`)).not.toBeNull();
    expect(query("deck-select-manage")).not.toBeNull();
    expect(control("deck-select-delete").disabled).toBe(true);

    await fireEvent.click(control(`deck-tile-press-${LOCAL_KEY}`));

    expect(control("deck-select-delete").disabled).toBe(false);
  });

  it("renames a deck from the kebab and keeps it seated", async () => {
    await renderListedSetup();
    await fireEvent.click(control(`deck-tile-press-${LOCAL_KEY}`));

    await fireEvent.click(control(`deck-tile-menu-${LOCAL_KEY}`));
    await fireEvent.click(control(`deck-tile-menu-rename-${LOCAL_KEY}`));
    await fireEvent.input(
      query("deck-select-rename-input") as HTMLInputElement,
      {
        target: { value: "Renamed Deck" },
      },
    );
    await fireEvent.submit(query("deck-select-rename-form") as HTMLElement);

    await vi.waitFor(() => expect(gridKeys()).toContain(RENAMED_KEY));
    expect(query(`deck-tile-name-${RENAMED_KEY}`)?.textContent).toBe(
      "Renamed Deck",
    );
    /* The write moved the key, so the seat follows the deck rather than
       falling back to the bundled default. */
    expect(seatKey("yours")).toBe(RENAMED_KEY);
  });

  it("duplicates a deck and seats the copy", async () => {
    await renderListedSetup();
    await fireEvent.click(control(`deck-tile-press-${LOCAL_KEY}`));

    await fireEvent.click(control("deck-select-duplicate"));

    await vi.waitFor(() => expect(gridKeys()).toHaveLength(4));
    const copy = gridKeys().find(
      (key) => key.startsWith("local:") && key !== LOCAL_KEY,
    )!;
    expect(query(`deck-tile-name-${copy}`)?.textContent).toBe(
      "Built Deck Copy",
    );
    expect(seatKey("yours")).toBe(copy);
  });

  it("deletes a deck and re-seats the player from the fallback chain", async () => {
    await renderListedSetup();
    await fireEvent.click(control(`deck-tile-press-${LOCAL_KEY}`));
    expect(seatKey("yours")).toBe(LOCAL_KEY);

    await fireEvent.click(control("deck-select-delete"));
    await fireEvent.click(control("deck-select-delete-confirm-button"));

    await vi.waitFor(() => expect(gridKeys()).not.toContain(LOCAL_KEY));
    expect(seatKey("yours")).toBe(PLAYER_PRESET_KEY);
    expect(startButton().disabled).toBe(false);
  });

  it("opens a deck the player built on its own editor page", async () => {
    const setup = await renderListedSetup();

    await fireEvent.click(control(`deck-tile-menu-${LOCAL_KEY}`));
    await fireEvent.click(control(`deck-tile-menu-open-${LOCAL_KEY}`));

    expect(setup.onopendeck).toHaveBeenCalledWith("built-deck");
    expect(setup.ondecks).not.toHaveBeenCalled();
  });

  it("opens the selected local deck from the footer", async () => {
    const setup = await renderListedSetup();

    await fireEvent.click(control(`deck-tile-press-${LOCAL_KEY}`));
    await fireEvent.click(control("deck-select-open"));

    expect(setup.onopendeck).toHaveBeenCalledExactlyOnceWith("built-deck");
    expect(setup.ondecks).not.toHaveBeenCalled();
  });

  it("opens a local deck on dblclick without publishing a refusal", async () => {
    const show = vi.fn<ToastPublisher["show"]>(() => "toast-test");
    const setup = await renderListedSetup({ toasts: { show } });

    await fireEvent.dblClick(control(`deck-tile-press-${LOCAL_KEY}`));

    expect(setup.onopendeck).toHaveBeenCalledExactlyOnceWith("built-deck");
    expect(setup.ondecks).not.toHaveBeenCalled();
    expect(show).not.toHaveBeenCalled();
  });

  it("warns once on bundled dblclick without opening the editor", async () => {
    const show = vi.fn<ToastPublisher["show"]>(() => "toast-test");
    const setup = await renderLoadedSetup({ toasts: { show } });

    await fireEvent.dblClick(control(`deck-tile-press-${PLAYER_PRESET_KEY}`));

    expect(show).toHaveBeenCalledExactlyOnceWith({
      message: "Bundled deck: cannot be modified",
      tone: "warning",
    });
    expect(setup.onopendeck).not.toHaveBeenCalled();
    expect(setup.ondecks).not.toHaveBeenCalled();
  });

  it("announces bundled dblclick when toast context is unavailable", async () => {
    const setup = await renderLoadedSetup();

    await fireEvent.dblClick(control(`deck-tile-press-${PLAYER_PRESET_KEY}`));

    expect(query("deck-select-block-notice")?.textContent).toBe(
      "Bundled deck: cannot be modified",
    );
    expect(setup.onopendeck).not.toHaveBeenCalled();
    expect(setup.ondecks).not.toHaveBeenCalled();
  });

  /* A library that refused the write says so where every other refusal on this
     screen is said, and the grid stays live so another deck can be picked. */
  it("reports a refused write and keeps the screen usable", async () => {
    const save = vi
      .spyOn(IndexedDbDeckRepository.prototype, "save")
      .mockRejectedValue(new Error("Unable to save deck"));
    try {
      await renderListedSetup();
      await fireEvent.click(control(`deck-tile-press-${LOCAL_KEY}`));

      await fireEvent.click(control("deck-select-rename"));
      await fireEvent.submit(query("deck-select-rename-form") as HTMLElement);

      await vi.waitFor(() =>
        expect(query("deck-select-block-notice")?.textContent).toContain(
          "Deck could not be renamed: Unable to save deck",
        ),
      );
      expect(gridKeys()).toContain(LOCAL_KEY);
      expect(startButton().disabled).toBe(false);
    } finally {
      save.mockRestore();
    }
  });

  /* The bundled decks are compiled into this build, so they are on screen and
     playable before the library read behind them has answered. */
  it("offers the bundled decks before the library answers", async () => {
    /* A library read that never answers, so the first stage is what stays on
       screen: in a browser it is a fetch of the whole card database and an
       IndexedDB read behind it. */
    await renderLoadedSetup({
      module: { listSelectableDecks: () => new Promise(() => {}) },
    });

    expect(gridKeys()).toEqual([PLAYER_PRESET_KEY, OPPONENT_PRESET_KEY]);
    expect(startButton().disabled).toBe(false);
  });

  /* What a warmed page opens on: the read the main menu started is already an
     answer, so a second visit never waits on the battle entry again. The
     loader below would hang forever if this mount needed it. */
  it("opens on the library the page already read", async () => {
    warmFreePlayDecks(async () => battleModule());
    await vi.waitFor(() => expect(listedFreePlayDecks()).not.toBeNull());

    await renderListedSetup({
      loadBattle: () => new Promise<BattleDeckModule>(() => {}),
    });

    expect(startButton().disabled).toBe(false);
  });

  /* A deck built between two visits is listed on the second, so the grid is
     never the library the page happened to read first. */
  it("re-reads the library on every visit", async () => {
    await renderListedSetup();
    cleanup();
    await deleteDeckDatabase();

    await renderLoadedSetup();

    await vi.waitFor(() =>
      expect(gridKeys()).toEqual([PLAYER_PRESET_KEY, OPPONENT_PRESET_KEY]),
    );
  });

  it("seats the default pair and builds a battle request from it", async () => {
    const setup = await renderListedSetup();

    expect(seatKey("yours")).toBe(PLAYER_PRESET_KEY);
    expect(seatKey("opponent")).toBe(OPPONENT_PRESET_KEY);

    await fireEvent.click(control(`deck-tile-press-${LOCAL_KEY}`));
    await fireEvent.click(startButton());

    expect(setup.onstart).toHaveBeenCalledTimes(1);
    const request = setup.onstart.mock.calls[0]![0] as unknown;
    expect(parseBattleRequest(request)).toStrictEqual(request);
    expect((request as { player: { kind: string } }).player.kind).toBe("local");
    expect(request).toMatchObject({
      opponent: { kind: "preset", deckId: "chapter-one-practice" },
    });
  });

  it("remembers the last pairing", async () => {
    const storage = memoryStorage();
    const first = await renderListedSetup({ storage });

    await fireEvent.click(control(`deck-tile-press-${LOCAL_KEY}`));
    await fireEvent.click(control("duel-start-opponent-deck"));
    await fireEvent.click(control(`deck-tile-press-${PLAYER_PRESET_KEY}`));
    await fireEvent.click(startButton());
    expect(first.onstart).toHaveBeenCalledTimes(1);
    cleanup();

    await renderListedSetup({ storage });

    expect(seatKey("yours")).toBe(LOCAL_KEY);
    expect(seatKey("opponent")).toBe(PLAYER_PRESET_KEY);
  });

  it("falls back when a remembered deck is gone", async () => {
    const storage = memoryStorage();
    const first = await renderListedSetup({ storage });
    await fireEvent.click(control(`deck-tile-press-${LOCAL_KEY}`));
    await fireEvent.click(startButton());
    expect(first.onstart).toHaveBeenCalledTimes(1);
    cleanup();
    await deleteDeckDatabase();

    await renderLoadedSetup({ storage });

    expect(gridKeys()).toEqual([PLAYER_PRESET_KEY, OPPONENT_PRESET_KEY]);
    expect(seatKey("yours")).toBe(PLAYER_PRESET_KEY);
    expect(seatKey("opponent")).toBe(OPPONENT_PRESET_KEY);
    expect(startButton().disabled).toBe(false);
  });

  it("cannot start before either seat is filled", async () => {
    renderSetup({ loadBattle: () => new Promise<BattleDeckModule>(() => {}) });

    expect(startButton().disabled).toBe(true);
    expect(query("deck-select-block-notice")?.textContent).toContain(
      "Reading your deck library",
    );
  });

  /* The grid stays live so the player can pick their way out of it, rather
     than being left on a screen whose only working control is Back. */
  it("shows a refused request inline and keeps the grid usable", async () => {
    const setup = await renderListedSetup({
      module: {
        parseBattleRequest: () => {
          throw new BattleRequestError("player.deck.main holds 39 cards");
        },
      },
    });

    await fireEvent.click(startButton());

    expect(setup.onstart).not.toHaveBeenCalled();
    expect(query("deck-select-block-notice")?.textContent).toContain(
      "player.deck.main holds 39 cards",
    );

    await fireEvent.click(control(`deck-tile-press-${LOCAL_KEY}`));

    expect(seatKey("yours")).toBe(LOCAL_KEY);
    expect(query("deck-select-block-notice")).toBeNull();
  });

  /* A deck the library dropped between the listing and the press: the seat
     still names it, and Start says so instead of duelling nothing. */
  it("blocks with a notice when a chosen deck has vanished", async () => {
    const setup = await renderListedSetup({
      module: { findSelectableDeck: () => null },
    });

    await fireEvent.click(startButton());

    expect(setup.onstart).not.toHaveBeenCalled();
    expect(query("deck-select-block-notice")?.textContent).toContain(
      "A deck you chose is no longer available. Choose another.",
    );
  });

  it("goes back to the main menu without starting a match", async () => {
    const setup = await renderLoadedSetup();

    await fireEvent.click(control("deck-select-back"));

    expect(setup.onback).toHaveBeenCalledTimes(1);
    expect(setup.onstart).not.toHaveBeenCalled();
  });

  it("blocks footer Open while the selected deck is bundled", async () => {
    const setup = await renderLoadedSetup();

    await fireEvent.click(control("deck-select-open"));

    expect(query("deck-select-block-notice")?.textContent).toBe(
      "Bundled deck: cannot be modified",
    );
    expect(setup.ondecks).not.toHaveBeenCalled();
    expect(setup.onopendeck).not.toHaveBeenCalled();
    expect(setup.onstart).not.toHaveBeenCalled();
  });

  /* The roster is the pairing rule: choosing who you face chooses what they
     bring, and the choice outlives the match. */
  it("brings the picked persona's deck to the opponent seat", async () => {
    const setup = await renderLoadedSetup();

    expect(query("duel-start-opponent-name")?.textContent).toBe("Practice Bot");
    expect(seatKey("opponent")).toBe(OPPONENT_PRESET_KEY);
    await fireEvent.click(control("duel-start-opponent-deck"));
    await fireEvent.click(control(`deck-tile-press-${PLAYER_PRESET_KEY}`));
    expect(seatKey("opponent")).toBe(PLAYER_PRESET_KEY);

    await fireEvent.click(control("duel-start-opponent-portrait"));
    await fireEvent.click(control("duel-start-opponent-option-blaze-circuit"));

    expect(query("duel-start-opponent-name")?.textContent).toBe(
      "Blaze Circuit",
    );
    expect(seatKey("opponent")).toBe(OPPONENT_PRESET_KEY);
    expect(setup.storage.getItem("ygo.ui.v3")).toContain(
      '"freePlayOpponentId":"blaze-circuit"',
    );
    await fireEvent.click(startButton());
    expect(setup.onstart).toHaveBeenCalledExactlyOnceWith({
      player: { kind: "preset", deckId: "chapter-one-starter" },
      opponent: { kind: "preset", deckId: "chapter-one-practice" },
    });
  });

  /* Pressing the opponent's card hands the grid to their seat, so the next
     press overrides the deck they bring — for this match only. The persona is
     who you face, not what they happen to be holding today. */
  it("overrides the opponent's deck for one duel without changing the persona", async () => {
    await renderLoadedSetup();

    await fireEvent.click(control("duel-start-opponent-deck"));
    await fireEvent.click(control(`deck-tile-press-${PLAYER_PRESET_KEY}`));

    expect(seatKey("opponent")).toBe(PLAYER_PRESET_KEY);
    expect(seatKey("yours")).toBe(PLAYER_PRESET_KEY);
    expect(query("duel-start-opponent-name")?.textContent).toBe("Practice Bot");
  });

  it("renders no favourite controls for bundled or local decks", async () => {
    await renderListedSetup();

    expect(document.querySelector('[data-cy^="deck-tile-fav-"]')).toBeNull();
  });
});
