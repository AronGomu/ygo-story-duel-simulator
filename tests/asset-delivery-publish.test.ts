import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { once } from "node:events";
import path from "node:path";
import test from "node:test";
import { canonicalBytes } from "../scripts/lib/asset-delivery/canonical-json.ts";
import type { BundleCandidate } from "../scripts/lib/asset-delivery/bundle-locked.ts";
import type { BundleSnapshot } from "../scripts/lib/asset-delivery/bundle-snapshot.ts";
import type {
  Channel,
  TargetOption,
} from "../scripts/lib/asset-delivery/identity.ts";
import type { ObjectRef } from "../scripts/lib/asset-delivery/object-ref.ts";
import type { RetainedMetadata } from "../scripts/lib/asset-delivery/retained-metadata.ts";
import {
  verifyPublicationApproval,
  verifyPublicationEvidence,
} from "../scripts/lib/asset-delivery/publication-approval.ts";
import { verifyPublicObject } from "../scripts/lib/asset-delivery/public-object.ts";
import {
  loadRelease,
  publishRemote,
  withRemoteLock,
} from "../scripts/lib/asset-delivery/remote-publication.ts";
import {
  applyRemotePrune,
  previewRemotePrune,
  resumeRemotePrune,
} from "../scripts/lib/asset-delivery/remote-prune.ts";
import {
  R2ObjectStore,
  RemotePreconditionError,
  type RemoteDeleteOptions,
  type RemoteObjectStore,
  type RemotePutOptions,
  type RemoteRead,
} from "../scripts/lib/asset-delivery/remote-store.ts";
import { AssetDeliveryError } from "../scripts/lib/asset-delivery/failure.ts";

const hash = (bytes: Uint8Array): string =>
  createHash("sha256").update(bytes).digest("hex");
const ref = (prefix: string, bytes: Uint8Array): ObjectRef => ({
  key: `${prefix}/${hash(bytes)}.${prefix.endsWith("archives") ? "zip" : "json"}`,
  bytes: bytes.byteLength,
  sha256: hash(bytes),
});

class MemoryStore implements RemoteObjectStore {
  readonly objects = new Map<
    string,
    {
      bytes: Uint8Array;
      etag: string;
      cacheControl?: RemotePutOptions["cacheControl"];
    }
  >();
  puts = 0;
  deletes = 0;
  failPut: number | null = null;
  failDeleteAfter: number | null = null;
  conflictStateCas = false;
  replaceStateOnLock = false;
  replaceBeforeDeleteKey: string | null = null;
  async read(key: string): Promise<RemoteRead | null> {
    const value = this.objects.get(key);
    return value ? { bytes: value.bytes.slice(), etag: value.etag } : null;
  }
  async digest(key: string) {
    const value = this.objects.get(key);
    return value
      ? {
          bytes: value.bytes.byteLength,
          sha256: hash(value.bytes),
          etag: value.etag,
        }
      : null;
  }
  async putBytes(
    key: string,
    bytes: Uint8Array,
    options: RemotePutOptions = {},
  ) {
    this.puts++;
    if (this.failPut === this.puts) throw new Error("injected put failure");
    let current = this.objects.get(key);
    if (key === "_control/write-lock.json" && this.replaceStateOnLock) {
      this.replaceStateOnLock = false;
      const state = this.objects.get("channels/index.json")!;
      this.objects.set("channels/index.json", {
        ...state,
        etag: `external-${randomUUID()}`,
      });
    }
    if (
      key === "channels/index.json" &&
      options.ifMatch &&
      this.conflictStateCas
    ) {
      this.conflictStateCas = false;
      this.objects.set(key, {
        ...current!,
        etag: `external-${randomUUID()}`,
      });
      current = this.objects.get(key);
    }
    if (options.ifNoneMatch && current) throw new RemotePreconditionError();
    if (options.ifMatch !== undefined && current?.etag !== options.ifMatch)
      throw new RemotePreconditionError();
    const etag = `etag-${randomUUID()}`;
    this.objects.set(key, {
      bytes: bytes.slice(),
      etag,
      cacheControl: options.cacheControl,
    });
    return { etag };
  }
  async putFile(key: string, file: string, options: RemotePutOptions = {}) {
    return this.putBytes(key, await readFile(file), options);
  }
  async delete(key: string, options: RemoteDeleteOptions = {}): Promise<void> {
    this.deletes++;
    if (this.failDeleteAfter === this.deletes)
      throw new Error("injected delete failure");
    if (this.replaceBeforeDeleteKey === key) {
      this.replaceBeforeDeleteKey = null;
      const current = this.objects.get(key)!;
      this.objects.set(key, {
        ...current,
        etag: "replacement-etag",
      });
    }
    const current = this.objects.get(key);
    if (options.ifMatch !== undefined && current?.etag !== options.ifMatch)
      throw new RemotePreconditionError();
    this.objects.delete(key);
  }
}

async function fixture(t: test.TestContext): Promise<string> {
  const root = path.resolve(`.tmp/asset-publish-${randomUUID()}`);
  await mkdir(root, { recursive: true });
  t.after(() => rm(root, { recursive: true, force: true }));
  return root;
}

async function seedState(store: MemoryStore, state: unknown): Promise<void> {
  await store.putBytes("channels/index.json", canonicalBytes(state), {
    cacheControl: "no-store",
    contentType: "application/json",
  });
  store.puts = 0;
}

const emptyState = {
  schemaVersion: 1 as const,
  nightly: null,
  releases: [],
  retiredNightlies: [],
};

async function candidate(
  root: string,
  appVersion: string,
  target: TargetOption,
  salt: string,
): Promise<BundleCandidate> {
  const run = `generated/asset-delivery/runs/${randomUUID()}`;
  const objectsDir = path.join(root, run, "objects");
  await mkdir(objectsDir, { recursive: true });
  const inventoryBytes = canonicalBytes({ salt, kind: "inventory" });
  const inventory = ref("inventories", inventoryBytes);
  const objects: ObjectRef[] = [inventory];
  let dev: ObjectRef | null = null;
  let prod: BundleSnapshot["prod"] = null;
  if (target !== "prod") {
    const archiveBytes = new TextEncoder().encode(`archive-${salt}`);
    const archive = ref("dev/archives", archiveBytes);
    const bytes = canonicalBytes({
      schemaVersion: 1,
      appVersion,
      layoutVersion: 1,
      inventory,
      archive,
      files: [],
    });
    dev = ref("dev/manifests", bytes);
    objects.push(archive, dev);
    for (const [object, content] of [
      [archive, archiveBytes],
      [dev, bytes],
    ] as const) {
      await mkdir(path.dirname(path.join(objectsDir, object.key)), {
        recursive: true,
      });
      await writeFile(path.join(objectsDir, object.key), content);
    }
  }
  if (target !== "dev") {
    const coreBytes = canonicalBytes({ salt, kind: "core" });
    const indexBytes = canonicalBytes({ salt, kind: "index" });
    const prodInventoryBytes = canonicalBytes({ salt, kind: "prod-inventory" });
    const core = ref("core/manifests", coreBytes);
    const index = ref("content/indexes", indexBytes);
    const prodInventory = ref("inventories", prodInventoryBytes);
    prod = {
      inventory: prodInventory,
      core,
      index,
      runtimeSnapshotId: "f".repeat(64),
    };
    objects.push(core, index, prodInventory);
    for (const [object, bytes] of [
      [core, coreBytes],
      [index, indexBytes],
      [prodInventory, prodInventoryBytes],
    ] as const) {
      await mkdir(path.dirname(path.join(objectsDir, object.key)), {
        recursive: true,
      });
      await writeFile(path.join(objectsDir, object.key), bytes);
    }
  }
  await mkdir(path.dirname(path.join(objectsDir, inventory.key)), {
    recursive: true,
  });
  await writeFile(path.join(objectsDir, inventory.key), inventoryBytes);
  const snapshot: BundleSnapshot = {
    schemaVersion: 1,
    appVersion,
    inventory,
    dev,
    prod,
    objects: objects.toSorted((a, b) => a.key.localeCompare(b.key)),
  };
  const snapshotBytes = canonicalBytes(snapshot);
  const snapshotRef = ref("snapshots", snapshotBytes);
  await mkdir(path.dirname(path.join(objectsDir, snapshotRef.key)), {
    recursive: true,
  });
  await writeFile(path.join(objectsDir, snapshotRef.key), snapshotBytes);
  return { run, snapshot, snapshotRef };
}

function runtime(
  root: string,
  store: MemoryStore,
  build: (
    target: TargetOption,
    channel: Channel,
    history: RetainedMetadata,
  ) => Promise<BundleCandidate>,
) {
  return {
    root,
    store,
    now: () => new Date("2026-09-11T00:00:00.000Z"),
    build,
    authorize: async () => undefined,
    verifyPublic: async (object: ObjectRef) => {
      const digest = await store.digest(object.key);
      assert.deepEqual(
        digest && { bytes: digest.bytes, sha256: digest.sha256 },
        {
          bytes: object.bytes,
          sha256: object.sha256,
        },
      );
    },
  };
}

test("public publish/prune CLI help and invalid flags preserve AssetResult contract", () => {
  for (const script of [
    "scripts/publish-assets.ts",
    "scripts/prune-assets.ts",
  ]) {
    const help = spawnSync(process.execPath, [script, "--help"], {
      encoding: "utf8",
    });
    assert.equal(help.status, 0, help.stderr);
    assert.deepEqual(JSON.parse(help.stdout.trim()), {
      status: "ok",
      operation: script.includes("publish") ? "publish" : "prune",
      snapshotSha256: null,
    });
    const invalid = spawnSync(process.execPath, [script, "--unknown"], {
      encoding: "utf8",
    });
    assert.equal(invalid.status, 2, invalid.stderr);
    assert.deepEqual(JSON.parse(invalid.stdout.trim()), {
      status: "failed",
      code: "ASSET_ARGUMENT_INVALID",
      path: null,
    });
  }
  for (const args of [
    ["scripts/publish-assets.ts", "--target", "dev"],
    [
      "scripts/publish-assets.ts",
      "--target",
      "dev",
      "--origin",
      "https://app.example/path",
    ],
  ]) {
    const invalidOrigin = spawnSync(process.execPath, args, {
      encoding: "utf8",
    });
    assert.equal(invalidOrigin.status, 2, invalidOrigin.stderr);
    assert.deepEqual(JSON.parse(invalidOrigin.stdout.trim()), {
      status: "failed",
      code: "ASSET_ARGUMENT_INVALID",
      path: null,
    });
  }
});

test("rights evidence and target scope fail before publication", async (t) => {
  const root = await fixture(t);
  const evidenceBytes = new TextEncoder().encode("owner evidence");
  await mkdir(path.join(root, "content"), { recursive: true });
  await writeFile(path.join(root, "content/evidence.json"), evidenceBytes);
  const approval = {
    schemaVersion: 1 as const,
    status: "approved" as const,
    targets: ["dev" as const],
    rules: [
      {
        root: "story" as const,
        kind: "tree" as const,
        path: "",
        includesFutureFiles: true as const,
        evidence: {
          path: "content/evidence.json",
          bytes: evidenceBytes.byteLength,
          sha256: hash(evidenceBytes),
        },
      },
    ],
  };
  await verifyPublicationEvidence(root, approval);
  await assert.rejects(
    verifyPublicationEvidence(root, {
      ...approval,
      rules: [
        {
          ...approval.rules[0]!,
          evidence: { ...approval.rules[0]!.evidence, sha256: "a".repeat(64) },
        },
      ],
    }),
    /ASSET_PUBLICATION_DENIED/,
  );
  const inventory = {
    schemaVersion: 1 as const,
    appVersion: "0.1.0",
    runtimeSnapshotId: null,
    profiles: [],
    selection: { schemaVersion: 1 as const, profiles: [] },
    files: [],
    vendorFiles: [],
    retainedMetadata: {
      schemaVersion: 1 as const,
      catalogs: [],
      manifests: [],
    },
    playerMetadata: null,
  };
  const denied = verifyPublicationApproval(
    approval,
    {
      schemaVersion: 1,
      appVersion: "0.1.0",
      inventory: {
        key: `inventories/${"a".repeat(64)}.json`,
        bytes: 1,
        sha256: "a".repeat(64),
      },
      dev: null,
      prod: {
        inventory: {
          key: `inventories/${"a".repeat(64)}.json`,
          bytes: 1,
          sha256: "a".repeat(64),
        },
        core: {
          key: `core/manifests/${"b".repeat(64)}.json`,
          bytes: 1,
          sha256: "b".repeat(64),
        },
        index: {
          key: `content/indexes/${"c".repeat(64)}.json`,
          bytes: 1,
          sha256: "c".repeat(64),
        },
        runtimeSnapshotId: "d".repeat(64),
      },
      objects: [],
    },
    [inventory],
  );
  assert.deepEqual(denied, {
    status: "failed",
    code: "ASSET_PUBLICATION_DENIED",
    path: null,
  });
});

test("anonymous public GET verifies exact CORS, immutable cache, length and SHA", async (t) => {
  const bytes = new TextEncoder().encode("public object");
  const origin = "https://app.example";
  let served = bytes;
  let allowedOrigin: string | null = origin;
  let cacheControl: string | null = "public,max-age=31536000,immutable";
  let requestOrigin: string | undefined;
  const server = createServer((request, response) => {
    requestOrigin = request.headers.origin;
    response.writeHead(200, {
      "content-length": served.byteLength,
      "content-type": "application/json",
      ...(allowedOrigin === null
        ? {}
        : { "access-control-allow-origin": allowedOrigin }),
      ...(cacheControl === null ? {} : { "cache-control": cacheControl }),
    });
    response.end(served);
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => server.close());
  const address = server.address();
  assert(address && typeof address === "object");
  const object = ref("inventories", bytes);
  const config = {
    schemaVersion: 1 as const,
    publicBaseUrl: `http://127.0.0.1:${address.port}/`,
    bucket: "fixture-bucket",
    keyPrefix: "ascencio-assets/v1/" as const,
  };
  await verifyPublicObject(config, object, origin);
  assert.equal(requestOrigin, origin);
  allowedOrigin = null;
  await assert.rejects(
    verifyPublicObject(config, object, origin),
    /ASSET_NETWORK_FAILED/,
  );
  allowedOrigin = "https://wrong.example";
  await assert.rejects(
    verifyPublicObject(config, object, origin),
    /ASSET_NETWORK_FAILED/,
  );
  allowedOrigin = origin;
  cacheControl = "no-store";
  await assert.rejects(
    verifyPublicObject(config, object, origin),
    /ASSET_INTEGRITY_FAILED/,
  );
  cacheControl = null;
  await assert.rejects(
    verifyPublicObject(config, object, origin),
    /ASSET_INTEGRITY_FAILED/,
  );
  cacheControl = "public,max-age=31536000,immutable";
  served = new TextEncoder().encode("wrong bytes!!");
  await assert.rejects(
    verifyPublicObject(config, object, origin),
    /ASSET_INTEGRITY_FAILED/,
  );
});

test("rights denial occurs before remote lock or object PUT", async (t) => {
  const root = await fixture(t);
  const store = new MemoryStore();
  await seedState(store, emptyState);
  const denied = runtime(root, store, () =>
    candidate(root, "0.1.0", "dev", "denied"),
  );
  denied.authorize = async () => {
    throw new AssetDeliveryError("ASSET_PUBLICATION_DENIED");
  };
  await assert.rejects(
    publishRemote(denied, "dev", { kind: "nightly" }),
    /ASSET_PUBLICATION_DENIED/,
  );
  assert.equal(store.puts, 0);
  assert.equal(await store.read("_control/write-lock.json"), null);
});

test("atomic nightly: failed immutable upload or public verification leaves old state", async (t) => {
  const root = await fixture(t);
  const store = new MemoryStore();
  const old = await candidate(root, "0.1.0", "dev", "old");
  for (const object of [...old.snapshot.objects, old.snapshotRef])
    await store.putFile(
      object.key,
      path.join(root, old.run, "objects", object.key),
    );
  await seedState(store, { ...emptyState, nightly: old.snapshotRef });
  const before = (await store.read("channels/index.json"))!.bytes;
  store.failPut = 3;
  await assert.rejects(
    publishRemote(
      runtime(root, store, () => candidate(root, "0.1.0", "dev", "new")),
      "dev",
      { kind: "nightly" },
    ),
    /ASSET_NETWORK_FAILED/,
  );
  assert.deepEqual((await store.read("channels/index.json"))!.bytes, before);
  store.failPut = null;
  const broken = runtime(root, store, () =>
    candidate(root, "0.1.0", "dev", "newer"),
  );
  broken.verifyPublic = async () => {
    throw new Error("CORS denied");
  };
  await assert.rejects(
    publishRemote(broken, "dev", { kind: "nightly" }),
    /ASSET_NETWORK_FAILED/,
  );
  assert.deepEqual((await store.read("channels/index.json"))!.bytes, before);
});

test("publisher verifies local object bytes before remote upload", async (t) => {
  const root = await fixture(t);
  const store = new MemoryStore();
  await seedState(store, emptyState);
  const next = await candidate(root, "0.1.0", "dev", "stream-check");
  const archive = next.snapshot.objects.find((object) =>
    object.key.endsWith(".zip"),
  )!;
  await writeFile(
    path.join(root, next.run, "objects", archive.key),
    Buffer.alloc(archive.bytes, 0x78),
  );

  await assert.rejects(
    publishRemote(
      runtime(root, store, async () => next),
      "dev",
      { kind: "nightly" },
    ),
    /ASSET_INTEGRITY_FAILED/,
  );
  assert.equal(await store.read(archive.key), null);
});

test("reused immutable objects still require public cache/readability validation", async (t) => {
  const root = await fixture(t);
  const store = new MemoryStore();
  const reused = await candidate(root, "0.1.0", "dev", "reused");
  for (const object of [...reused.snapshot.objects, reused.snapshotRef])
    await store.putFile(
      object.key,
      path.join(root, reused.run, "objects", object.key),
      { cacheControl: "no-store" },
    );
  await seedState(store, emptyState);
  const checked = runtime(root, store, async () => reused);
  checked.verifyPublic = async (object) => {
    const stored = store.objects.get(object.key);
    assert(stored);
    if (stored.cacheControl !== "public,max-age=31536000,immutable")
      throw new AssetDeliveryError("ASSET_INTEGRITY_FAILED", object.key);
  };
  await assert.rejects(
    publishRemote(checked, "dev", { kind: "nightly" }),
    /ASSET_INTEGRITY_FAILED/,
  );
  const state = JSON.parse(
    Buffer.from((await store.read("channels/index.json"))!.bytes).toString(),
  );
  assert.equal(state.nightly, null);
});

test("state change between authorization and lock rejects before object upload", async (t) => {
  const root = await fixture(t);
  const store = new MemoryStore();
  await seedState(store, emptyState);
  store.replaceStateOnLock = true;
  const next = await candidate(root, "0.1.0", "dev", "preflight-race");
  await assert.rejects(
    publishRemote(
      runtime(root, store, async () => next),
      "dev",
      { kind: "nightly" },
    ),
    /ASSET_PUBLICATION_CONFLICT/,
  );
  assert.equal(store.puts, 1);
  for (const object of [...next.snapshot.objects, next.snapshotRef])
    assert.equal(await store.read(object.key), null);
  assert.equal(await store.read("_control/write-lock.json"), null);
});

test("state CAS rejects non-cooperating concurrent mutation", async (t) => {
  const root = await fixture(t);
  const store = new MemoryStore();
  await seedState(store, emptyState);
  store.conflictStateCas = true;
  await assert.rejects(
    publishRemote(
      runtime(root, store, () => candidate(root, "0.1.0", "dev", "cas")),
      "dev",
      { kind: "nightly" },
    ),
    /ASSET_PUBLICATION_CONFLICT/,
  );
  const state = JSON.parse(
    Buffer.from((await store.read("channels/index.json"))!.bytes).toString(),
  );
  assert.equal(state.nightly, null);
});

test("release pointer is create-only; exact retry idempotent; changed target/source rejected", async (t) => {
  const root = await fixture(t);
  const store = new MemoryStore();
  await seedState(store, emptyState);
  const first = await candidate(root, "0.1.0", "all", "release-a");
  await publishRemote(
    runtime(root, store, async () => first),
    "all",
    { kind: "release", version: "0.1.0" },
  );
  const afterFirst = (await store.read("channels/index.json"))!.bytes;
  await publishRemote(
    runtime(root, store, async () => first),
    "all",
    { kind: "release", version: "0.1.0" },
  );
  assert.deepEqual(
    (await store.read("channels/index.json"))!.bytes,
    afterFirst,
  );
  const later = await candidate(root, "0.2.0", "all", "later-release");
  await publishRemote(
    runtime(root, store, async () => later),
    "all",
    { kind: "release", version: "0.2.0" },
  );
  await publishRemote(
    runtime(root, store, async () => first),
    "all",
    { kind: "release", version: "0.1.0" },
  );
  const changed = await candidate(root, "0.1.0", "all", "release-b");
  await assert.rejects(
    publishRemote(
      runtime(root, store, async () => changed),
      "all",
      { kind: "release", version: "0.1.0" },
    ),
    /ASSET_RELEASE_EXISTS/,
  );
  await assert.rejects(
    publishRemote(
      runtime(root, store, async () => first),
      "dev",
      { kind: "release", version: "0.1.0" },
    ),
    /ASSET_RELEASE_EXISTS/,
  );
});

test("loaded release pointer version must match requested version", async () => {
  const store = new MemoryStore();
  const bytes = canonicalBytes({
    schemaVersion: 1,
    version: "0.2.0",
    snapshot: {
      key: `snapshots/${"a".repeat(64)}.json`,
      bytes: 1,
      sha256: "a".repeat(64),
    },
  });
  await store.putBytes("releases/0.1.0.json", bytes);
  await assert.rejects(loadRelease(store, "0.1.0"), /ASSET_INTEGRITY_FAILED/);
});

test("partial nightly preserves same-version target; app version change clears it", async (t) => {
  const root = await fixture(t);
  const store = new MemoryStore();
  await seedState(store, emptyState);
  const both = await candidate(root, "0.1.0", "all", "both");
  await publishRemote(
    runtime(root, store, async () => both),
    "all",
    { kind: "nightly" },
  );
  const prod = both.snapshot.prod;
  const devOnly = await candidate(root, "0.1.0", "dev", "dev-update");
  const merged = await publishRemote(
    runtime(root, store, async () => devOnly),
    "dev",
    { kind: "nightly" },
  );
  assert.deepEqual(merged.snapshot.prod, prod);
  const restored = await publishRemote(
    runtime(root, store, async () => both),
    "all",
    { kind: "nightly" },
  );
  assert.deepEqual(restored.snapshotRef, both.snapshotRef);
  const restoredState = JSON.parse(
    Buffer.from((await store.read("channels/index.json"))!.bytes).toString(),
  );
  assert(
    !restoredState.retiredNightlies.some(
      (entry: { snapshot: ObjectRef }) =>
        entry.snapshot.key === both.snapshotRef.key,
    ),
  );
  const next = await candidate(root, "0.2.0", "dev", "new-version");
  const replaced = await publishRemote(
    runtime(root, store, async () => next),
    "dev",
    { kind: "nightly" },
  );
  assert.equal(replaced.snapshot.prod, null);
});

test("conditional remote lock excludes concurrent publishers and pending prune", async (t) => {
  const root = await fixture(t);
  const store = new MemoryStore();
  await seedState(store, emptyState);
  let unblock!: () => void;
  const gate = new Promise<void>((resolve) => (unblock = resolve));
  let started!: () => void;
  const entered = new Promise<void>((resolve) => (started = resolve));
  const firstRuntime = runtime(root, store, () =>
    candidate(root, "0.1.0", "dev", "first"),
  );
  let verificationStarted = false;
  firstRuntime.verifyPublic = async () => {
    if (!verificationStarted) {
      verificationStarted = true;
      started();
      await gate;
    }
  };
  const first = publishRemote(firstRuntime, "dev", { kind: "nightly" });
  await entered;
  await assert.rejects(
    publishRemote(
      runtime(root, store, () => candidate(root, "0.1.0", "dev", "second")),
      "dev",
      { kind: "nightly" },
    ),
    /ASSET_BUSY/,
  );
  await assert.rejects(
    previewRemotePrune(store, new Date("2026-09-11T00:00:00.000Z")),
    /ASSET_BUSY/,
  );
  unblock();
  await first;
  await store.putBytes(
    "_control/prune-journal.json",
    canonicalBytes({ pending: true }),
  );
  await assert.rejects(
    publishRemote(
      runtime(root, store, () => candidate(root, "0.1.0", "dev", "third")),
      "dev",
      { kind: "nightly" },
    ),
    /ASSET_RECOVERY_REQUIRED/,
  );
});

test("lock release uses owner ETag and preserves a raced replacement", async () => {
  const store = new MemoryStore();
  const replacement = canonicalBytes({
    owner: "replacement-owner",
    startedAt: "2026-09-11T00:00:01.000Z",
  });
  await assert.rejects(
    withRemoteLock(store, new Date("2026-09-11T00:00:00.000Z"), async () => {
      store.objects.set("_control/write-lock.json", {
        bytes: replacement,
        etag: "replacement-etag",
        cacheControl: "no-store",
      });
    }),
    /ASSET_PUBLICATION_CONFLICT/,
  );
  assert.deepEqual(
    (await store.read("_control/write-lock.json"))!.bytes,
    replacement,
  );
});

test("R2 adapter sends conditional delete and maps precondition failure", async () => {
  const config = {
    schemaVersion: 1 as const,
    publicBaseUrl: "https://assets.example/ascencio-assets/v1/",
    bucket: "ascencio-assets",
    keyPrefix: "ascencio-assets/v1/" as const,
  };
  let input: unknown;
  const store = new R2ObjectStore(config, {
    send: async (command: { input: unknown }) => {
      input = command.input;
      return {};
    },
  } as never);
  await store.delete("_control/write-lock.json", { ifMatch: '"owner-etag"' });
  assert.deepEqual(input, {
    Bucket: "ascencio-assets",
    Key: "ascencio-assets/v1/_control/write-lock.json",
    IfMatch: '"owner-etag"',
  });

  const conflicted = new R2ObjectStore(config, {
    send: async () => {
      throw { name: "PreconditionFailed", $metadata: { httpStatusCode: 412 } };
    },
  } as never);
  await assert.rejects(
    conflicted.delete("_control/write-lock.json", {
      ifMatch: '"owner-etag"',
    }),
    RemotePreconditionError,
  );
});

test("remote prune protects young/current/release closures and rejects stale basis before delete", async (t) => {
  const root = await fixture(t);
  const store = new MemoryStore();
  const old = await candidate(root, "0.1.0", "dev", "old");
  const young = await candidate(root, "0.1.0", "dev", "young");
  const current = await candidate(root, "0.1.0", "dev", "current");
  for (const item of [old, young, current]) {
    for (const object of [...item.snapshot.objects, item.snapshotRef])
      await store.putFile(
        object.key,
        path.join(root, item.run, "objects", object.key),
      );
  }
  await seedState(store, {
    schemaVersion: 1,
    nightly: current.snapshotRef,
    releases: [],
    retiredNightlies: [
      { snapshot: old.snapshotRef, retiredAt: "2026-09-09T23:59:59.000Z" },
      { snapshot: young.snapshotRef, retiredAt: "2026-09-10T00:00:01.000Z" },
    ],
  });
  const plan = await previewRemotePrune(
    store,
    new Date("2026-09-11T00:00:00.000Z"),
  );
  assert(plan.candidates.some((entry) => entry.path === old.snapshotRef.key));
  assert(
    !plan.candidates.some((entry) => entry.path === young.snapshotRef.key),
  );
  assert(
    !plan.candidates.some((entry) => entry.path === current.snapshotRef.key),
  );
  const state = JSON.parse(
    Buffer.from((await store.read("channels/index.json"))!.bytes).toString(),
  );
  await seedState(store, { ...state, retiredNightlies: [] });
  await assert.rejects(
    applyRemotePrune(store, plan, new Date("2026-09-11T00:00:00.000Z")),
    /ASSET_PRUNE_STALE/,
  );
  assert(await store.read(old.snapshotRef.key));
  assert.equal(await store.read("_control/prune-journal.json"), null);
});

test("remote prune rejects an ETag replacement between digest and delete", async (t) => {
  const root = await fixture(t);
  const store = new MemoryStore();
  const old = await candidate(root, "0.1.0", "dev", "delete-race");
  for (const object of [...old.snapshot.objects, old.snapshotRef])
    await store.putFile(
      object.key,
      path.join(root, old.run, "objects", object.key),
    );
  await seedState(store, {
    schemaVersion: 1,
    nightly: null,
    releases: [],
    retiredNightlies: [
      { snapshot: old.snapshotRef, retiredAt: "2026-09-09T00:00:00.000Z" },
    ],
  });
  const now = new Date("2026-09-11T00:00:00.000Z");
  const plan = await previewRemotePrune(store, now);
  const raced = plan.candidates[0]!;
  store.replaceBeforeDeleteKey = raced.path;

  await assert.rejects(applyRemotePrune(store, plan, now), /ASSET_PRUNE_STALE/);
  assert.equal((await store.read(raced.path))?.etag, "replacement-etag");
  assert(await store.read("_control/prune-journal.json"));
});

test("remote prune journal records intent before delete and resumes after interruption", async (t) => {
  const root = await fixture(t);
  const store = new MemoryStore();
  const old = await candidate(root, "0.1.0", "dev", "old-resume");
  for (const object of [...old.snapshot.objects, old.snapshotRef])
    await store.putFile(
      object.key,
      path.join(root, old.run, "objects", object.key),
    );
  await seedState(store, {
    schemaVersion: 1,
    nightly: null,
    releases: [],
    retiredNightlies: [
      { snapshot: old.snapshotRef, retiredAt: "2026-09-09T00:00:00.000Z" },
    ],
  });
  const plan = await previewRemotePrune(
    store,
    new Date("2026-09-11T00:00:00.000Z"),
  );
  store.failDeleteAfter = store.deletes + 1;
  await assert.rejects(
    applyRemotePrune(store, plan, new Date("2026-09-11T00:00:00.000Z")),
    /ASSET_NETWORK_FAILED/,
  );
  const journal = await store.read("_control/prune-journal.json");
  assert(journal);
  assert(
    JSON.parse(Buffer.from(journal.bytes).toString()).intentPaths.length >= 1,
  );
  store.failDeleteAfter = null;
  await resumeRemotePrune(store, new Date("2026-09-11T00:00:00.000Z"));
  assert.equal(await store.read("_control/prune-journal.json"), null);
  const state = JSON.parse(
    Buffer.from((await store.read("channels/index.json"))!.bytes).toString(),
  );
  assert.deepEqual(state.retiredNightlies, []);
});
