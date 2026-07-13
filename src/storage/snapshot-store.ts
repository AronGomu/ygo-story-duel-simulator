import { openDB, type DBSchema, type IDBPDatabase } from "idb";
import type { SnapshotId } from "../duel/contracts/ids.ts";

const DATABASE_VERSION = 2;
const DEFAULT_DATABASE_NAME = "ygo-story-duel";
const MAXIMUM_DEBUG_RUNS = 20;

export type SnapshotStatus = "staged" | "active" | "previous";

export interface SnapshotRevisionSet {
  readonly runtimeSnapshotId: string;
  readonly runtimeManifestSha256: string;
  readonly assetManifestSha256: string;
  readonly engineManifestSha256: string;
  readonly babelCdb: string;
  readonly cardScripts: string;
  readonly distribution: string;
  readonly imageProvider: string;
}

export interface SnapshotArtifactReceipt {
  readonly id: string;
  readonly sha256: string;
}

export interface StagedSnapshotInput {
  readonly snapshotId: SnapshotId;
  readonly revisions: SnapshotRevisionSet;
  readonly requiredArtifacts: readonly SnapshotArtifactReceipt[];
}

export interface StoredSnapshot {
  readonly snapshotId: SnapshotId;
  readonly status: SnapshotStatus;
  readonly revisions: SnapshotRevisionSet;
  readonly requiredArtifacts: readonly SnapshotArtifactReceipt[];
  readonly verifiedArtifacts: readonly SnapshotArtifactReceipt[];
  readonly stagedAt: string;
  readonly verifiedAt?: string;
  readonly activatedAt?: string;
}

export interface SnapshotPointer {
  readonly name: "active" | "previous";
  readonly snapshotId: SnapshotId;
  readonly generation: number;
}

export interface DebugRunMetadata {
  readonly id: string;
  readonly snapshotId: SnapshotId;
  readonly createdAt: string;
  readonly resultType: string;
  readonly traceEntries: number;
}

export interface SnapshotStorageStatus {
  readonly activeSnapshotId: SnapshotId | null;
  readonly fallbackSnapshotId: SnapshotId | null;
  readonly generation: number;
}

interface SnapshotDatabase extends DBSchema {
  snapshots: {
    key: string;
    value: StoredSnapshot;
    indexes: { status: SnapshotStatus; stagedAt: string };
  };
  pointers: {
    key: SnapshotPointer["name"];
    value: SnapshotPointer;
  };
  preferences: {
    key: string;
    value: { readonly key: string; readonly value: string | number | boolean };
  };
  debugRuns: {
    key: string;
    value: DebugRunMetadata;
    indexes: { createdAt: string };
  };
}

export class SnapshotStorageError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "SnapshotStorageError";
  }
}

export class SnapshotStore {
  readonly #database: IDBPDatabase<SnapshotDatabase>;
  readonly #now: () => Date;

  private constructor(
    database: IDBPDatabase<SnapshotDatabase>,
    now: () => Date,
  ) {
    this.#database = database;
    this.#now = now;
  }

  static async open(
    databaseName = DEFAULT_DATABASE_NAME,
    now: () => Date = () => new Date(),
  ): Promise<SnapshotStore> {
    const database = await openDB<SnapshotDatabase>(
      databaseName,
      DATABASE_VERSION,
      {
        async upgrade(db, oldVersion, _newVersion, transaction) {
          if (oldVersion < 1) {
            const snapshots = db.createObjectStore("snapshots", {
              keyPath: "snapshotId",
            });
            snapshots.createIndex("status", "status");
            snapshots.createIndex("stagedAt", "stagedAt");
            db.createObjectStore("pointers", { keyPath: "name" });
            db.createObjectStore("preferences", { keyPath: "key" });
            const debugRuns = db.createObjectStore("debugRuns", {
              keyPath: "id",
            });
            debugRuns.createIndex("createdAt", "createdAt");
            return;
          }
          if (oldVersion < 2) {
            const snapshots = transaction.objectStore("snapshots");
            let cursor = await snapshots.openCursor();
            while (cursor !== null) {
              const value = cursor.value as StoredSnapshot & {
                readonly revisions: Omit<
                  SnapshotRevisionSet,
                  "runtimeSnapshotId"
                > & { readonly runtimeSnapshotId?: string };
              };
              if (value.revisions.runtimeSnapshotId === undefined)
                await cursor.update({
                  ...value,
                  revisions: {
                    ...value.revisions,
                    runtimeSnapshotId: value.snapshotId,
                  },
                });
              cursor = await cursor.continue();
            }
          }
        },
      },
    );
    return new SnapshotStore(database, now);
  }

  async stageSnapshot(input: StagedSnapshotInput): Promise<StoredSnapshot> {
    validateSnapshotInput(input);
    const transaction = (() => {
      try {
        return this.#database.transaction("snapshots", "readwrite");
      } catch (error) {
        throw storageError("Unable to stage the asset snapshot", error);
      }
    })();
    try {
      const existing = await transaction.store.get(input.snapshotId);
      if (existing !== undefined) {
        if (!sameSnapshotDefinition(existing, input))
          throw new SnapshotStorageError(
            `Snapshot ${input.snapshotId} conflicts with an existing revision set`,
          );
        await transaction.done;
        return existing;
      }
      const record: StoredSnapshot = Object.freeze({
        snapshotId: input.snapshotId,
        status: "staged",
        revisions: Object.freeze({ ...input.revisions }),
        requiredArtifacts: Object.freeze(
          normalizeArtifactReceipts(input.requiredArtifacts),
        ),
        verifiedArtifacts: Object.freeze([]),
        stagedAt: this.#now().toISOString(),
      });
      await transaction.store.add(record);
      await transaction.done;
      return record;
    } catch (error) {
      await transaction.done.catch(() => undefined);
      throw storageError("Unable to stage the asset snapshot", error);
    }
  }

  async verifyStagedSnapshot(
    snapshotId: SnapshotId,
    receipts: readonly SnapshotArtifactReceipt[],
  ): Promise<StoredSnapshot> {
    const transaction = this.#database.transaction("snapshots", "readwrite");
    try {
      const snapshot = await transaction.store.get(snapshotId);
      if (snapshot === undefined)
        throw new SnapshotStorageError(`Snapshot ${snapshotId} is not staged`);
      const verified = normalizeArtifactReceipts(receipts);
      if (
        artifactReceiptKey(verified) !==
        artifactReceiptKey(snapshot.requiredArtifacts)
      )
        throw new SnapshotStorageError(
          `Snapshot ${snapshotId} does not have complete artifact verification`,
        );
      const next: StoredSnapshot = Object.freeze({
        ...snapshot,
        verifiedArtifacts: Object.freeze(verified),
        verifiedAt: this.#now().toISOString(),
      });
      await transaction.store.put(next);
      await transaction.done;
      return next;
    } catch (error) {
      await transaction.done.catch(() => undefined);
      throw storageError("Unable to verify the staged snapshot", error);
    }
  }

  async activateSnapshot(
    snapshotId: SnapshotId,
    expectedActiveSnapshotId: SnapshotId | null,
    expectedGeneration: number,
  ): Promise<SnapshotStorageStatus> {
    const transaction = this.#database.transaction(
      ["snapshots", "pointers"],
      "readwrite",
    );
    try {
      const snapshots = transaction.objectStore("snapshots");
      const pointers = transaction.objectStore("pointers");
      const candidate = await snapshots.get(snapshotId);
      if (
        candidate === undefined ||
        artifactReceiptKey(candidate.verifiedArtifacts) !==
          artifactReceiptKey(candidate.requiredArtifacts)
      )
        throw new SnapshotStorageError(
          `Snapshot ${snapshotId} cannot activate before complete verification`,
        );
      const activePointer = await pointers.get("active");
      const previousPointer = await pointers.get("previous");
      const [activeSnapshot, previousSnapshot] = await Promise.all([
        activePointer === undefined
          ? undefined
          : snapshots.get(activePointer.snapshotId),
        previousPointer === undefined
          ? undefined
          : snapshots.get(previousPointer.snapshotId),
      ]);
      if (
        (activePointer === undefined && previousPointer !== undefined) ||
        (activePointer !== undefined &&
          !validPointerTarget(activePointer, activeSnapshot, "active")) ||
        (previousPointer !== undefined &&
          (activePointer === undefined ||
            previousPointer.generation !== activePointer.generation ||
            !validPointerTarget(previousPointer, previousSnapshot, "previous")))
      )
        throw new SnapshotStorageError(
          "Snapshot pointers reference invalid persisted state",
        );
      const actualActive = activePointer?.snapshotId ?? null;
      const expectedCandidateStatus =
        actualActive === snapshotId ? "active" : "staged";
      if (!isVerifiedStoredSnapshot(candidate, expectedCandidateStatus))
        throw new SnapshotStorageError(
          `Snapshot ${snapshotId} cannot activate before complete verification`,
        );
      if (
        actualActive !== expectedActiveSnapshotId ||
        (activePointer?.generation ?? 0) !== expectedGeneration
      )
        throw new SnapshotStorageError(
          "Snapshot activation was superseded by another browser context",
        );
      if (actualActive === snapshotId) {
        await transaction.done;
        return {
          activeSnapshotId: snapshotId,
          fallbackSnapshotId: previousPointer?.snapshotId ?? null,
          generation: activePointer?.generation ?? 0,
        };
      }

      const generation = (activePointer?.generation ?? 0) + 1;
      if (activePointer !== undefined && activeSnapshot !== undefined) {
        await snapshots.put({ ...activeSnapshot, status: "previous" });
        await pointers.put({
          name: "previous",
          snapshotId: activePointer.snapshotId,
          generation,
        });
      }
      await snapshots.put({
        ...candidate,
        status: "active",
        activatedAt: this.#now().toISOString(),
      });
      await pointers.put({ name: "active", snapshotId, generation });
      if (
        previousPointer !== undefined &&
        previousPointer.snapshotId !== activePointer?.snapshotId &&
        previousPointer.snapshotId !== snapshotId
      )
        await snapshots.delete(previousPointer.snapshotId);
      await transaction.done;
      return {
        activeSnapshotId: snapshotId,
        fallbackSnapshotId: activePointer?.snapshotId ?? null,
        generation,
      };
    } catch (error) {
      await transaction.done.catch(() => undefined);
      throw storageError("Unable to activate the verified snapshot", error);
    }
  }

  async rollback(
    expectedActiveSnapshotId: SnapshotId,
    expectedGeneration: number,
  ): Promise<SnapshotStorageStatus> {
    const transaction = this.#database.transaction(
      ["snapshots", "pointers"],
      "readwrite",
    );
    try {
      const snapshots = transaction.objectStore("snapshots");
      const pointers = transaction.objectStore("pointers");
      const [activePointer, previousPointer] = await Promise.all([
        pointers.get("active"),
        pointers.get("previous"),
      ]);
      if (
        activePointer?.snapshotId !== expectedActiveSnapshotId ||
        activePointer.generation !== expectedGeneration
      )
        throw new SnapshotStorageError(
          "Snapshot rollback was superseded by another browser context",
        );
      if (previousPointer === undefined)
        throw new SnapshotStorageError("No previous snapshot is available");
      const [previous, active] = await Promise.all([
        snapshots.get(previousPointer.snapshotId),
        snapshots.get(activePointer.snapshotId),
      ]);
      if (
        previousPointer.generation !== activePointer.generation ||
        !validPointerTarget(activePointer, active, "active") ||
        !validPointerTarget(previousPointer, previous, "previous")
      )
        throw new SnapshotStorageError(
          "Snapshot rollback pointers reference invalid persisted state",
        );
      await snapshots.put({ ...active, status: "previous" });
      const generation = (activePointer.generation ?? 0) + 1;
      await pointers.put({
        name: "previous",
        snapshotId: activePointer.snapshotId,
        generation,
      });
      await snapshots.put({
        ...previous,
        status: "active",
        activatedAt: this.#now().toISOString(),
      });
      await pointers.put({
        name: "active",
        snapshotId: previous.snapshotId,
        generation,
      });
      await transaction.done;
      return {
        activeSnapshotId: previous.snapshotId,
        fallbackSnapshotId: activePointer.snapshotId,
        generation,
      };
    } catch (error) {
      await transaction.done.catch(() => undefined);
      throw storageError("Unable to roll back the asset snapshot", error);
    }
  }

  async discardStagedSnapshot(snapshotId: SnapshotId): Promise<boolean> {
    const transaction = this.#database.transaction(
      ["snapshots", "pointers"],
      "readwrite",
    );
    try {
      const snapshots = transaction.objectStore("snapshots");
      const pointers = transaction.objectStore("pointers");
      const [snapshot, active, previous] = await Promise.all([
        snapshots.get(snapshotId),
        pointers.get("active"),
        pointers.get("previous"),
      ]);
      if (
        snapshot === undefined ||
        snapshot.status !== "staged" ||
        active?.snapshotId === snapshotId ||
        previous?.snapshotId === snapshotId
      ) {
        await transaction.done;
        return false;
      }
      await snapshots.delete(snapshotId);
      await transaction.done;
      return true;
    } catch (error) {
      await transaction.done.catch(() => undefined);
      throw storageError("Unable to discard snapshot staging", error);
    }
  }

  async cleanupAbandonedStaging(before: Date): Promise<number> {
    const transaction = this.#database.transaction(
      ["snapshots", "pointers"],
      "readwrite",
    );
    let removed = 0;
    try {
      const snapshots = transaction.objectStore("snapshots");
      const pointers = transaction.objectStore("pointers");
      const [active, previous] = await Promise.all([
        pointers.get("active"),
        pointers.get("previous"),
      ]);
      const retained = new Set([active?.snapshotId, previous?.snapshotId]);
      let cursor = await snapshots.index("stagedAt").openCursor();
      while (cursor !== null) {
        if (
          cursor.value.status === "staged" &&
          !retained.has(cursor.value.snapshotId) &&
          Date.parse(cursor.value.stagedAt) < before.getTime()
        ) {
          await cursor.delete();
          removed += 1;
        }
        cursor = await cursor.continue();
      }
      await transaction.done;
      return removed;
    } catch (error) {
      await transaction.done.catch(() => undefined);
      throw storageError("Unable to clean abandoned snapshot staging", error);
    }
  }

  async verifiedArtifactDigestForRuntimeSnapshot(
    runtimeSnapshotId: SnapshotId,
    artifactId: string,
  ): Promise<string | null> {
    requireSafeKey(artifactId, "artifact");
    const snapshots = await this.#database.getAll("snapshots");
    const snapshot = ["active", "previous"]
      .flatMap((status) =>
        snapshots.filter((candidate) => candidate.status === status),
      )
      .find(
        (candidate) =>
          candidate.revisions.runtimeSnapshotId === runtimeSnapshotId &&
          artifactReceiptKey(candidate.requiredArtifacts) ===
            artifactReceiptKey(candidate.verifiedArtifacts),
      );
    return (
      snapshot?.verifiedArtifacts.find(({ id }) => id === artifactId)?.sha256 ??
      null
    );
  }

  async retainedRevisionCacheNames(): Promise<readonly string[]> {
    const transaction = this.#database.transaction(
      ["pointers", "snapshots"],
      "readonly",
    );
    const pointers = transaction.objectStore("pointers");
    const snapshots = transaction.objectStore("snapshots");
    const [active, previous, records] = await Promise.all([
      pointers.get("active"),
      pointers.get("previous"),
      snapshots.getAll(),
    ]);
    await transaction.done;
    const retainedKeys = new Set(
      [active?.snapshotId, previous?.snapshotId].filter(
        (value): value is SnapshotId => value !== undefined,
      ),
    );
    const names = records
      .filter(({ snapshotId }) => retainedKeys.has(snapshotId))
      .flatMap(({ revisions, verifiedArtifacts }) => {
        const imageDigest = verifiedArtifacts.find(
          ({ id }) => id === "active-images",
        )?.sha256;
        if (imageDigest === undefined) return [];
        return [
          `ygo-runtime-v1-${revisions.runtimeSnapshotId}-${revisions.runtimeManifestSha256}`,
          `ygo-card-images-v1-${revisions.runtimeSnapshotId}-${imageDigest}`,
        ];
      });
    return Object.freeze([...new Set(names)]);
  }

  async status(): Promise<SnapshotStorageStatus> {
    const transaction = this.#database.transaction(
      ["pointers", "snapshots"],
      "readonly",
    );
    const pointers = transaction.objectStore("pointers");
    const snapshots = transaction.objectStore("snapshots");
    const [active, previous, records] = await Promise.all([
      pointers.get("active"),
      pointers.get("previous"),
      snapshots.getAll(),
    ]);
    await transaction.done;
    const byId = new Map(records.map((record) => [record.snapshotId, record]));
    if (
      (active === undefined && previous !== undefined) ||
      (active !== undefined &&
        !validPointerTarget(active, byId.get(active.snapshotId), "active")) ||
      (previous !== undefined &&
        (active === undefined ||
          previous.generation !== active.generation ||
          !validPointerTarget(
            previous,
            byId.get(previous.snapshotId),
            "previous",
          )))
    )
      throw new SnapshotStorageError(
        "Snapshot pointers reference invalid persisted state",
      );
    return {
      activeSnapshotId: active?.snapshotId ?? null,
      fallbackSnapshotId: previous?.snapshotId ?? null,
      generation: active?.generation ?? 0,
    };
  }

  async setPreference(
    key: string,
    value: string | number | boolean,
  ): Promise<void> {
    requireSafeKey(key, "preference");
    await this.#database.put("preferences", { key, value });
  }

  async getPreference(
    key: string,
  ): Promise<string | number | boolean | undefined> {
    requireSafeKey(key, "preference");
    return (await this.#database.get("preferences", key))?.value;
  }

  async recordDebugRun(value: DebugRunMetadata): Promise<void> {
    requireSafeKey(value.id, "debug run");
    const transaction = this.#database.transaction("debugRuns", "readwrite");
    await transaction.store.put(Object.freeze({ ...value }));
    const runs = await transaction.store.index("createdAt").getAllKeys();
    const excess = runs.length - MAXIMUM_DEBUG_RUNS;
    if (excess > 0)
      await Promise.all(
        runs.slice(0, excess).map((id) => transaction.store.delete(id)),
      );
    await transaction.done;
  }

  close(): void {
    this.#database.close();
  }
}

function validPointerTarget(
  pointer: SnapshotPointer,
  snapshot: StoredSnapshot | undefined,
  expectedStatus: "active" | "previous",
): snapshot is StoredSnapshot {
  return (
    pointer.name === expectedStatus &&
    Number.isSafeInteger(pointer.generation) &&
    pointer.generation > 0 &&
    snapshot?.snapshotId === pointer.snapshotId &&
    isVerifiedStoredSnapshot(snapshot, expectedStatus)
  );
}

function isVerifiedStoredSnapshot(
  snapshot: StoredSnapshot,
  expectedStatus: SnapshotStatus,
): boolean {
  if (
    snapshot.status !== expectedStatus ||
    artifactReceiptKey(snapshot.requiredArtifacts) !==
      artifactReceiptKey(snapshot.verifiedArtifacts)
  )
    return false;
  try {
    validateSnapshotInput({
      snapshotId: snapshot.snapshotId,
      revisions: snapshot.revisions,
      requiredArtifacts: snapshot.requiredArtifacts,
    });
    return true;
  } catch {
    return false;
  }
}

function validateSnapshotInput(input: StagedSnapshotInput): void {
  const inputKeys = Object.keys(input).sort();
  if (
    inputKeys.join("\n") !==
    ["requiredArtifacts", "revisions", "snapshotId"].join("\n")
  )
    throw new SnapshotStorageError(
      "Snapshot staging input has unknown or missing fields",
    );
  if (!/^[a-f0-9]{64}$/.test(input.snapshotId))
    throw new SnapshotStorageError("Snapshot ID must be a SHA-256 digest");
  if (input.requiredArtifacts.length === 0)
    throw new SnapshotStorageError(
      "A snapshot must declare required artifacts",
    );
  const requiredArtifacts = normalizeArtifactReceipts(input.requiredArtifacts);
  const runtimeArtifact = requiredArtifacts.find(
    ({ id }) => id === "runtime-package",
  );
  if (runtimeArtifact === undefined)
    throw new SnapshotStorageError(
      "Snapshot must include a runtime-package receipt",
    );
  if (runtimeArtifact.sha256 !== input.revisions.runtimeManifestSha256)
    throw new SnapshotStorageError(
      "Runtime artifact receipt does not match snapshot revisions",
    );
  const imageArtifact = requiredArtifacts.find(
    ({ id }) => id === "active-images",
  );
  if (imageArtifact === undefined)
    throw new SnapshotStorageError(
      "Snapshot must include an active-images receipt",
    );
  if (!input.revisions.imageProvider.endsWith(`:${imageArtifact.sha256}`))
    throw new SnapshotStorageError(
      "Image artifact receipt does not match snapshot revisions",
    );
  const revisionKeys = [
    "assetManifestSha256",
    "babelCdb",
    "cardScripts",
    "distribution",
    "engineManifestSha256",
    "imageProvider",
    "runtimeManifestSha256",
    "runtimeSnapshotId",
  ];
  if (!/^[a-f0-9]{64}$/.test(input.revisions.runtimeSnapshotId))
    throw new SnapshotStorageError("Runtime snapshot ID is invalid");
  if (
    Object.keys(input.revisions).sort().join("\n") !== revisionKeys.join("\n")
  )
    throw new SnapshotStorageError(
      "Snapshot revisions have unknown or missing fields",
    );
  for (const [key, value] of Object.entries(input.revisions)) {
    if (typeof value !== "string" || value.length === 0 || value.length > 512)
      throw new SnapshotStorageError(`Snapshot revision ${key} is invalid`);
  }
}

function sameSnapshotDefinition(
  existing: StoredSnapshot,
  input: StagedSnapshotInput,
): boolean {
  return (
    JSON.stringify(existing.revisions) === JSON.stringify(input.revisions) &&
    artifactReceiptKey(existing.requiredArtifacts) ===
      artifactReceiptKey(normalizeArtifactReceipts(input.requiredArtifacts))
  );
}

function normalizeArtifactReceipts(
  values: readonly SnapshotArtifactReceipt[],
): SnapshotArtifactReceipt[] {
  const result = values
    .map((value) => {
      requireSafeKey(value.id, "artifact");
      if (!/^[a-f0-9]{64}$/.test(value.sha256))
        throw new SnapshotStorageError(
          `Artifact ${value.id} verification digest is invalid`,
        );
      return Object.freeze({ id: value.id, sha256: value.sha256 });
    })
    .sort((left, right) => left.id.localeCompare(right.id));
  if (new Set(result.map(({ id }) => id)).size !== result.length)
    throw new SnapshotStorageError("Snapshot artifact IDs must be unique");
  return result;
}

function artifactReceiptKey(
  values: readonly SnapshotArtifactReceipt[],
): string {
  return values.map(({ id, sha256 }) => `${id}:${sha256}`).join("\n");
}

function requireSafeKey(value: string, label: string): void {
  if (value.trim().length === 0 || value.length > 512 || value.includes("\0"))
    throw new SnapshotStorageError(`${label} key is invalid`);
}

function storageError(message: string, cause: unknown): SnapshotStorageError {
  return cause instanceof SnapshotStorageError
    ? cause
    : new SnapshotStorageError(message, { cause });
}
