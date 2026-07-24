// @vitest-environment node

import "fake-indexeddb/auto";
import { afterEach, describe, expect, it } from "vitest";
import { deleteDB } from "idb";
import { deckId } from "../../../src/decks/deck-contracts.ts";
import {
  emptyDeckHistory,
  pushDeckUpdate,
} from "../../../src/decks/deck-history.ts";
import { createBlankDeck } from "../../../src/decks/deck-model.ts";
import { validateDeckDraft } from "../../../src/decks/deck-validation.ts";
import {
  DeckRevisionConflictError,
  DeckStorageError,
  IndexedDbDeckRepository,
  PROTOTYPE_DECK_DATABASE_NAME,
} from "../../../src/decks/indexeddb-deck-repository.ts";
import {
  catalogByCode,
  PROTOTYPE_RULESET,
} from "../../../src/decks/catalog/pinned-ruleset.ts";
import { PROTOTYPE_CATALOG } from "../../../src/prototypes/deck-builder/fixtures/catalog.ts";

const names: string[] = [];
const catalog = catalogByCode(PROTOTYPE_CATALOG);

afterEach(async () => {
  await Promise.all(names.splice(0).map((name) => deleteDB(name)));
});

async function repository(name: string): Promise<IndexedDbDeckRepository> {
  names.push(name);
  return IndexedDbDeckRepository.open(
    name,
    () => new Date("2026-01-01T00:00:00.000Z"),
  );
}

describe("IndexedDbDeckRepository", () => {
  it("uses an isolated prototype database name", () => {
    expect(PROTOTYPE_DECK_DATABASE_NAME).not.toBe("ygo-story-duel");
  });

  it("atomically creates, saves, lists, reloads, and deletes deck plus history", async () => {
    const repo = await repository("deck-repo-lifecycle");
    const draft = createBlankDeck("Control", catalog, PROTOTYPE_RULESET, {
      id: "control",
      now: new Date("2026-01-01T00:00:00.000Z"),
    });
    const created = await repo.createAndOpen(draft, emptyDeckHistory());
    expect(created.deck.revision).toBe(1);
    expect(await repo.getLastOpened()).toBe(created.deck.id);
    await repo.clearLastOpened(deckId("another-deck"));
    expect(await repo.getLastOpened()).toBe(created.deck.id);

    const history = pushDeckUpdate(created.history, {
      id: "add-one",
      deckId: created.deck.id,
      before: created.deck,
      after: { main: [89631139], extra: [], side: [] },
      reason: "add",
    });
    const saved = await repo.save(
      1,
      { ...created.deck, main: [89631139] },
      history,
    );
    expect(saved.deck.revision).toBe(2);
    expect((await repo.load(created.deck.id))?.history.undo).toHaveLength(1);
    expect(await repo.list()).toHaveLength(1);

    await repo.delete(created.deck.id, 2);
    expect(await repo.load(created.deck.id)).toBeNull();
    expect(await repo.getLastOpened()).toBeNull();
    repo.close();
  });

  it("rejects stale revisions without overwriting committed state", async () => {
    const repo = await repository("deck-repo-conflict");
    const draft = createBlankDeck("Conflict", catalog, PROTOTYPE_RULESET, {
      id: "conflict",
    });
    const created = await repo.create(draft, emptyDeckHistory());
    await repo.save(1, { ...created.deck, name: "Newer" }, created.history);
    await expect(
      repo.save(1, { ...created.deck, name: "Stale" }, created.history),
    ).rejects.toBeInstanceOf(DeckRevisionConflictError);
    expect((await repo.load(deckId("conflict")))?.deck.name).toBe("Newer");
    repo.close();
  });

  it("rejects stale deletes while keeping deck and history intact", async () => {
    const repo = await repository("deck-repo-stale-delete");
    const draft = createBlankDeck(
      "Delete conflict",
      catalog,
      PROTOTYPE_RULESET,
      {
        id: "delete-conflict",
        now: new Date("2026-01-01T00:00:00.000Z"),
      },
    );
    const created = await repo.create(draft, emptyDeckHistory());
    const saved = await repo.save(
      1,
      { ...created.deck, name: "Revision two" },
      created.history,
    );
    await expect(repo.delete(saved.deck.id, 1)).rejects.toBeInstanceOf(
      DeckRevisionConflictError,
    );
    expect((await repo.load(saved.deck.id))?.deck.name).toBe("Revision two");
    await repo.delete(saved.deck.id, 2);
    await expect(repo.delete(saved.deck.id, 2)).resolves.toBeUndefined();
    repo.close();
  });

  it("rejects malformed persisted rows before exposing them", async () => {
    const name = "deck-repo-malformed";
    names.push(name);
    const repo = await IndexedDbDeckRepository.open(name);
    repo.close();
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(name, 1);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const transaction = database.transaction(
      ["decks", "histories"],
      "readwrite",
    );
    transaction.objectStore("decks").put({
      schemaVersion: 1,
      id: "malformed",
      revision: 1,
      name: "Malformed",
      main: [89631139],
      extra: [],
      side: [],
    });
    transaction.objectStore("histories").put({
      deckId: "malformed",
      history: emptyDeckHistory(),
    });
    await new Promise<void>((resolve, reject) => {
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
    });
    database.close();
    const reopened = await IndexedDbDeckRepository.open(name);
    expect(await reopened.list()).toEqual([]);
    await expect(reopened.load(deckId("malformed"))).rejects.toBeInstanceOf(
      DeckStorageError,
    );
    reopened.close();
  });

  it("restores invalid drafts and bounded history after reopening", async () => {
    const name = "deck-repo-reload";
    const first = await repository(name);
    const draft = createBlankDeck("Invalid draft", catalog, PROTOTYPE_RULESET, {
      id: "invalid",
    });
    let history = emptyDeckHistory();
    for (let index = 0; index < 51; index += 1)
      history = pushDeckUpdate(history, {
        id: `u-${index}`,
        deckId: draft.id,
        before: { main: [index + 1], extra: [], side: [] },
        after: { main: [index + 2], extra: [], side: [] },
        reason: "add",
      });
    const persisted = {
      ...draft,
      main: [52],
      validation: validateDeckDraft(
        { main: [52], extra: [], side: [] },
        catalog,
        PROTOTYPE_RULESET,
      ),
    };
    await first.create(persisted, history);
    first.close();

    const second = await IndexedDbDeckRepository.open(name);
    const loaded = await second.load(draft.id);
    expect(loaded?.deck.validation.status).toBe("errors");
    expect(loaded?.history.undo).toHaveLength(50);
    second.close();
  });
});
