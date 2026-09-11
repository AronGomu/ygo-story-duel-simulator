import { createHash, randomUUID } from "node:crypto";
import { mkdir, open } from "node:fs/promises";
import path from "node:path";
import type { BundleCandidate } from "./bundle-locked.ts";
import { parseBundleSnapshot, type BundleSnapshot } from "./bundle-snapshot.ts";
import { parseDevManifest } from "./dev-manifest.ts";
import {
  canonicalBytes,
  compareCodePoints,
  parseJsonBytes,
} from "./canonical-json.ts";
import { AssetDeliveryError, fail } from "./failure.ts";
import { parseChannel, type Channel, type TargetOption } from "./identity.ts";
import type { ObjectRef } from "./object-ref.ts";
import { assertSafeParents } from "./path-guards.ts";
import {
  parsePublicationInventory,
  type PublicationInventory,
} from "./publication-inventory.ts";
import { parseReleasePointer, type ReleasePointer } from "./release-pointer.ts";
import type { RetainedMetadata } from "./retained-metadata.ts";
import { EMPTY_RETAINED_METADATA } from "./scan-assets.ts";
import {
  digestSource,
  readSource,
  sameDigest,
  sourceStat,
} from "./source-files.ts";
import {
  RemotePreconditionError,
  type RemoteObjectStore,
  type RemoteRead,
} from "./remote-store.ts";

export const STATE_KEY = "channels/index.json";
const LOCK_KEY = "_control/write-lock.json";
export const JOURNAL_KEY = "_control/prune-journal.json";
const IMMUTABLE_CACHE = "public,max-age=31536000,immutable" as const;
export const DAY_MS = 24 * 60 * 60 * 1000;

export interface StateRecord {
  readonly value: PublicationInventory;
  readonly bytes: Uint8Array;
  readonly etag: string;
}
interface HistoryPreparation {
  readonly history: RetainedMetadata;
  readonly retainedObjects?: string;
}
export interface PublicationRuntime {
  readonly root: string;
  readonly store: RemoteObjectStore;
  readonly now: () => Date;
  readonly build: (
    target: TargetOption,
    channel: Channel,
    history: RetainedMetadata,
    retainedObjects?: string,
  ) => Promise<BundleCandidate>;
  readonly authorize: (
    candidate: BundleCandidate,
    advertised: readonly BundleSnapshot[],
  ) => Promise<void>;
  readonly verifyPublic: (object: ObjectRef) => Promise<void>;
  readonly prepareHistory?: (
    advertised: readonly BundleSnapshot[],
    existingRelease: BundleSnapshot | null,
  ) => Promise<HistoryPreparation>;
}

export function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}
export function sameBytes(left: Uint8Array, right: Uint8Array): boolean {
  return Buffer.from(left).equals(Buffer.from(right));
}
function sameRef(left: ObjectRef, right: ObjectRef): boolean {
  return (
    left.key === right.key &&
    left.bytes === right.bytes &&
    left.sha256 === right.sha256
  );
}
function targetOf(snapshot: BundleSnapshot): TargetOption {
  return snapshot.dev && snapshot.prod ? "all" : snapshot.dev ? "dev" : "prod";
}
function contentType(key: string): "application/json" | "application/zip" {
  return key.endsWith(".zip") ? "application/zip" : "application/json";
}
export async function network<T>(
  action: () => Promise<T>,
  safePath: string,
): Promise<T> {
  try {
    return await action();
  } catch (error) {
    if (
      error instanceof AssetDeliveryError ||
      error instanceof RemotePreconditionError
    )
      throw error;
    fail("ASSET_NETWORK_FAILED", safePath);
  }
}
export async function readState(
  store: RemoteObjectStore,
): Promise<StateRecord> {
  const record = await network(() => store.read(STATE_KEY), STATE_KEY);
  if (!record) fail("ASSET_REFERENCE_MISSING", STATE_KEY);
  const value = parsePublicationInventory(parseJsonBytes(record.bytes));
  if (!sameBytes(record.bytes, canonicalBytes(value)))
    fail("ASSET_INTEGRITY_FAILED", STATE_KEY);
  return { value, bytes: record.bytes, etag: record.etag };
}
async function readExact(
  store: RemoteObjectStore,
  ref: ObjectRef,
): Promise<RemoteRead> {
  const record = await network(() => store.read(ref.key, ref.bytes), ref.key);
  if (
    !record ||
    record.bytes.byteLength !== ref.bytes ||
    sha256(record.bytes) !== ref.sha256
  )
    fail(
      record ? "ASSET_INTEGRITY_FAILED" : "ASSET_REFERENCE_MISSING",
      ref.key,
    );
  return record;
}
export async function verifyExact(
  store: RemoteObjectStore,
  ref: ObjectRef,
): Promise<void> {
  const digest = await network(() => store.digest(ref.key, ref.bytes), ref.key);
  if (!digest) fail("ASSET_REFERENCE_MISSING", ref.key);
  if (digest.bytes !== ref.bytes || digest.sha256 !== ref.sha256)
    fail("ASSET_INTEGRITY_FAILED", ref.key);
}
export async function loadSnapshot(
  store: RemoteObjectStore,
  ref: ObjectRef,
  verifyClosure = false,
): Promise<BundleSnapshot> {
  const snapshot = parseBundleSnapshot(
    parseJsonBytes((await readExact(store, ref)).bytes),
  );
  if (verifyClosure)
    for (const object of snapshot.objects) await verifyExact(store, object);
  return snapshot;
}
export async function loadRelease(
  store: RemoteObjectStore,
  version: string,
  expected?: ObjectRef,
): Promise<{
  readonly pointer: ReleasePointer;
  readonly ref: ObjectRef;
} | null> {
  const key = `releases/${version}.json`;
  const record = await network(() => store.read(key), key);
  if (!record) return null;
  const bytes = record.bytes;
  const ref = { key, bytes: bytes.byteLength, sha256: sha256(bytes) };
  if (expected && !sameRef(ref, expected)) fail("ASSET_INTEGRITY_FAILED", key);
  const pointer = parseReleasePointer(parseJsonBytes(bytes));
  if (pointer.version !== version) fail("ASSET_INTEGRITY_FAILED", key);
  return { pointer, ref };
}
async function advertisedSnapshots(
  store: RemoteObjectStore,
  state: PublicationInventory,
  now: Date,
): Promise<BundleSnapshot[]> {
  const snapshots: BundleSnapshot[] = [];
  if (state.nightly) snapshots.push(await loadSnapshot(store, state.nightly));
  for (const release of state.releases) {
    const loaded = await loadRelease(store, release.version, release.pointer);
    if (!loaded) fail("ASSET_REFERENCE_MISSING", release.pointer.key);
    snapshots.push(await loadSnapshot(store, loaded.pointer.snapshot));
  }
  for (const retired of state.retiredNightlies)
    if (now.getTime() - new Date(retired.retiredAt).getTime() < DAY_MS)
      snapshots.push(await loadSnapshot(store, retired.snapshot));
  return snapshots;
}
async function retainedTargetObjects(
  store: RemoteObjectStore,
  previous: BundleSnapshot,
  requestedTarget: TargetOption,
): Promise<readonly ObjectRef[]> {
  if (
    requestedTarget === "all" ||
    (requestedTarget === "dev" && !previous.prod) ||
    (requestedTarget === "prod" && !previous.dev)
  )
    return [];
  if (!previous.dev) return previous.objects;
  const manifest = parseDevManifest(
    parseJsonBytes((await readExact(store, previous.dev)).bytes),
  );
  const devKeys = new Set([
    previous.dev.key,
    manifest.inventory.key,
    manifest.archive.key,
  ]);
  return requestedTarget === "prod"
    ? previous.objects.filter((object) => devKeys.has(object.key))
    : previous.objects.filter(
        (object) =>
          object.key !== previous.dev!.key &&
          object.key !== manifest.archive.key,
      );
}

export async function withRemoteLock<T>(
  store: RemoteObjectStore,
  now: Date,
  action: () => Promise<T>,
): Promise<T> {
  const lock = canonicalBytes({
    owner: randomUUID(),
    startedAt: now.toISOString(),
  });
  let lockEtag: string;
  try {
    lockEtag = (
      await network(
        () =>
          store.putBytes(LOCK_KEY, lock, {
            ifNoneMatch: true,
            cacheControl: "no-store",
            contentType: "application/json",
          }),
        LOCK_KEY,
      )
    ).etag;
  } catch (error) {
    if (error instanceof RemotePreconditionError) fail("ASSET_BUSY", LOCK_KEY);
    throw error;
  }
  let result: T | undefined;
  let primary: unknown;
  try {
    result = await action();
  } catch (error) {
    primary = error;
  }
  let cleanupError: unknown;
  try {
    await network(
      () => store.delete(LOCK_KEY, { ifMatch: lockEtag }),
      LOCK_KEY,
    );
  } catch (error) {
    if (error instanceof RemotePreconditionError) {
      try {
        fail("ASSET_PUBLICATION_CONFLICT", LOCK_KEY);
      } catch (conflict) {
        cleanupError = conflict;
      }
    } else cleanupError = error;
  }
  if (primary !== undefined) throw primary;
  if (cleanupError !== undefined) throw cleanupError;
  return result as T;
}

export async function rejectPendingJournal(
  store: RemoteObjectStore,
): Promise<void> {
  if (await network(() => store.read(JOURNAL_KEY), JOURNAL_KEY))
    fail("ASSET_RECOVERY_REQUIRED", JOURNAL_KEY);
}
async function writeCombinedSnapshot(
  root: string,
  candidate: BundleCandidate,
  snapshot: BundleSnapshot,
): Promise<BundleCandidate> {
  const bytes = canonicalBytes(snapshot);
  const snapshotRef: ObjectRef = {
    key: `snapshots/${sha256(bytes)}.json`,
    bytes: bytes.byteLength,
    sha256: sha256(bytes),
  };
  const relative = `${candidate.run}/objects/${snapshotRef.key}`;
  const file = await assertSafeParents(root, relative);
  await mkdir(path.dirname(file), { recursive: true });
  try {
    const handle = await open(
      await assertSafeParents(root, relative),
      "wx",
      0o600,
    );
    try {
      await handle.writeFile(bytes);
      await handle.sync();
    } finally {
      await handle.close();
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    const existing = await readSource(root, relative, true, true);
    if (!sameBytes(existing.bytes!, bytes))
      fail("ASSET_LOCAL_CONFLICT", relative);
  }
  return { ...candidate, snapshot, snapshotRef };
}
async function ensureCandidateObject(
  runtime: PublicationRuntime,
  candidate: BundleCandidate,
  ref: ObjectRef,
): Promise<void> {
  const existing = await network(
    () => runtime.store.digest(ref.key, ref.bytes),
    ref.key,
  );
  if (existing) {
    if (existing.bytes !== ref.bytes || existing.sha256 !== ref.sha256)
      fail("ASSET_INTEGRITY_FAILED", ref.key);
    return;
  }
  const relative = `${candidate.run}/objects/${ref.key}`;
  const file = await assertSafeParents(runtime.root, relative);
  await network(
    () =>
      runtime.store.putFile(ref.key, file, {
        cacheControl: IMMUTABLE_CACHE,
        contentType: contentType(ref.key),
      }),
    ref.key,
  );
  await verifyExact(runtime.store, ref);
}
async function ensurePublishedObject(
  runtime: PublicationRuntime,
  candidate: BundleCandidate,
  object: ObjectRef,
): Promise<void> {
  const relative = `${candidate.run}/objects/${object.key}`;
  if (!(await sourceStat(runtime.root, relative))) {
    await verifyExact(runtime.store, object);
    return;
  }
  const local = await digestSource(runtime.root, relative, true);
  if (!sameDigest(local, object)) fail("ASSET_INTEGRITY_FAILED", object.key);
  await ensureCandidateObject(runtime, candidate, object);
}
async function publicVerify(
  runtime: PublicationRuntime,
  refs: readonly ObjectRef[],
): Promise<void> {
  for (const ref of refs)
    await network(() => runtime.verifyPublic(ref), ref.key);
}

interface PublicationPreflight {
  readonly state: StateRecord;
  readonly existingRelease: Awaited<ReturnType<typeof loadRelease>>;
  readonly candidate: BundleCandidate;
}

/** Read/build/authorize only. Caller-held local lock keeps source bytes stable. */
async function preparePublication(
  runtime: PublicationRuntime,
  requestedTarget: TargetOption,
  channel: Channel,
): Promise<PublicationPreflight> {
  await rejectPendingJournal(runtime.store);
  const state = await readState(runtime.store);
  const advertised = await advertisedSnapshots(
    runtime.store,
    state.value,
    runtime.now(),
  );
  let existingRelease: Awaited<ReturnType<typeof loadRelease>> = null;
  let buildTarget = requestedTarget;
  if (channel.kind === "release") {
    const advertisedEntry = state.value.releases.find(
      (entry) => entry.version === channel.version,
    );
    existingRelease = await loadRelease(
      runtime.store,
      channel.version,
      advertisedEntry?.pointer,
    );
    if (advertisedEntry && !existingRelease)
      fail("ASSET_REFERENCE_MISSING", advertisedEntry.pointer.key);
    if (existingRelease) {
      const old = await loadSnapshot(
        runtime.store,
        existingRelease.pointer.snapshot,
      );
      buildTarget = targetOf(old);
      if (requestedTarget !== buildTarget)
        fail("ASSET_RELEASE_EXISTS", existingRelease.ref.key);
    }
  }
  const oldReleaseSnapshot = existingRelease
    ? await loadSnapshot(runtime.store, existingRelease.pointer.snapshot)
    : null;
  const prepared = runtime.prepareHistory
    ? await runtime.prepareHistory(advertised, oldReleaseSnapshot)
    : { history: EMPTY_RETAINED_METADATA };
  let candidate = await runtime.build(
    buildTarget,
    channel,
    prepared.history,
    prepared.retainedObjects,
  );
  if (
    oldReleaseSnapshot &&
    !sameRef(candidate.snapshotRef, existingRelease!.pointer.snapshot)
  )
    fail("ASSET_RELEASE_EXISTS", existingRelease!.ref.key);

  if (
    channel.kind === "nightly" &&
    requestedTarget !== "all" &&
    state.value.nightly
  ) {
    const previous = await loadSnapshot(runtime.store, state.value.nightly);
    if (previous.appVersion === candidate.snapshot.appVersion) {
      const dev =
        requestedTarget === "prod" ? previous.dev : candidate.snapshot.dev;
      const prod =
        requestedTarget === "dev" ? previous.prod : candidate.snapshot.prod;
      const objectMap = new Map<string, ObjectRef>();
      const retained = await retainedTargetObjects(
        runtime.store,
        previous,
        requestedTarget,
      );
      for (const object of [...retained, ...candidate.snapshot.objects]) {
        const old = objectMap.get(object.key);
        if (old && !sameRef(old, object))
          fail("ASSET_INTEGRITY_FAILED", object.key);
        objectMap.set(object.key, object);
      }
      candidate = await writeCombinedSnapshot(runtime.root, candidate, {
        ...candidate.snapshot,
        dev,
        prod,
        objects: [...objectMap.values()].sort((a, b) =>
          compareCodePoints(a.key, b.key),
        ),
      });
    }
  }

  await runtime.authorize(candidate, advertised);
  return { state, existingRelease, candidate };
}

/** Shared remote protocol. Caller owns local lock; remote mutation starts after authorization. */
export async function publishRemote(
  runtime: PublicationRuntime,
  requestedTarget: TargetOption,
  channel: Channel,
): Promise<BundleCandidate> {
  if (!["dev", "prod", "all"].includes(requestedTarget))
    fail("ASSET_ARGUMENT_INVALID");
  channel = parseChannel(channel);
  const prepared = await preparePublication(runtime, requestedTarget, channel);
  return withRemoteLock(runtime.store, runtime.now(), async () => {
    await rejectPendingJournal(runtime.store);
    const lockedState = await readState(runtime.store);
    if (
      lockedState.etag !== prepared.state.etag ||
      !sameBytes(lockedState.bytes, prepared.state.bytes)
    )
      fail("ASSET_PUBLICATION_CONFLICT", STATE_KEY);
    const { state, existingRelease, candidate } = prepared;
    for (const object of [...candidate.snapshot.objects, candidate.snapshotRef])
      await ensurePublishedObject(runtime, candidate, object);
    await publicVerify(runtime, [
      ...candidate.snapshot.objects,
      candidate.snapshotRef,
    ]);

    let next: PublicationInventory;
    if (channel.kind === "nightly") {
      const retired = state.value.retiredNightlies.filter(
        (entry) => entry.snapshot.key !== candidate.snapshotRef.key,
      );
      if (
        state.value.nightly &&
        !sameRef(state.value.nightly, candidate.snapshotRef) &&
        !retired.some(
          (entry) => entry.snapshot.key === state.value.nightly!.key,
        )
      )
        retired.push({
          snapshot: state.value.nightly,
          retiredAt: runtime.now().toISOString(),
        });
      next = parsePublicationInventory({
        ...state.value,
        nightly: candidate.snapshotRef,
        retiredNightlies: retired.sort((a, b) =>
          compareCodePoints(a.snapshot.key, b.snapshot.key),
        ),
      });
    } else {
      const pointer: ReleasePointer = {
        schemaVersion: 1,
        version: channel.version,
        snapshot: candidate.snapshotRef,
      };
      const pointerBytes = canonicalBytes(pointer);
      const pointerRef: ObjectRef = {
        key: `releases/${channel.version}.json`,
        bytes: pointerBytes.byteLength,
        sha256: sha256(pointerBytes),
      };
      if (existingRelease) {
        if (!sameRef(existingRelease.ref, pointerRef))
          fail("ASSET_RELEASE_EXISTS", pointerRef.key);
      } else {
        try {
          await network(
            () =>
              runtime.store.putBytes(pointerRef.key, pointerBytes, {
                ifNoneMatch: true,
                cacheControl: IMMUTABLE_CACHE,
                contentType: "application/json",
              }),
            pointerRef.key,
          );
        } catch (error) {
          if (!(error instanceof RemotePreconditionError)) throw error;
          const concurrent = await loadRelease(runtime.store, channel.version);
          if (!concurrent || !sameRef(concurrent.ref, pointerRef))
            fail("ASSET_RELEASE_EXISTS", pointerRef.key);
        }
      }
      await publicVerify(runtime, [pointerRef]);
      const releases = state.value.releases.filter(
        (entry) => entry.version !== channel.version,
      );
      releases.push({ version: channel.version, pointer: pointerRef });
      next = parsePublicationInventory({
        ...state.value,
        releases: releases.sort((a, b) =>
          compareCodePoints(a.version, b.version),
        ),
      });
    }

    if (sameBytes(state.bytes, canonicalBytes(next))) return candidate;
    try {
      await network(
        () =>
          runtime.store.putBytes(STATE_KEY, canonicalBytes(next), {
            ifMatch: state.etag,
            cacheControl: "no-store",
            contentType: "application/json",
          }),
        STATE_KEY,
      );
    } catch (error) {
      if (error instanceof RemotePreconditionError)
        fail("ASSET_PUBLICATION_CONFLICT", STATE_KEY);
      throw error;
    }
    return candidate;
  });
}
