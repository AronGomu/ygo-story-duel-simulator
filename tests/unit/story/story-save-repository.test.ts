// @vitest-environment node

import "fake-indexeddb/auto";
import { deleteDB } from "idb";
import { afterEach, describe, expect, it } from "vitest";
import { storyDeckFixture } from "../../fixtures/story-decks.ts";
import { PROLOGUE } from "../../../src/story/content/prologue.ts";
import { buildLegacyStarterGrant } from "../../../src/story/decks/starter-grant.ts";
import {
  createInitialStoryState,
  type StoryState,
} from "../../../src/story/model/story-state.ts";
import {
  createStorySaveStores,
  STORY_SAVE_SCHEMA_VERSION,
  STORY_SAVES_DATABASE_NAME,
  STORY_SAVES_DATABASE_VERSION,
  STORY_SAVES_STORE_NAME,
  STORY_SLOT_KEYS,
  type StorySlotKey,
} from "../../../src/story/saves/story-save-contracts.ts";
import { createStorySaveRepository } from "../../../src/story/saves/story-save-repository.ts";

/* The story save store is the first thing T19's duel checkpoint will trust, so
   every state a player can arrive in is driven here through the same
   `fake-indexeddb` factory the browser gives the repository: no database yet,
   a database with nothing in it, an overwrite, a record this build cannot
   read, and a write that fails part-way. */

const originalPut = IDBObjectStore.prototype.put;

afterEach(async () => {
  IDBObjectStore.prototype.put = originalPut;
  await deleteDB(STORY_SAVES_DATABASE_NAME);
});

function repository(now: () => number = () => 1_700_000_000_000) {
  return createStorySaveRepository(indexedDB, now);
}

function storyState(overrides: Partial<StoryState> = {}): StoryState {
  return {
    ...createInitialStoryState(),
    screen: "map",
    savedScreen: "map",
    progressExists: true,
    narrativeIndex: 18,
    lastInputId: 12,
    choice: "trust-rin",
    choiceResponse: "Then walk beside me.",
    ...overrides,
  };
}

async function databaseNames(): Promise<readonly string[]> {
  return (await indexedDB.databases()).map(({ name }) => name ?? "");
}

/** The record exactly as it sits on disk, so a claim about what was written
    is read from the store rather than from the repository's own answer. */
function storedRecord(slot: string): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(
      STORY_SAVES_DATABASE_NAME,
      STORY_SAVES_DATABASE_VERSION,
    );
    request.onupgradeneeded = () => createStorySaveStores(request.result);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const database = request.result;
      const transaction = database.transaction(
        STORY_SAVES_STORE_NAME,
        "readonly",
      );
      const record = transaction.objectStore(STORY_SAVES_STORE_NAME).get(slot);
      transaction.oncomplete = () => {
        database.close();
        resolve(record.result);
      };
      transaction.onabort = () => {
        database.close();
        reject(transaction.error);
      };
    };
  });
}

/** A state as a build before the economy existed wrote it: the seven economy
    and shop-session fields are simply absent from the record, and so are the
    two deck fields, neither of which a build this old ever wrote. */
function version1State(): Record<string, unknown> {
  const state: Record<string, unknown> = { ...storyState() };
  for (const key of [
    "dp",
    "boosters",
    "collection",
    "shopReturnScreen",
    "shopSetId",
    "openedCards",
    "openingMode",
    "decks",
    "defaultDeckId",
  ])
    delete state[key];
  return state;
}

/** A save exactly as the build before decks existed wrote it: captured from
    `createStorySaveRepository` at commit `22f868b` and pasted here verbatim,
    rather than synthesised from today's `createInitialStoryState()`. A
    migration proved only against a fixture this file builds is a migration
    proved against this file's idea of version 2. */
const VERSION_2_RECORD = {
  schemaVersion: 2,
  slot: "manual:1",
  revision: 1,
  savedAt: 1_700_000_000_123,
  state: {
    screen: "map",
    savedScreen: "map",
    progressExists: true,
    narrativeIndex: 18,
    lastInputId: 12,
    choice: "trust-rin",
    choiceResponse: "Then walk beside me.",
    laterAcknowledgment: null,
    locations: [
      { id: "old-arena", access: "available", completed: false },
      { id: "archive", access: "locked", completed: false },
      { id: "hidden-gate", access: "hidden", completed: false },
      { id: "card-shop", access: "available", completed: false },
    ],
    outcome: null,
    outcomeScene: null,
    rewardGranted: true,
    rewardAcknowledged: false,
    objective: "Meet Rin at the Old Arena",
    encounterId: "old-arena",
    pendingHandoffId: null,
    dp: 640,
    boosters: { "metal-raiders": 2 },
    collection: { 89631139: 3 },
    shopReturnScreen: null,
    shopSetId: null,
    openedCards: null,
    openingMode: null,
  },
} as const;

/** Plants a raw record the repository would never write, so the read path can
    be shown recognising it. Seeding goes through `createStorySaveStores` so a
    schema change cannot leave this fixture describing a store that is gone. */
function seedRecord(slot: string, record: unknown): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(
      STORY_SAVES_DATABASE_NAME,
      STORY_SAVES_DATABASE_VERSION,
    );
    request.onupgradeneeded = () => createStorySaveStores(request.result);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const database = request.result;
      const transaction = database.transaction(
        STORY_SAVES_STORE_NAME,
        "readwrite",
      );
      transaction.objectStore(STORY_SAVES_STORE_NAME).put(record, slot);
      transaction.oncomplete = () => {
        database.close();
        resolve();
      };
      transaction.onabort = () => {
        database.close();
        reject(transaction.error);
      };
    };
  });
}

describe("story save slots", () => {
  it("names the production database and the five slot keys", () => {
    expect(STORY_SAVES_DATABASE_NAME).toBe("ygo-story-saves");
    expect(STORY_SAVE_SCHEMA_VERSION).toBe(4);
    expect([...STORY_SLOT_KEYS]).toEqual([
      "manual:1",
      "manual:2",
      "manual:3",
      "autosave",
      "checkpoint:pre-duel",
    ]);
  });
});

describe("createStorySaveRepository", () => {
  it("reads empty from a slot when no database exists yet", async () => {
    expect(await databaseNames()).not.toContain(STORY_SAVES_DATABASE_NAME);
    const saves = repository();
    expect(await saves.read("manual:1")).toEqual({
      kind: "empty",
      slot: "manual:1",
    });
    expect(await databaseNames()).toContain(STORY_SAVES_DATABASE_NAME);
  });

  it("reads empty from every slot of a database that holds nothing", async () => {
    const saves = repository();
    await saves.write("manual:1", storyState(), null);
    await saves.clear("manual:1");
    for (const slot of STORY_SLOT_KEYS)
      expect(await saves.read(slot)).toEqual({ kind: "empty", slot });
    expect(await saves.list()).toEqual([]);
  });

  it("round-trips a written state unchanged", async () => {
    const saves = repository(() => 1_700_000_000_123);
    const state = storyState();
    expect(await saves.write("manual:1", state, null)).toEqual({
      kind: "written",
      revision: 1,
    });
    const read = await saves.read("manual:1");
    expect(read).toEqual({
      kind: "ready",
      envelope: {
        schemaVersion: 4,
        slot: "manual:1",
        revision: 1,
        savedAt: 1_700_000_000_123,
        state,
      },
    });
    /* Structural equality is not enough on its own: a save that comes back
       missing a nested location or with a re-ordered beat index is a save the
       player cannot resume from. */
    if (read.kind !== "ready") throw new Error("expected a ready save");
    expect(read.envelope.state).not.toBe(state);
    expect(JSON.stringify(read.envelope.state)).toBe(JSON.stringify(state));
  });

  it("writes envelopes at schema version 4", async () => {
    const saves = repository();
    await saves.write("manual:1", storyState(), null);
    expect(await storedRecord("manual:1")).toMatchObject({
      schemaVersion: 4,
    });
  });

  it("loads a legacy save without previousScreen as null", async () => {
    const legacy = { ...storyState() } as Record<string, unknown>;
    delete legacy.previousScreen;
    const record = {
      schemaVersion: 3,
      slot: "manual:1",
      revision: 1,
      savedAt: 1,
      state: legacy,
    };
    await seedRecord("manual:1", record);

    const read = await repository().read("manual:1");

    expect(read.kind).toBe("ready");
    if (read.kind !== "ready") throw new Error("expected a ready save");
    expect(read.envelope.state.previousScreen).toBeNull();
    expect(await storedRecord("manual:1")).toEqual(record);
  });

  it("normalizes an invalid saved previousScreen without rejecting the save", async () => {
    const record = {
      schemaVersion: 4,
      slot: "manual:1",
      revision: 1,
      savedAt: 1,
      state: { ...storyState(), previousScreen: "unknown-screen" },
    };
    await seedRecord("manual:1", record);

    const read = await repository().read("manual:1");

    expect(read.kind).toBe("ready");
    if (read.kind !== "ready") throw new Error("expected a ready save");
    expect(read.envelope.state.previousScreen).toBeNull();
    expect(await storedRecord("manual:1")).toEqual(record);
  });

  /* The one migration a player can lose progress to. What is proved here is
     that a save the previous build actually wrote still opens, that it gains
     a deck it can duel with, and that reading it leaves the record on disk
     exactly as it was.

     The grant is what makes the save playable at all: every gate downstream —
     the pre-battle briefing, `encounterDeck`, the deck editor, which grants a
     story save nothing — reads the deck list, and a migrated save that arrived
     with an empty one could not duel and could not build its way out of it. */
  it("a v2 save migrates to v4 with a deck it can duel with", async () => {
    const { deck, collection } = buildLegacyStarterGrant();
    await seedRecord("manual:1", VERSION_2_RECORD);
    const read = await repository().read("manual:1");
    expect(read).toMatchObject({
      kind: "ready",
      envelope: {
        schemaVersion: 4,
        slot: "manual:1",
        revision: 1,
        savedAt: 1_700_000_000_123,
        state: { decks: [deck], defaultDeckId: deck.id, previousScreen: null },
      },
    });
    if (read.kind !== "ready") throw new Error("expected a ready save");
    /* Additive in both directions: every field the record carried comes back
       with the value it carried — the collection with the granted cards added
       to it — and the only fields it did not carry are the three deck/current
       navigation fields this build adds. */
    for (const [key, value] of Object.entries(VERSION_2_RECORD.state))
      if (key !== "collection")
        expect(read.envelope.state[key as keyof StoryState], key).toEqual(
          value,
        );
    expect(read.envelope.state.collection).toEqual({
      ...collection,
      ...VERSION_2_RECORD.state.collection,
    });
    expect(Object.keys(read.envelope.state).sort()).toEqual(
      [
        ...Object.keys(VERSION_2_RECORD.state),
        "decks",
        "defaultDeckId",
        "previousScreen",
      ].sort(),
    );
    /* Migration happens in memory. A read that rewrote the slot would turn
       every load into a write the player never asked for. */
    expect(await storedRecord("manual:1")).toEqual(VERSION_2_RECORD);
  });

  /* Set semantics, not add. The record on disk stays at version 2, so every
     read of it migrates again — and a grant that added would double the
     collection on the second read and again on the third. */
  it("migrates the same record twice to the same state", async () => {
    await seedRecord("manual:1", VERSION_2_RECORD);
    const saves = repository();
    const first = await saves.read("manual:1");
    const second = await saves.read("manual:1");
    if (first.kind !== "ready" || second.kind !== "ready")
      throw new Error("expected two ready saves");
    expect(second.envelope.state).toEqual(first.envelope.state);
    expect(await storedRecord("manual:1")).toEqual(VERSION_2_RECORD);
  });

  /* Per card code, the higher of the two counts. A count above what the deck
     runs is the player's and is never lowered; a count below it is topped up,
     because a partial playset is the lockout the grant exists to close — a save
     owning one copy of a card the starter deck runs three of would be handed a
     deck the ownership rule still refuses, and the player would be blocked
     while holding it. Topping up only ever adds what the granted deck itself
     needs, so it stays idempotent across reads. */
  it("tops a stored count up to the granted playset and never lowers one", async () => {
    const { collection } = buildLegacyStarterGrant();
    const hoarded = 89631139;
    const sold = 97590747;
    expect(collection[hoarded]).toBe(2);
    expect(collection[sold]).toBe(3);
    await seedRecord("manual:1", {
      ...VERSION_2_RECORD,
      state: {
        ...VERSION_2_RECORD.state,
        collection: { [hoarded]: 3, [sold]: 1 },
      },
    });
    const saves = repository();
    const read = await saves.read("manual:1");
    if (read.kind !== "ready") throw new Error("expected a ready save");
    expect(read.envelope.state.collection[hoarded]).toBe(3);
    expect(read.envelope.state.collection[sold]).toBe(3);
    /* The record on disk stays at version 2, so the next read migrates it
       again: the top-up has to land on the same counts a second time. */
    const second = await saves.read("manual:1");
    if (second.kind !== "ready") throw new Error("expected a ready save");
    expect(second.envelope.state.collection).toEqual(
      read.envelope.state.collection,
    );
    expect(await storedRecord("manual:1")).toMatchObject({
      state: { collection: { [hoarded]: 3, [sold]: 1 } },
    });
  });

  /* The grant tops counts up; it does not repair a collection this build
     cannot read. A stored value that is not a count stays exactly as it is, so
     the record still fails validation rather than being laundered into a valid
     save by the merge. */
  it("leaves an unreadable stored count unreadable", async () => {
    const { collection } = buildLegacyStarterGrant();
    const sold = 97590747;
    expect(collection[sold]).toBe(3);
    await seedRecord("manual:1", {
      ...VERSION_2_RECORD,
      state: { ...VERSION_2_RECORD.state, collection: { [sold]: "three" } },
    });
    expect(await repository().read("manual:1")).toMatchObject({
      kind: "corrupt",
    });
  });

  /* The deck list is a stored value like any other. A record that already
     carries one is a record the grant has nothing to complete, whatever
     version it declares. */
  it("leaves a deck list the record already carries alone", async () => {
    const stored = storyDeckFixture("alpha");
    await seedRecord("manual:1", {
      ...VERSION_2_RECORD,
      state: {
        ...VERSION_2_RECORD.state,
        decks: [stored],
        defaultDeckId: stored.id,
      },
    });
    const read = await repository().read("manual:1");
    if (read.kind !== "ready") throw new Error("expected a ready save");
    expect(read.envelope.state.decks).toEqual([stored]);
    expect(read.envelope.state.defaultDeckId).toBe(stored.id);
  });

  /* A save this build wrote is never migrated, so an empty deck list it chose
     to hold stays empty: the player deleted their last deck, and a read that
     handed it back would be the fountain the deck editor's seeding was taken
     out to close. */
  it("leaves a v4 save with no decks exactly as it was written", async () => {
    const saves = repository();
    const state = storyState({ decks: [], defaultDeckId: null });
    await saves.write("manual:1", state, null);
    const read = await saves.read("manual:1");
    if (read.kind !== "ready") throw new Error("expected a ready save");
    expect(read.envelope.state.decks).toEqual([]);
    expect(read.envelope.state.defaultDeckId).toBeNull();
    expect(read.envelope.state.collection).toEqual(state.collection);
  });

  it("a v4 save round-trips", async () => {
    const saves = repository();
    const state = storyState({
      previousScreen: "shop-browse",
      decks: [storyDeckFixture("alpha"), storyDeckFixture("beta")],
      defaultDeckId: "beta",
    });
    expect(await saves.write("manual:1", state, null)).toEqual({
      kind: "written",
      revision: 1,
    });
    const read = await saves.read("manual:1");
    if (read.kind !== "ready") throw new Error("expected a ready save");
    expect(read.envelope.schemaVersion).toBe(4);
    expect(read.envelope.state.decks).toEqual(state.decks);
    expect(read.envelope.state.defaultDeckId).toBe("beta");
    expect(read.envelope.state.previousScreen).toBe("shop-browse");
    expect(JSON.stringify(read.envelope.state)).toBe(JSON.stringify(state));
  });

  /* A v3 record is not migrated, so a deck list it does not carry is a record
     this build cannot resume from: the screens would iterate `undefined`.
     Refusing at the door leaves the record on disk for a build that can read
     it, which is what `incompatible` and `corrupt` both exist to preserve. */
  it("reports a v3 record without a usable deck list as corrupt", async () => {
    const saves = repository();
    const valid = createInitialStoryState();
    const invalidStates: readonly unknown[] = [
      { ...valid, decks: undefined },
      { ...valid, decks: null },
      { ...valid, decks: "all of them" },
      { ...valid, decks: [{ id: "alpha" }] },
      { ...valid, decks: [storyDeckFixture("alpha", { main: [-1] })] },
      {
        ...valid,
        decks: [storyDeckFixture("alpha"), storyDeckFixture("alpha")],
      },
      { ...valid, defaultDeckId: 7 },
    ];
    for (const state of invalidStates) {
      const record = {
        schemaVersion: 3,
        slot: "manual:1",
        revision: 1,
        savedAt: 1,
        state,
      };
      await seedRecord("manual:1", record);
      expect((await saves.read("manual:1")).kind, JSON.stringify(state)).toBe(
        "corrupt",
      );
      expect(await storedRecord("manual:1")).toEqual(record);
    }
  });

  it.each([
    ["valid", ["alpha"]],
    ["malformed string", "alpha"],
    ["malformed null", null],
    ["malformed array", [7]],
    ["malformed object", { alpha: true }],
  ])(
    "loads a legacy save with %s favourites and drops the field",
    async (_name, favourites) => {
      const legacy = {
        ...storyState({ decks: [storyDeckFixture("alpha")] }),
        favouriteDeckIds: favourites,
      };
      const record = {
        schemaVersion: 3,
        slot: "manual:1",
        revision: 1,
        savedAt: 1,
        state: legacy,
      };
      await seedRecord("manual:1", record);

      const read = await repository().read("manual:1");
      if (read.kind !== "ready") throw new Error("expected a ready save");
      expect("favouriteDeckIds" in read.envelope.state).toBe(false);
      expect(read.envelope.state.decks).toEqual(legacy.decks);
      expect(await storedRecord("manual:1")).toEqual(record);
    },
  );

  /* The economy rides inside the story state, so a save has to carry it back
     exactly: a wallet that rounds down on load is progress a player lost. */
  it("round-trips the economy", async () => {
    const saves = repository();
    const state = storyState({
      dp: 640,
      boosters: { "metal-raiders": 2 },
      collection: { 89631139: 3 },
    });
    await saves.write("manual:1", state, null);
    const read = await saves.read("manual:1");
    expect(read).toMatchObject({
      kind: "ready",
      envelope: {
        state: {
          dp: 640,
          boosters: { "metal-raiders": 2 },
          collection: { 89631139: 3 },
        },
      },
    });
    if (read.kind !== "ready") throw new Error("expected a ready save");
    expect(read.envelope.state).toEqual(state);
  });

  /* A save written before the shop existed still has to resume. It reads as a
     funded wallet owning the granted deck and nothing else, and every field it
     did carry survives. */
  it("reads a version 1 envelope by defaulting the economy", async () => {
    const legacy = version1State();
    const { deck, collection } = buildLegacyStarterGrant();
    await seedRecord("manual:1", {
      schemaVersion: 1,
      slot: "manual:1",
      revision: 4,
      savedAt: 1_700_000_000_000,
      state: legacy,
    });
    const read = await repository().read("manual:1");
    expect(read).toMatchObject({
      kind: "ready",
      envelope: {
        revision: 4,
        state: {
          dp: 1000,
          boosters: {},
          collection,
          shopReturnScreen: null,
          shopSetId: null,
          openedCards: null,
          openingMode: null,
          decks: [deck],
          defaultDeckId: deck.id,
        },
      },
    });
    if (read.kind !== "ready") throw new Error("expected a ready save");
    /* Everything the old build did store comes back untouched: a migration
       that resumes the player one beat earlier is a migration that lost data. */
    for (const [key, value] of Object.entries(legacy))
      expect(read.envelope.state[key as keyof StoryState], key).toEqual(value);
  });

  /* A save written before the shop existed carries a map with no shop on it.
     Resuming that map as-is would leave the player funded with no way to
     spend it, forever — the node only exists in states this build creates. */
  it("gives a pre-shop map its card shop back", async () => {
    const legacy = version1State();
    legacy["locations"] = (
      legacy["locations"] as readonly { readonly id: string }[]
    ).filter(({ id }) => id !== "card-shop");
    await seedRecord("manual:1", {
      schemaVersion: 1,
      slot: "manual:1",
      revision: 1,
      savedAt: 1,
      state: legacy,
    });
    const read = await repository().read("manual:1");
    if (read.kind !== "ready") throw new Error("expected a ready save");
    expect(read.envelope.state.locations.map(({ id }) => id)).toEqual(
      createInitialStoryState().locations.map(({ id }) => id),
    );
    expect(read.envelope.state.locations.at(-1)).toEqual({
      id: "card-shop",
      access: "available",
      completed: false,
    });
  });

  /* Two version 1 saves must not come back sharing one inventory: a default
     handed out by reference would let a purchase in one slot appear in the
     other. */
  it("gives every migrated save its own inventory", async () => {
    const legacy = version1State();
    for (const slot of ["manual:1", "manual:2"])
      await seedRecord(slot, {
        schemaVersion: 1,
        slot,
        revision: 1,
        savedAt: 1,
        state: legacy,
      });
    const saves = repository();
    const first = await saves.read("manual:1");
    const second = await saves.read("manual:2");
    if (first.kind !== "ready" || second.kind !== "ready")
      throw new Error("expected two ready saves");
    expect(first.envelope.state.boosters).not.toBe(
      second.envelope.state.boosters,
    );
    expect(first.envelope.state.collection).not.toBe(
      second.envelope.state.collection,
    );
    expect(first.envelope.state.decks).not.toBe(second.envelope.state.decks);
  });

  it("an unknown future version is incompatible", async () => {
    await seedRecord("manual:2", {
      schemaVersion: 5,
      slot: "manual:2",
      revision: 1,
      savedAt: 1,
      state: storyState(),
    });
    expect(await repository().read("manual:2")).toEqual({
      kind: "incompatible",
      slot: "manual:2",
      found: 5,
    });
  });

  it("increments the revision and overwrites in place rather than appending", async () => {
    const saves = repository();
    const first = storyState({ narrativeIndex: 3 });
    const second = storyState({ narrativeIndex: 9 });
    expect(await saves.write("manual:1", first, null)).toEqual({
      kind: "written",
      revision: 1,
    });
    expect(await saves.write("manual:1", second, null)).toEqual({
      kind: "written",
      revision: 2,
    });
    const read = await saves.read("manual:1");
    expect(read).toMatchObject({
      kind: "ready",
      envelope: { revision: 2, state: { narrativeIndex: 9 } },
    });
    expect(await saves.list()).toHaveLength(1);
  });

  it("rejects a stale write and leaves the stored state untouched", async () => {
    const saves = repository();
    await saves.write("manual:1", storyState({ narrativeIndex: 3 }), null);
    await saves.write("manual:1", storyState({ narrativeIndex: 9 }), null);
    expect(
      await saves.write("manual:1", storyState({ narrativeIndex: 1 }), 1),
    ).toEqual({ kind: "stale", currentRevision: 2 });
    expect(await saves.read("manual:1")).toMatchObject({
      kind: "ready",
      envelope: { revision: 2, state: { narrativeIndex: 9 } },
    });
  });

  it("serializes concurrent writes to one slot so none is lost", async () => {
    const saves = repository();
    const results = await Promise.all(
      [1, 2, 3].map((index) =>
        saves.write("autosave", storyState({ narrativeIndex: index }), null),
      ),
    );
    expect(results.map((result) => result.kind)).toEqual([
      "written",
      "written",
      "written",
    ]);
    expect(
      results.map((result) =>
        result.kind === "written" ? result.revision : null,
      ),
    ).toEqual([1, 2, 3]);
    expect(await saves.read("autosave")).toMatchObject({
      kind: "ready",
      envelope: { revision: 3 },
    });
  });

  it("reports a record written by a newer build as incompatible", async () => {
    await seedRecord("manual:2", {
      schemaVersion: 9,
      slot: "manual:2",
      revision: 4,
      savedAt: 1,
      state: storyState(),
    });
    expect(await repository().read("manual:2")).toEqual({
      kind: "incompatible",
      slot: "manual:2",
      found: 9,
    });
  });

  it("reports an unreadable record as corrupt instead of throwing", async () => {
    const saves = repository();
    const valid = storyState();
    const records: readonly unknown[] = [
      "not an object",
      42,
      [],
      {},
      { schemaVersion: 1 },
      {
        schemaVersion: "1",
        slot: "manual:1",
        revision: 1,
        savedAt: 1,
        state: valid,
      },
      /* Right shape, wrong slot: a record keyed under one slot that claims
         another would let a manual save masquerade as the duel checkpoint. */
      {
        schemaVersion: 1,
        slot: "autosave",
        revision: 1,
        savedAt: 1,
        state: valid,
      },
      {
        schemaVersion: 1,
        slot: "manual:1",
        revision: 0,
        savedAt: 1,
        state: valid,
      },
      {
        schemaVersion: 1,
        slot: "manual:1",
        revision: 1,
        savedAt: -1,
        state: valid,
      },
      {
        schemaVersion: 1,
        slot: "manual:1",
        revision: 1,
        savedAt: 1,
        state: valid,
        extra: true,
      },
      {
        schemaVersion: 1,
        slot: "manual:1",
        revision: 1,
        savedAt: 1,
        state: null,
      },
    ];
    for (const record of records) {
      await seedRecord("manual:1", record);
      const result = await saves.read("manual:1");
      expect(result.kind, JSON.stringify(record)).toBe("corrupt");
    }
  });

  it("reports a save whose story state is invalid as corrupt", async () => {
    const saves = repository();
    const valid = createInitialStoryState();
    const invalidStates: readonly unknown[] = [
      { ...valid, screen: "unsafe" },
      { ...valid, savedScreen: [] },
      { ...valid, narrativeIndex: -1 },
      { ...valid, narrativeIndex: PROLOGUE.beats.length },
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
    ];
    for (const state of invalidStates) {
      await seedRecord("manual:1", {
        schemaVersion: 1,
        slot: "manual:1",
        revision: 1,
        savedAt: 1,
        state,
      });
      expect((await saves.read("manual:1")).kind, JSON.stringify(state)).toBe(
        "corrupt",
      );
    }
  });

  /* The collection is keyed by card code and the boosters by set id. A record
     whose keys are neither — tampered with, or written by a build that never
     existed — parses as a state the screens then render `Number("a")` from,
     which duplicates keys and takes the shop down mid-visit. It has to read
     as corrupt at the door instead. */
  it("reports an inventory with unusable keys as corrupt", async () => {
    const saves = repository();
    const valid = createInitialStoryState();
    const invalidStates: readonly unknown[] = [
      { ...valid, collection: { a: 1 } },
      { ...valid, collection: { "01": 1 } },
      { ...valid, collection: { "1.5": 1 } },
      { ...valid, collection: { "-2": 1 } },
      { ...valid, boosters: { "": 2 } },
    ];
    for (const state of invalidStates) {
      await seedRecord("manual:1", {
        schemaVersion: 2,
        slot: "manual:1",
        revision: 1,
        savedAt: 1,
        state,
      });
      expect((await saves.read("manual:1")).kind, JSON.stringify(state)).toBe(
        "corrupt",
      );
    }
  });

  it("keeps a canonical inventory readable", async () => {
    const saves = repository();
    await seedRecord("manual:1", {
      schemaVersion: 2,
      slot: "manual:1",
      revision: 1,
      savedAt: 1,
      state: {
        ...createInitialStoryState(),
        collection: { 89631139: 2 },
        boosters: { "metal-raiders": 1 },
      },
    });
    expect((await saves.read("manual:1")).kind).toBe("ready");
  });

  it("keeps a corrupt record out of the slot listing without failing the list", async () => {
    const saves = repository();
    await saves.write("autosave", storyState(), null);
    await seedRecord("manual:1", { schemaVersion: 1, broken: true });
    expect((await saves.list()).map(({ slot }) => slot)).toEqual(["autosave"]);
  });

  it("types a quota failure and leaves the previous save readable", async () => {
    const saves = repository();
    await saves.write("manual:1", storyState({ narrativeIndex: 3 }), null);
    IDBObjectStore.prototype.put = () => {
      throw new DOMException("no room left", "QuotaExceededError");
    };
    expect(
      await saves.write("manual:1", storyState({ narrativeIndex: 9 }), null),
    ).toEqual({ kind: "failed", reason: "quota" });
    IDBObjectStore.prototype.put = originalPut;
    expect(await saves.read("manual:1")).toMatchObject({
      kind: "ready",
      envelope: { revision: 1, state: { narrativeIndex: 3 } },
    });
  });

  /* A write that fails part-way, rather than one that is refused up front: the
     record is accepted and the transaction then aborts underneath it. The
     repository has to answer, not hang waiting for an abort it already
     missed, and the previous save has to survive. */
  it("answers a write that aborts mid-transaction and keeps the previous save", async () => {
    const saves = repository();
    await saves.write("manual:1", storyState({ narrativeIndex: 3 }), null);
    IDBObjectStore.prototype.put = function (
      this: IDBObjectStore,
      ...args: Parameters<typeof originalPut>
    ) {
      const pending = originalPut.apply(this, args);
      queueMicrotask(() => {
        this.transaction.abort();
      });
      return pending;
    };
    expect(
      await saves.write("manual:1", storyState({ narrativeIndex: 9 }), null),
    ).toMatchObject({ kind: "failed" });
    IDBObjectStore.prototype.put = originalPut;
    expect(await saves.read("manual:1")).toMatchObject({
      kind: "ready",
      envelope: { revision: 1, state: { narrativeIndex: 3 } },
    });
    /* And the slot is still writable afterwards: a failed write must not wedge
       the per-slot queue behind an abort nobody awaited. */
    expect(
      await saves.write("manual:1", storyState({ narrativeIndex: 9 }), null),
    ).toEqual({ kind: "written", revision: 2 });
  });

  it("types an unusable IndexedDB as unavailable and never throws on read", async () => {
    const broken = {
      open: () => {
        throw new DOMException("storage is blocked", "SecurityError");
      },
    } as unknown as IDBFactory;
    const saves = createStorySaveRepository(broken);
    expect(await saves.write("manual:1", storyState(), null)).toEqual({
      kind: "failed",
      reason: "unavailable",
    });
    expect(await saves.read("manual:1")).toMatchObject({
      kind: "corrupt",
      slot: "manual:1",
    });
    expect(await saves.list()).toEqual([]);
  });

  it("lists the readable slots newest first with a chapter label", async () => {
    let clock = 1_700_000_000_000;
    const saves = repository(() => (clock += 1_000));
    await saves.write(
      "manual:1",
      storyState({ savedScreen: "narrative" }),
      null,
    );
    await saves.write("manual:3", storyState({ savedScreen: "map" }), null);
    await saves.write("autosave", storyState({ savedScreen: "reward" }), null);
    expect(await saves.list()).toEqual([
      {
        slot: "autosave",
        revision: 1,
        savedAt: 1_700_000_003_000,
        chapterLabel: `${PROLOGUE.title} · Reward`,
      },
      {
        slot: "manual:3",
        revision: 1,
        savedAt: 1_700_000_002_000,
        chapterLabel: `${PROLOGUE.title} · City map`,
      },
      {
        slot: "manual:1",
        revision: 1,
        savedAt: 1_700_000_001_000,
        chapterLabel: `${PROLOGUE.title} · Prologue`,
      },
    ]);
  });

  it("clears one slot and leaves the others intact", async () => {
    const saves = repository();
    for (const slot of ["manual:1", "manual:2", "manual:3"] as const)
      await saves.write(slot, storyState(), null);
    await saves.clear("manual:2");
    expect(await saves.read("manual:2")).toEqual({
      kind: "empty",
      slot: "manual:2",
    });
    expect(await saves.read("manual:1")).toMatchObject({ kind: "ready" });
    expect(await saves.read("manual:3")).toMatchObject({ kind: "ready" });
    /* A cleared slot starts its revision count over, so a checkpoint written
       after a reset is never mistaken for a stale one. */
    expect(await saves.write("manual:2", storyState(), null)).toEqual({
      kind: "written",
      revision: 1,
    });
  });

  it("clears a slot that was never written", async () => {
    const saves = repository();
    await expect(saves.clear("checkpoint:pre-duel")).resolves.toBeUndefined();
  });

  it("keeps the duel checkpoint isolated from the autosave stream", async () => {
    const saves = repository();
    await saves.write("autosave", storyState(), null);
    expect(await saves.read("checkpoint:pre-duel")).toEqual({
      kind: "empty",
      slot: "checkpoint:pre-duel",
    });
    const checkpoint = storyState({ screen: "battle-mock" });
    expect(await saves.write("checkpoint:pre-duel", checkpoint, null)).toEqual({
      kind: "written",
      revision: 1,
    });
    expect(await saves.read("autosave")).toMatchObject({
      kind: "ready",
      envelope: { state: { screen: "map" } },
    });
    expect(await saves.read("checkpoint:pre-duel")).toMatchObject({
      kind: "ready",
      envelope: { state: { screen: "battle-mock" } },
    });
  });

  it("survives a repository built for a slot key it does not own", async () => {
    const saves = repository();
    const forged = "manual:4" as StorySlotKey;
    expect(await saves.read(forged)).toEqual({ kind: "empty", slot: forged });
    expect(await saves.write(forged, storyState(), null)).toEqual({
      kind: "failed",
      reason: "unknown",
    });
    expect(await saves.list()).toEqual([]);
  });
});
