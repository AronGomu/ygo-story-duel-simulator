import { get } from "svelte/store";
import { describe, expect, it, vi } from "vitest";
import { PERSISTED_UI_STATE_KEY } from "../../src/battle/app/stores/persisted-ui-state.ts";
import { createPersistedUiStore } from "../../src/battle/app/stores/persisted-ui-store.ts";

function memoryStorage(seed: string | null = null) {
  let value = seed;
  const setItem = vi.fn((key: string, next: string) => {
    if (key === PERSISTED_UI_STATE_KEY) value = next;
  });
  return {
    getItem: (key: string) => (key === PERSISTED_UI_STATE_KEY ? value : null),
    setItem,
    read: () => (value === null ? null : (JSON.parse(value) as unknown)),
  };
}

const SEED = JSON.stringify({
  version: 2,
  windows: { zoneList: { x: 12, y: 34 }, confirm: { x: 56, y: 78 } },
  decks: { playerKey: "preset:nekroz", opponentKey: "preset:shaddoll" },
  settings: {
    showZoneOutlines: false,
    showZoneCounts: true,
    showCardShadows: true,
    showZoneLabels: true,
  },
});

describe("persisted UI store", () => {
  it("initializes from the persisted reader", () => {
    const storage = memoryStorage(SEED);
    const store = createPersistedUiStore(storage);

    expect(get(store)).toEqual({
      version: 2,
      windows: { zoneList: { x: 12, y: 34 }, confirm: { x: 56, y: 78 } },
      decks: { playerKey: "preset:nekroz", opponentKey: "preset:shaddoll" },
      settings: {
        showZoneOutlines: false,
        showZoneCounts: true,
        showCardShadows: true,
        showZoneLabels: true,
      },
    });
    expect(storage.setItem).not.toHaveBeenCalled();
  });

  it("initializes to defaults when storage is unavailable", () => {
    const store = createPersistedUiStore(null);

    expect(get(store).decks).toEqual({
      playerKey: "preset:chapter-one-starter",
      opponentKey: "preset:chapter-one-practice",
    });
    expect(get(store).windows).toEqual({ zoneList: null, confirm: null });
  });

  it("setDecks preserves both window positions and writes once", () => {
    const storage = memoryStorage(SEED);
    const store = createPersistedUiStore(storage);

    store.setDecks("preset:shaddoll", "local:built-deck:2");

    expect(get(store).decks).toEqual({
      playerKey: "preset:shaddoll",
      opponentKey: "local:built-deck:2",
    });
    expect(get(store).windows).toEqual({
      zoneList: { x: 12, y: 34 },
      confirm: { x: 56, y: 78 },
    });
    expect(storage.setItem).toHaveBeenCalledTimes(1);
    expect(storage.read()).toEqual(get(store));
  });

  it("setWindowPosition preserves the deck pair and the other window", () => {
    const storage = memoryStorage(SEED);
    const store = createPersistedUiStore(storage);

    store.setWindowPosition("zoneList", { x: 5, y: 6 });

    expect(get(store).windows).toEqual({
      zoneList: { x: 5, y: 6 },
      confirm: { x: 56, y: 78 },
    });
    expect(get(store).decks).toEqual({
      playerKey: "preset:nekroz",
      opponentKey: "preset:shaddoll",
    });
    expect(storage.setItem).toHaveBeenCalledTimes(1);
    expect(storage.read()).toEqual(get(store));
  });

  it("setDisplaySettings preserves decks and windows and writes once", () => {
    const storage = memoryStorage(SEED);
    const store = createPersistedUiStore(storage);
    store.setDisplaySettings({
      showZoneOutlines: true,
      showZoneCounts: false,
      showCardShadows: false,
      showZoneLabels: false,
    });
    expect(get(store).settings).toEqual({
      showZoneOutlines: true,
      showZoneCounts: false,
      showCardShadows: false,
      showZoneLabels: false,
    });
    expect(get(store).decks).toEqual({
      playerKey: "preset:nekroz",
      opponentKey: "preset:shaddoll",
    });
    expect(get(store).windows.zoneList).toEqual({ x: 12, y: 34 });
    expect(storage.setItem).toHaveBeenCalledTimes(1);
  });

  it("each window keeps its own position", () => {
    const storage = memoryStorage();
    const store = createPersistedUiStore(storage);

    store.setWindowPosition("confirm", { x: 1, y: 2 });
    store.setWindowPosition("zoneList", { x: 3, y: 4 });

    expect(get(store).windows).toEqual({
      zoneList: { x: 3, y: 4 },
      confirm: { x: 1, y: 2 },
    });
    expect(storage.setItem).toHaveBeenCalledTimes(2);
  });

  it("clears a window position back to null", () => {
    const storage = memoryStorage(SEED);
    const store = createPersistedUiStore(storage);

    store.setWindowPosition("confirm", null);

    expect(get(store).windows.confirm).toBeNull();
    expect(get(store).windows.zoneList).toEqual({ x: 12, y: 34 });
  });

  it("writes the complete v2 state on every setter", () => {
    const storage = memoryStorage();
    const store = createPersistedUiStore(storage);

    store.setWindowPosition("zoneList", { x: 7, y: 8 });

    expect(storage.read()).toEqual({
      version: 2,
      windows: { zoneList: { x: 7, y: 8 }, confirm: null },
      decks: {
        playerKey: "preset:chapter-one-starter",
        opponentKey: "preset:chapter-one-practice",
      },
      settings: {
        showZoneOutlines: true,
        showZoneCounts: true,
        showCardShadows: true,
        showZoneLabels: true,
      },
    });
  });

  it("a throwing storage never escapes a setter", () => {
    const store = createPersistedUiStore({
      getItem: () => {
        throw new DOMException("Blocked", "SecurityError");
      },
      setItem: () => {
        throw new DOMException("Storage full", "QuotaExceededError");
      },
    });

    expect(() =>
      store.setDecks("preset:nekroz", "preset:shaddoll"),
    ).not.toThrow();
    expect(() =>
      store.setWindowPosition("zoneList", { x: 1, y: 1 }),
    ).not.toThrow();
    expect(get(store).decks).toEqual({
      playerKey: "preset:nekroz",
      opponentKey: "preset:shaddoll",
    });
  });
});
