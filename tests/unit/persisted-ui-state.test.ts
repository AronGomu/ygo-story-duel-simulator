import { describe, expect, it } from "vitest";
import {
  DEFAULT_PERSISTED_UI_STATE,
  hasPersistedUiState,
  PERSISTED_UI_STATE_KEY,
  readPersistedUiState,
  writePersistedUiState,
  type PersistedUiState,
} from "../../src/battle/app/stores/persisted-ui-state.ts";

function validState(): PersistedUiState {
  return {
    version: 2,
    windows: {
      zoneList: { x: 12, y: 34 },
      confirm: { x: 56, y: 78 },
    },
    decks: { playerKey: "preset:nekroz", opponentKey: "local:built-deck:3" },
    settings: {
      showZoneOutlines: false,
      showZoneCounts: true,
      showCardShadows: false,
      showZoneLabels: false,
    },
  };
}

describe("persisted UI state", () => {
  it("returns defaults when storage is null", () => {
    expect(readPersistedUiState(null)).toEqual(DEFAULT_PERSISTED_UI_STATE);
  });

  it("returns defaults when the key is absent", () => {
    expect(readPersistedUiState({ getItem: () => null })).toEqual(
      DEFAULT_PERSISTED_UI_STATE,
    );
  });

  it("returns defaults for unparseable JSON", () => {
    expect(readPersistedUiState({ getItem: () => "{" })).toEqual(
      DEFAULT_PERSISTED_UI_STATE,
    );
  });

  it("returns defaults for a wrong version", () => {
    expect(
      readPersistedUiState({
        getItem: () => JSON.stringify({ ...validState(), version: 4 }),
      }),
    ).toEqual(DEFAULT_PERSISTED_UI_STATE);
  });

  it("loads legacy v1 payload as complete defaults", () => {
    expect(
      readPersistedUiState({
        getItem: () => JSON.stringify({ ...validState(), version: 1 }),
      }),
    ).toEqual(DEFAULT_PERSISTED_UI_STATE);
  });

  it("falls back malformed setting leaves independently", () => {
    const state = readPersistedUiState({
      getItem: () =>
        JSON.stringify({
          ...validState(),
          settings: { showZoneOutlines: "no", showZoneCounts: false },
        }),
    });
    expect(state.settings).toEqual({
      showZoneOutlines: true,
      showZoneCounts: false,
      showCardShadows: true,
      showZoneLabels: true,
    });
  });

  it("reads a bundled pair written by an earlier build as preset keys", () => {
    const persisted = {
      ...validState(),
      decks: { player: "burning-abyss", opponent: "nekroz" },
    };
    expect(
      readPersistedUiState({ getItem: () => JSON.stringify(persisted) }).decks,
    ).toEqual({
      playerKey: "preset:burning-abyss",
      opponentKey: "preset:nekroz",
    });
  });

  it("falls back per field for a missing deck key", () => {
    const persisted = {
      ...validState(),
      decks: { opponentKey: "local:built-deck:3" },
    };
    expect(
      readPersistedUiState({ getItem: () => JSON.stringify(persisted) }).decks,
    ).toEqual({
      playerKey: "preset:chapter-one-starter",
      opponentKey: "local:built-deck:3",
    });
  });

  /* An unknown key is kept, not repaired: only the picker knows which decks
     resolve today, and it is the surface that explains the fallback. */
  it("keeps a deck key it cannot interpret", () => {
    const persisted = {
      ...validState(),
      decks: { playerKey: "local:deleted-deck:9", opponentKey: "preset:x" },
    };
    expect(
      readPersistedUiState({ getItem: () => JSON.stringify(persisted) }).decks,
    ).toEqual({
      playerKey: "local:deleted-deck:9",
      opponentKey: "preset:x",
    });
  });

  it("drops a window position with a non-finite coordinate", () => {
    const persisted = {
      ...validState(),
      windows: { zoneList: null, confirm: { x: 10, y: "NaN" } },
    };
    expect(
      readPersistedUiState({ getItem: () => JSON.stringify(persisted) }).windows
        .confirm,
    ).toBeNull();
  });

  it("defaults new display settings for an older v2 payload", () => {
    const persisted = {
      ...validState(),
      settings: { showZoneOutlines: false, showZoneCounts: false },
    };
    expect(
      readPersistedUiState({ getItem: () => JSON.stringify(persisted) })
        .settings,
    ).toEqual({
      showZoneOutlines: false,
      showZoneCounts: false,
      showCardShadows: true,
      showZoneLabels: true,
    });
  });

  it("falls back independently for malformed new display settings", () => {
    const persisted = {
      ...validState(),
      settings: {
        showZoneOutlines: true,
        showZoneCounts: true,
        showCardShadows: "no",
        showZoneLabels: 1,
      },
    };
    expect(
      readPersistedUiState({ getItem: () => JSON.stringify(persisted) })
        .settings,
    ).toMatchObject({ showCardShadows: true, showZoneLabels: true });
  });

  it("round-trips a valid state", () => {
    let value: string | null = null;
    const storage = {
      getItem: (key: string) => (key === PERSISTED_UI_STATE_KEY ? value : null),
      setItem: (key: string, next: string) => {
        if (key === PERSISTED_UI_STATE_KEY) value = next;
      },
    };
    const state = validState();
    writePersistedUiState(state, storage);
    expect(readPersistedUiState(storage)).toEqual(state);
  });

  /* The duel menu asks this to tell a first run from a player who chose the
     bundled deck, and the two read back identically through the state. */
  it("reports whether a record exists at all", () => {
    expect(hasPersistedUiState(null)).toBe(false);
    expect(hasPersistedUiState({ getItem: () => null })).toBe(false);
    expect(hasPersistedUiState({ getItem: () => "{" })).toBe(true);
    expect(
      hasPersistedUiState({
        getItem: (key: string) =>
          key === PERSISTED_UI_STATE_KEY ? "{}" : null,
      }),
    ).toBe(true);
  });

  it("a throwing getItem reads as no record rather than escaping", () => {
    expect(
      hasPersistedUiState({
        getItem: () => {
          throw new DOMException("Blocked", "SecurityError");
        },
      }),
    ).toBe(false);
  });

  it("a throwing setItem does not propagate", () => {
    expect(() =>
      writePersistedUiState(validState(), {
        setItem: () => {
          throw new DOMException("Storage full", "QuotaExceededError");
        },
      }),
    ).not.toThrow();
  });
});
