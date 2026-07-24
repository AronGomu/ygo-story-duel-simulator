import { describe, expect, it } from "vitest";
import { createInitialPrototypeState } from "../../../src/prototype/model/prototype-state.ts";
import {
  PROTOTYPE_STORAGE_KEY,
  loadPrototypeSlots,
  resetPrototypeStorage,
  savePrototypeState,
} from "../../../src/prototype/storage/prototype-storage.ts";

class MemoryStorage implements Storage {
  private values = new Map<string, string>();
  touched: string[] = [];
  get length(): number {
    return this.values.size;
  }
  clear(): void {
    this.values.clear();
  }
  getItem(key: string): string | null {
    this.touched.push(key);
    return this.values.get(key) ?? null;
  }
  key(index: number): string | null {
    return [...this.values.keys()][index] ?? null;
  }
  removeItem(key: string): void {
    this.touched.push(key);
    this.values.delete(key);
  }
  setItem(key: string, value: string): void {
    this.touched.push(key);
    this.values.set(key, value);
  }
}

describe("prototype storage", () => {
  it("round-trips distinct manual and autosave slots under one isolated key", () => {
    const storage = new MemoryStorage();
    const manual = {
      ...createInitialPrototypeState(),
      screen: "narrative" as const,
      progressExists: true,
    };
    const autosave = {
      ...createInitialPrototypeState(),
      screen: "reward" as const,
      savedScreen: "reward" as const,
      progressExists: true,
    };
    expect(savePrototypeState(manual, storage, "manual")).toEqual({ ok: true });
    expect(savePrototypeState(autosave, storage, "autosave")).toEqual({
      ok: true,
    });
    expect(loadPrototypeSlots(storage)).toEqual({
      ok: true,
      slots: { manual, autosave, latest: "autosave" },
    });
    expect(storage.touched.every((key) => key === PROTOTYPE_STORAGE_KEY)).toBe(
      true,
    );
    expect(PROTOTYPE_STORAGE_KEY).toMatch(/vn-prototype/);
    expect(PROTOTYPE_STORAGE_KEY).not.toMatch(/snapshot|duel|database/i);
  });

  it("rejects invalid envelopes and full state mutations", () => {
    const storage = new MemoryStorage();
    expect(loadPrototypeSlots(storage)).toEqual({
      ok: true,
      slots: { manual: null, autosave: null, latest: null },
    });
    storage.setItem(PROTOTYPE_STORAGE_KEY, "not json");
    expect(loadPrototypeSlots(storage)).toMatchObject({ ok: false });
    const valid = createInitialPrototypeState();
    for (const invalid of [
      { ...valid, screen: "unsafe" },
      { ...valid, savedScreen: [] },
      { ...valid, narrativeIndex: -1 },
      { ...valid, narrativeIndex: 999 },
      { ...valid, choice: "unsafe" },
      { ...valid, outcome: "unsafe" },
      { ...valid, locations: valid.locations.slice(1) },
      {
        ...valid,
        locations: valid.locations.map((location) => ({
          ...location,
          access: ["available"],
        })),
      },
    ]) {
      storage.setItem(
        PROTOTYPE_STORAGE_KEY,
        JSON.stringify({
          schemaVersion: 1,
          manual: invalid,
          autosave: null,
          latest: "manual",
        }),
      );
      expect(loadPrototypeSlots(storage)).toMatchObject({ ok: false });
    }
  });

  it("deletes one slot without touching the other or production keys", () => {
    const storage = new MemoryStorage();
    const state = createInitialPrototypeState();
    expect(savePrototypeState(state, storage, "manual")).toEqual({ ok: true });
    expect(savePrototypeState(state, storage, "autosave")).toEqual({
      ok: true,
    });
    storage.setItem("production-snapshot", "keep");
    expect(resetPrototypeStorage(storage, "manual")).toEqual({ ok: true });
    expect(loadPrototypeSlots(storage)).toEqual({
      ok: true,
      slots: { manual: null, autosave: state, latest: "autosave" },
    });
    expect(storage.getItem("production-snapshot")).toBe("keep");
    expect(resetPrototypeStorage(storage)).toEqual({ ok: true });
    expect(storage.getItem(PROTOTYPE_STORAGE_KEY)).toBeNull();
  });

  it("contains unavailable default/read/write/reset storage", () => {
    const descriptor = Object.getOwnPropertyDescriptor(
      globalThis,
      "localStorage",
    );
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      get: () => {
        throw new Error("blocked default");
      },
    });
    expect(loadPrototypeSlots()).toMatchObject({
      ok: false,
      message: "blocked default",
    });
    if (descriptor === undefined)
      delete (globalThis as { localStorage?: Storage }).localStorage;
    else Object.defineProperty(globalThis, "localStorage", descriptor);

    const storage = new MemoryStorage();
    storage.getItem = () => {
      throw new Error("blocked read");
    };
    expect(loadPrototypeSlots(storage)).toMatchObject({
      ok: false,
      message: "blocked read",
    });
    storage.getItem = () => null;
    storage.setItem = () => {
      throw new Error("quota");
    };
    expect(
      savePrototypeState(createInitialPrototypeState(), storage),
    ).toMatchObject({ ok: false, message: "quota" });
    storage.removeItem = () => {
      throw new Error("blocked reset");
    };
    expect(resetPrototypeStorage(storage)).toMatchObject({
      ok: false,
      message: "blocked reset",
    });
  });
});
