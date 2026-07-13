export interface CachedSnapshotFallback {
  readonly snapshotId: string;
  readonly runtimeManifestSha256: string;
  readonly activeImageManifestSha256: string;
}

interface PersistedPointer {
  readonly name?: unknown;
  readonly snapshotId?: unknown;
  readonly generation?: unknown;
}

interface PersistedReceipt {
  readonly id?: unknown;
  readonly sha256?: unknown;
}

interface PersistedSnapshot {
  readonly snapshotId?: unknown;
  readonly status?: unknown;
  readonly revisions?: {
    readonly runtimeSnapshotId?: unknown;
    readonly runtimeManifestSha256?: unknown;
  };
  readonly requiredArtifacts?: unknown;
  readonly verifiedArtifacts?: unknown;
}

export async function readCachedSnapshotFallbacks(
  currentSnapshotId: string,
  databaseName = "ygo-story-duel",
  timeoutMs = 2_000,
): Promise<readonly CachedSnapshotFallback[]> {
  if (
    globalThis.indexedDB === undefined ||
    typeof globalThis.indexedDB.databases !== "function"
  )
    return [];
  const databases = await globalThis.indexedDB.databases();
  if (!databases.some(({ name }) => name === databaseName)) return [];
  const request = globalThis.indexedDB.open(databaseName);
  const database = await new Promise<IDBDatabase>((resolve, reject) => {
    const timeout = setTimeout(
      () => reject(new Error("Snapshot pointer lookup timed out")),
      timeoutMs,
    );
    request.onerror = () => {
      clearTimeout(timeout);
      reject(request.error ?? new Error("Snapshot pointer database failed"));
    };
    request.onblocked = () => {
      clearTimeout(timeout);
      reject(new Error("Snapshot pointer database is blocked"));
    };
    request.onsuccess = () => {
      clearTimeout(timeout);
      resolve(request.result);
    };
  });
  try {
    if (
      !database.objectStoreNames.contains("pointers") ||
      !database.objectStoreNames.contains("snapshots")
    )
      return [];
    const transaction = database.transaction(
      ["pointers", "snapshots"],
      "readonly",
    );
    const completed = transactionDone(transaction);
    const pointerStore = transaction.objectStore("pointers");
    const snapshotStore = transaction.objectStore("snapshots");
    const [activePointer, previousPointer, snapshots] = await Promise.all([
      idbRequest<PersistedPointer | undefined>(pointerStore.get("active")),
      idbRequest<PersistedPointer | undefined>(pointerStore.get("previous")),
      idbRequest<PersistedSnapshot[]>(snapshotStore.getAll()),
    ]);
    await completed;
    if (
      activePointer !== undefined &&
      previousPointer !== undefined &&
      activePointer.generation !== previousPointer.generation
    )
      return [];
    const byId = new Map(
      snapshots
        .filter(
          (snapshot): snapshot is PersistedSnapshot & { snapshotId: string } =>
            typeof snapshot.snapshotId === "string",
        )
        .map((snapshot) => [snapshot.snapshotId, snapshot]),
    );
    const candidates: CachedSnapshotFallback[] = [];
    for (const pointer of [activePointer, previousPointer]) {
      const candidate = validateCandidate(pointer, byId, currentSnapshotId);
      if (
        candidate !== null &&
        !candidates.some(
          ({ snapshotId }) => snapshotId === candidate.snapshotId,
        )
      )
        candidates.push(candidate);
    }
    return Object.freeze(candidates);
  } finally {
    database.close();
  }
}

function validateCandidate(
  pointer: PersistedPointer | undefined,
  snapshots: ReadonlyMap<string, PersistedSnapshot>,
  currentSnapshotId: string,
): CachedSnapshotFallback | null {
  if (
    pointer === undefined ||
    (pointer.name !== "active" && pointer.name !== "previous") ||
    typeof pointer.generation !== "number" ||
    !Number.isSafeInteger(pointer.generation) ||
    pointer.generation < 0 ||
    typeof pointer.snapshotId !== "string" ||
    !/^[a-f0-9]{64}$/.test(pointer.snapshotId)
  )
    return null;
  const snapshot = snapshots.get(pointer.snapshotId);
  if (
    snapshot === undefined ||
    snapshot.snapshotId !== pointer.snapshotId ||
    snapshot.status !== pointer.name
  )
    return null;
  const required = parseReceipts(snapshot.requiredArtifacts);
  const verified = parseReceipts(snapshot.verifiedArtifacts);
  if (
    required === null ||
    verified === null ||
    receiptKey(required) !== receiptKey(verified)
  )
    return null;
  const runtimeSnapshotId = snapshot.revisions?.runtimeSnapshotId;
  if (
    typeof runtimeSnapshotId !== "string" ||
    runtimeSnapshotId === currentSnapshotId ||
    !/^[a-f0-9]{64}$/.test(runtimeSnapshotId)
  )
    return null;
  const runtimeReceipt = verified.find(({ id }) => id === "runtime-package");
  const imageReceipt = verified.find(({ id }) => id === "active-images");
  const runtimeRevision = snapshot.revisions?.runtimeManifestSha256;
  if (
    runtimeReceipt === undefined ||
    imageReceipt === undefined ||
    runtimeRevision !== runtimeReceipt.sha256
  )
    return null;
  return {
    snapshotId: runtimeSnapshotId,
    runtimeManifestSha256: runtimeReceipt.sha256,
    activeImageManifestSha256: imageReceipt.sha256,
  };
}

function parseReceipts(
  value: unknown,
): readonly { id: string; sha256: string }[] | null {
  if (!Array.isArray(value) || Object.keys(value).length !== value.length)
    return null;
  const receipts: Array<{ id: string; sha256: string }> = [];
  for (const receipt of value) {
    if (
      typeof receipt !== "object" ||
      receipt === null ||
      Array.isArray(receipt) ||
      Object.keys(receipt).sort().join("\n") !== "id\nsha256"
    )
      return null;
    const { id, sha256 } = receipt as PersistedReceipt;
    if (
      typeof id !== "string" ||
      id.length === 0 ||
      id.length > 512 ||
      typeof sha256 !== "string" ||
      !/^[a-f0-9]{64}$/.test(sha256)
    )
      return null;
    receipts.push({ id, sha256 });
  }
  if (new Set(receipts.map(({ id }) => id)).size !== receipts.length)
    return null;
  return receipts.sort((left, right) => left.id.localeCompare(right.id));
}

function receiptKey(
  receipts: readonly { id: string; sha256: string }[],
): string {
  return receipts.map(({ id, sha256 }) => `${id}:${sha256}`).join("\n");
}

function idbRequest<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () =>
      reject(request.error ?? new Error("IndexedDB request failed"));
  });
}

function transactionDone(transaction: IDBTransaction): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onabort = () =>
      reject(transaction.error ?? new Error("IndexedDB transaction aborted"));
    transaction.onerror = () =>
      reject(transaction.error ?? new Error("IndexedDB transaction failed"));
  });
}
