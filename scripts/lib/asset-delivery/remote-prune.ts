import {
  canonicalBytes,
  compareCodePoints,
  parseJsonBytes,
} from "./canonical-json.ts";
import { fail } from "./failure.ts";
import type { ObjectRef } from "./object-ref.ts";
import { parsePruneJournal, type PruneJournal } from "./prune-journal.ts";
import { parsePrunePlan, type PrunePlan } from "./prune-plan.ts";
import {
  parsePublicationInventory,
  type PublicationInventory,
} from "./publication-inventory.ts";
import {
  RemotePreconditionError,
  type RemoteObjectStore,
} from "./remote-store.ts";
import {
  DAY_MS,
  JOURNAL_KEY,
  STATE_KEY,
  loadRelease,
  loadSnapshot,
  network,
  readState,
  rejectPendingJournal,
  sameBytes,
  sha256,
  withRemoteLock,
  type StateRecord,
} from "./remote-publication.ts";

interface Closure {
  readonly snapshot: ObjectRef;
  readonly objects: readonly ObjectRef[];
}
async function closure(
  store: RemoteObjectStore,
  snapshot: ObjectRef,
): Promise<Closure> {
  const parsed = await loadSnapshot(store, snapshot, true);
  return { snapshot, objects: [snapshot, ...parsed.objects] };
}
async function previewLocked(
  store: RemoteObjectStore,
  now: Date,
): Promise<{
  readonly plan: PrunePlan;
  readonly nextState: PublicationInventory;
  readonly state: StateRecord;
}> {
  await rejectPendingJournal(store);
  const state = await readState(store);
  const protectedKeys = new Set<string>();
  const candidates = new Map<string, ObjectRef>();
  const protect = async (snapshot: ObjectRef): Promise<void> => {
    for (const object of (await closure(store, snapshot)).objects)
      protectedKeys.add(object.key);
  };
  if (state.value.nightly) await protect(state.value.nightly);
  for (const release of state.value.releases) {
    const pointer = await loadRelease(store, release.version, release.pointer);
    if (!pointer) fail("ASSET_REFERENCE_MISSING", release.pointer.key);
    protectedKeys.add(release.pointer.key);
    await protect(pointer.pointer.snapshot);
  }
  const retained: PublicationInventory["retiredNightlies"][number][] = [];
  for (const entry of state.value.retiredNightlies) {
    if (now.getTime() - new Date(entry.retiredAt).getTime() < DAY_MS) {
      retained.push(entry);
      await protect(entry.snapshot);
    } else {
      for (const object of (await closure(store, entry.snapshot)).objects)
        candidates.set(object.key, object);
    }
  }
  for (const key of protectedKeys) candidates.delete(key);
  const plan = parsePrunePlan({
    schemaVersion: 1,
    scope: "remote",
    basisSha256: sha256(state.bytes),
    candidates: [...candidates.values()]
      .map((object) => ({
        path: object.key,
        bytes: object.bytes,
        sha256: object.sha256,
      }))
      .sort((a, b) => compareCodePoints(a.path, b.path)),
  });
  const nextState = parsePublicationInventory({
    ...state.value,
    retiredNightlies: retained,
  });
  return { plan, nextState, state };
}

export async function previewRemotePrune(
  store: RemoteObjectStore,
  now: Date,
): Promise<PrunePlan> {
  return withRemoteLock(
    store,
    now,
    async () => (await previewLocked(store, now)).plan,
  );
}

async function putJournal(
  store: RemoteObjectStore,
  journal: PruneJournal,
  etag?: string,
): Promise<string> {
  try {
    const result = await network(
      () =>
        store.putBytes(JOURNAL_KEY, canonicalBytes(journal), {
          ...(etag === undefined
            ? { ifNoneMatch: true as const }
            : { ifMatch: etag }),
          cacheControl: "no-store",
          contentType: "application/json",
        }),
      JOURNAL_KEY,
    );
    return result.etag;
  } catch (error) {
    if (error instanceof RemotePreconditionError)
      fail("ASSET_RECOVERY_REQUIRED", JOURNAL_KEY);
    throw error;
  }
}
async function continuePrune(
  store: RemoteObjectStore,
  journal: PruneJournal,
  journalEtag: string,
  state: StateRecord,
): Promise<void> {
  let current = journal;
  let etag = journalEtag;
  for (const candidate of current.plan.candidates) {
    if (current.completedPaths.includes(candidate.path)) continue;
    const intended = current.intentPaths.includes(candidate.path);
    const object = await network(
      () => store.digest(candidate.path, candidate.bytes),
      candidate.path,
    );
    if (!object && !intended) fail("ASSET_PRUNE_STALE", candidate.path);
    if (
      object &&
      (object.bytes !== candidate.bytes || object.sha256 !== candidate.sha256)
    )
      fail("ASSET_PRUNE_STALE", candidate.path);
    if (!intended) {
      current = parsePruneJournal({
        ...current,
        phase: "deleting",
        intentPaths: [...current.intentPaths, candidate.path],
      });
      etag = await putJournal(store, current, etag);
    }
    if (object) {
      try {
        await network(
          () => store.delete(candidate.path, { ifMatch: object.etag }),
          candidate.path,
        );
      } catch (error) {
        if (error instanceof RemotePreconditionError)
          fail("ASSET_PRUNE_STALE", candidate.path);
        throw error;
      }
    }
    current = parsePruneJournal({
      ...current,
      phase: "deleting",
      completedPaths: [...current.completedPaths, candidate.path],
    });
    etag = await putJournal(store, current, etag);
  }
  const nextBytes = canonicalBytes(current.nextState);
  const stateAlreadyCommitted = sameBytes(state.bytes, nextBytes);
  if (!stateAlreadyCommitted) {
    if (sha256(state.bytes) !== current.plan.basisSha256)
      fail("ASSET_PRUNE_STALE", STATE_KEY);
    try {
      await network(
        () =>
          store.putBytes(STATE_KEY, nextBytes, {
            ifMatch: state.etag,
            cacheControl: "no-store",
            contentType: "application/json",
          }),
        STATE_KEY,
      );
    } catch (error) {
      if (error instanceof RemotePreconditionError)
        fail("ASSET_PRUNE_STALE", STATE_KEY);
      throw error;
    }
  }
  current = parsePruneJournal({ ...current, phase: "committed" });
  await putJournal(store, current, etag);
  await network(() => store.delete(JOURNAL_KEY), JOURNAL_KEY);
}

export async function applyRemotePrune(
  store: RemoteObjectStore,
  supplied: PrunePlan,
  now: Date,
): Promise<void> {
  await withRemoteLock(store, now, async () => {
    const expected = parsePrunePlan(supplied);
    const preview = await previewLocked(store, now);
    if (!sameBytes(canonicalBytes(expected), canonicalBytes(preview.plan)))
      fail("ASSET_PRUNE_STALE");
    const journal = parsePruneJournal({
      schemaVersion: 1,
      plan: preview.plan,
      phase: "prepared",
      intentPaths: [],
      completedPaths: [],
      nextState: preview.nextState,
      nextReceipt: null,
    });
    const etag = await putJournal(store, journal);
    await continuePrune(store, journal, etag, preview.state);
  });
}

export async function resumeRemotePrune(
  store: RemoteObjectStore,
  now: Date,
): Promise<void> {
  await withRemoteLock(store, now, async () => {
    const record = await network(() => store.read(JOURNAL_KEY), JOURNAL_KEY);
    if (!record) fail("ASSET_REFERENCE_MISSING", JOURNAL_KEY);
    const journal = parsePruneJournal(parseJsonBytes(record.bytes));
    if (journal.plan.scope !== "remote" || journal.nextState === null)
      fail("ASSET_RECOVERY_REQUIRED", JOURNAL_KEY);
    const state = await readState(store);
    const stateHash = sha256(state.bytes);
    const nextBytes = canonicalBytes(journal.nextState);
    if (
      stateHash !== journal.plan.basisSha256 &&
      !sameBytes(state.bytes, nextBytes)
    )
      fail("ASSET_PRUNE_STALE", STATE_KEY);
    await continuePrune(store, journal, record.etag, state);
  });
}
