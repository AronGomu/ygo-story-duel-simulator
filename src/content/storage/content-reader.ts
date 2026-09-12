import type { IDBPDatabase } from "idb";
import type { ContentReadPort } from "../contracts/content-read-port.ts";
import type { ContentResult } from "../contracts/content-result.ts";
import type { InstalledContentSet } from "../contracts/installed-content-set.ts";
import type { ManifestRef } from "../contracts/manifest-ref.ts";
import type { ContentManifest } from "../contracts/content-manifest.ts";
import type { ContentSetRef } from "../contracts/content-set-ref.ts";
import type { ContentDatabase } from "./content-database.ts";
import { EMPTY_CONTENT, openContentDatabase } from "./content-database.ts";
import { CONTENT_CACHE_NAME } from "../content-constants.ts";
import { fileKey } from "./content-cache.ts";
import { acquireContentLease } from "./content-session-lease.ts";
import {
  activationId,
  contentError,
  digest,
  failure,
  json,
  readCachedBytes,
  same,
  unwrap,
  verifyBytes,
} from "../content-verification.ts";
import { parseContentIndex } from "../parsers/content-index.ts";
import { parseContentManifest } from "../parsers/content-manifest.ts";
import { parseContentFailure } from "../parsers/content-failure.ts";
import {
  manifestClosure,
  validateContentRef,
  validateInstalledState,
} from "../install/manifest-closure.ts";
import { verifyGameplay } from "../install/verify-gameplay.ts";

export class ContentReader implements ContentReadPort {
  // Scoped to one verification job, never reused across public read operations.
  readonly manifestMemo = new Map<
    string,
    { bytes: Uint8Array; sha256: string; value: ContentManifest }
  >();
  readonly leases = new Set<() => void>();
  readonly listeners = new Set<
    (state: ContentResult<InstalledContentSet>) => void
  >();
  readonly channel: BroadcastChannel | null;
  readonly db: IDBPDatabase<ContentDatabase>;
  readonly cache: Cache;
  readonly privateKeys: ReadonlySet<string> | null;
  constructor(
    db: IDBPDatabase<ContentDatabase>,
    cache: Cache,
    privateKeys: ReadonlySet<string> | null = null,
  ) {
    this.db = db;
    this.cache = cache;
    this.privateKeys = privateKeys;
    this.channel =
      privateKeys === null && typeof BroadcastChannel !== "undefined"
        ? new BroadcastChannel("ygo-content-state-v1")
        : null;
    if (this.channel)
      this.channel.onmessage = () => {
        void this.notify(false);
      };
  }
  async guard<T>(operation: () => Promise<T>): Promise<ContentResult<T>> {
    try {
      return { kind: "ok", value: await operation() };
    } catch (error) {
      return contentError(error);
    }
  }
  readCatalog(sha256: string) {
    return this.guard(async () => {
      if (!/^[a-f0-9]{64}$/.test(sha256))
        throw failure("CONTENT_INVALID_MANIFEST");
      const bytes = await this.db.get("catalogs", sha256);
      if (!bytes) throw failure("CONTENT_MISSING");
      if (
        !(bytes instanceof Uint8Array) ||
        bytes.length > 1048576 ||
        (await digest(bytes)) !== sha256
      )
        throw failure("CONTENT_INTEGRITY_FAILED");
      return { bytes, sha256, value: unwrap(parseContentIndex(json(bytes))) };
    });
  }
  readManifest(ref: ManifestRef) {
    return this.guard(async () => {
      const memo =
        this.privateKeys !== null
          ? this.manifestMemo.get(ref.sha256)
          : undefined;
      if (memo) {
        if (memo.bytes.length !== ref.bytes || memo.value.packId !== ref.packId)
          throw failure("CONTENT_INTEGRITY_FAILED");
        return memo;
      }
      const bytes = await this.db.get("manifests", ref.sha256);
      if (!bytes) throw failure("CONTENT_MISSING");
      await verifyBytes(bytes, ref);
      const value = unwrap(parseContentManifest(json(bytes)));
      if (value.packId !== ref.packId)
        throw failure("CONTENT_INTEGRITY_FAILED");
      const metadata = { bytes, sha256: ref.sha256, value };
      if (this.privateKeys !== null)
        this.manifestMemo.set(ref.sha256, metadata);
      return metadata;
    });
  }
  private async assertNotInvalid(ref: ManifestRef): Promise<void> {
    const tx = this.db.transaction("invalid", "readonly");
    const [key, value] = await Promise.all([
      tx.store.getKey(ref.sha256),
      tx.store.get(ref.sha256),
      tx.done,
    ]);
    if (key !== undefined) throw parseContentFailure(value);
  }
  readFile(ref: ManifestRef, path: string) {
    return this.guard(async () => {
      const key = fileKey(ref, path);
      if (this.privateKeys !== null) {
        if (!this.privateKeys.has(key)) throw failure("CONTENT_MISSING");
      } else {
        await this.assertNotInvalid(ref);
        const receipt = await this.db.get("receipts", ref.sha256);
        if (!receipt) throw failure("CONTENT_MISSING");
        if (
          !same(receipt.manifest, ref) ||
          !Number.isSafeInteger(receipt.verifiedAt) ||
          receipt.verifiedAt < 0 ||
          !receipt.fileKeys.includes(key)
        )
          throw failure("CONTENT_INTEGRITY_FAILED");
      }
      const manifest = unwrap(await this.readManifest(ref)).value;
      const file = manifest.files.find((f) => f.path === path);
      if (!file) throw failure("CONTENT_MISSING");
      const response = await this.cache.match(key);
      if (!response) throw failure("CONTENT_MISSING");
      const bytes = await readCachedBytes(response, file.bytes);
      await verifyBytes(bytes, file);
      return new Blob([bytes.slice()], { type: file.mediaType });
    });
  }
  inspectContent(input: ContentSetRef) {
    return this.guard(async () => {
      const ref = validateContentRef(input);
      const catalog = unwrap(await this.readCatalog(ref.catalogSha256)).value;
      if (
        !same(catalog.runtime, ref.runtime) ||
        catalog.runtimeSnapshotId !== ref.snapshot.runtimeSnapshotId ||
        (await activationId(
          ref.snapshot.runtimeSnapshotId,
          ref.catalogSha256,
        )) !== ref.snapshot.activationId
      )
        throw failure("CONTENT_INTEGRITY_FAILED");
      for (const chapter of ref.chapters)
        if (
          !catalog.chapters.some(
            (c) => c.status === "published" && same(c.manifest, chapter),
          )
        )
          throw failure("CONTENT_INTEGRITY_FAILED");
      const entries = await manifestClosure(
        [ref.runtime, ...ref.chapters],
        async (r) => unwrap(await this.readManifest(r)).value,
      );
      if (entries.length !== ref.chapters.length + 1)
        throw failure("CONTENT_INTEGRITY_FAILED");
      const verifiedKeys = new Set<string>();
      for (const entry of entries) {
        if (entry.manifest.runtimeSnapshotId !== ref.snapshot.runtimeSnapshotId)
          throw failure("CONTENT_INTEGRITY_FAILED");
        await this.assertNotInvalid(entry.ref);
        const receipt = await this.db.get("receipts", entry.ref.sha256);
        if (!receipt) throw failure("CONTENT_MISSING");
        const keys = entry.manifest.files.map((file) =>
          fileKey(entry.ref, file.path),
        );
        if (
          !same(receipt.manifest, entry.ref) ||
          !Number.isSafeInteger(receipt.verifiedAt) ||
          receipt.verifiedAt < 0 ||
          !same(receipt.fileKeys, keys)
        )
          throw failure("CONTENT_INTEGRITY_FAILED");
        for (const key of keys) verifiedKeys.add(key);
      }
      const scoped = new ContentReader(this.db, this.cache, verifiedKeys);
      for (const entry of entries)
        for (const file of entry.manifest.files)
          unwrap(await scoped.readFile(entry.ref, file.path));
      const runtime = entries.find((e) => e.ref.packId === "runtime")!;
      if (
        runtime.manifest.files.find(
          (f) => f.path === "runtime/current/manifest.json",
        )?.sha256 !== ref.snapshot.runtimeManifestSha256
      )
        throw failure("CONTENT_INTEGRITY_FAILED");
      await verifyGameplay(entries, scoped);
      for (const entry of entries) {
        await this.assertNotInvalid(entry.ref);
      }
      return ref;
    });
  }
  current() {
    return this.guard(async () => {
      const state = validateInstalledState(
        (await this.db.get("active", "current")) ?? EMPTY_CONTENT,
      );
      if (state.current) unwrap(await this.inspectContent(state.current));
      return state;
    });
  }
  subscribeCurrent(
    listener: (state: ContentResult<InstalledContentSet>) => void,
  ): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
  async notify(broadcast = true): Promise<void> {
    if (broadcast) {
      try {
        this.channel?.postMessage("changed");
      } catch {
        console.warn("CONTENT_STATE_NOTIFICATION_FAILED");
      }
    }
    const state = await this.current();
    for (const listener of this.listeners) {
      try {
        listener(state);
      } catch {
        console.warn("CONTENT_STATE_LISTENER_FAILED");
      }
    }
  }
  acquireSession(ref: ContentSetRef) {
    return this.guard(async () => {
      if (this.privateKeys !== null) throw failure("CONTENT_BUSY");
      const content = unwrap(await this.inspectContent(ref));
      const lease = await acquireContentLease(content, () =>
        this.inspectContent(content),
      );
      const release = () => {
        lease.release();
        this.leases.delete(release);
      };
      this.leases.add(release);
      return { content, release };
    });
  }
  close(): void {
    for (const release of this.leases) release();
    this.channel?.close();
    this.listeners.clear();
    this.db.close();
  }
}
export async function openContentReader(): Promise<
  ContentResult<ContentReadPort>
> {
  let db: IDBPDatabase<ContentDatabase> | undefined;
  try {
    db = await openContentDatabase();
    return {
      kind: "ok",
      value: new ContentReader(db, await caches.open(CONTENT_CACHE_NAME)),
    };
  } catch (error) {
    db?.close();
    return contentError(error);
  }
}
