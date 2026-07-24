import type {
  DeckHistory,
  DeckId,
  DeckRecord,
  StoredDeck,
} from "./deck-contracts.ts";

export interface DeckRepository {
  list(): Promise<readonly DeckRecord[]>;
  load(id: DeckId): Promise<StoredDeck | null>;
  create(deck: DeckRecord, history: DeckHistory): Promise<StoredDeck>;
  createAndOpen(deck: DeckRecord, history: DeckHistory): Promise<StoredDeck>;
  save(
    expectedRevision: number,
    deck: DeckRecord,
    history: DeckHistory,
  ): Promise<StoredDeck>;
  delete(id: DeckId, expectedRevision: number): Promise<void>;
  getLastOpened(): Promise<DeckId | null>;
  setLastOpened(id: DeckId): Promise<void>;
  clearLastOpened(expectedId?: DeckId): Promise<void>;
}
