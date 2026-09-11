import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs, {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  stat,
  symlink,
  unlink,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { syncBuiltinESMExports } from "node:module";
import { after, mock, test } from "node:test";
import { bundleAssets } from "../scripts/lib/asset-delivery/bundle.ts";
import { canonicalBytes } from "../scripts/lib/asset-delivery/canonical-json.ts";
import type { ObjectRef } from "../scripts/lib/asset-delivery/object-ref.ts";
import { EMPTY_RETAINED_METADATA } from "../scripts/lib/asset-delivery/scan-assets.ts";
import {
  downloadAssets,
  type DownloadDependencies,
} from "../scripts/lib/asset-delivery/download.ts";
import {
  applyLocalPrune,
  LOCAL_PRUNE_JOURNAL_PATH,
  previewLocalPrune,
  resumeLocalPrune,
} from "../scripts/lib/asset-delivery/local-prune.ts";
import { downloadArchive } from "../scripts/lib/asset-delivery/download-transport.ts";
import {
  INSTALL_JOURNAL_PATH,
  INSTALL_RECEIPT_PATH,
  recoverInstallAlreadyLocked,
} from "../scripts/lib/asset-delivery/install-dev-assets.ts";
import { INSTALL_PENDING_TEMP_PATH } from "../scripts/lib/asset-delivery/install-temp.ts";
import { runDownload } from "../scripts/lib/asset-delivery/download-cli.ts";
import { runPrune } from "../scripts/lib/asset-delivery/prune-cli.ts";
import {
  current,
  fixture as bundleFixture,
  put,
} from "./fixtures/asset-delivery-bundle.ts";

const roots: string[] = [];
after(async () => {
  for (const root of roots) await rm(root, { recursive: true, force: true });
});
const digest = (bytes: Uint8Array) =>
  createHash("sha256").update(bytes).digest("hex");

async function destination(): Promise<string> {
  const base = path.resolve(".tmp/ship-t5-20260911");
  await mkdir(base, { recursive: true });
  const root = await mkdtemp(path.join(base, "install-"));
  roots.push(root);
  await put(root, "package.json", '{"version":"0.1.0"}');
  await put(
    root,
    "asset-delivery.config.json",
    canonicalBytes({
      schemaVersion: 1,
      publicBaseUrl: "https://assets.example/ascencio-assets/v1/",
      bucket: "fixture-assets",
      keyPrefix: "ascencio-assets/v1/",
    }),
  );
  return root;
}

interface PublishedFixture {
  readonly fetcher: typeof fetch;
  readonly requests: { url: string; range: string | null }[];
  readonly snapshot: ObjectRef;
  readonly files: readonly { path: string; bytes: number; sha256: string }[];
}

async function published(source: string): Promise<PublishedFixture> {
  const snapshotValue = await bundleAssets(
    source,
    "dev",
    { kind: "nightly" },
    EMPTY_RETAINED_METADATA,
    null,
  );
  const pointer = await current(source);
  const objectRoot = path.join(source, pointer.run, "objects");
  const objects = new Map<string, Uint8Array>();
  for (const ref of [pointer.snapshot, ...snapshotValue.objects])
    objects.set(ref.key, await readFile(path.join(objectRoot, ref.key)));
  const state = canonicalBytes({
    schemaVersion: 1,
    nightly: pointer.snapshot,
    releases: [],
    retiredNightlies: [],
  });
  const manifest = JSON.parse(
    Buffer.from(objects.get(snapshotValue.dev!.key)!).toString("utf8"),
  ) as { files: PublishedFixture["files"] };
  const requests: { url: string; range: string | null }[] = [];
  const fetcher: typeof fetch = async (input, init) => {
    const url = String(input);
    const key = new URL(url).pathname.replace("/ascencio-assets/v1/", "");
    const headers = new Headers(init?.headers);
    const range = headers.get("range");
    requests.push({ url, range });
    const bytes = key === "channels/index.json" ? state : objects.get(key);
    if (!bytes) return new Response(null, { status: 404 });
    const common = {
      etag: `"${digest(bytes)}"`,
      "accept-ranges": "bytes",
      "cache-control":
        key === "channels/index.json"
          ? "no-store"
          : "public,max-age=31536000,immutable",
    };
    if (range) {
      const match = /^bytes=(\d+)-$/.exec(range);
      assert(match);
      const start = Number(match[1]);
      if (start >= bytes.length)
        return new Response(null, { status: 416, headers: common });
      const body = bytes.subarray(start);
      return new Response(Buffer.from(body), {
        status: 206,
        headers: {
          ...common,
          "content-length": String(body.length),
          "content-range": `bytes ${start}-${bytes.length - 1}/${bytes.length}`,
        },
      });
    }
    return new Response(Buffer.from(bytes), {
      status: 200,
      headers: { ...common, "content-length": String(bytes.length) },
    });
  };
  return {
    fetcher,
    requests,
    snapshot: pointer.snapshot,
    files: manifest.files,
  };
}

const dependencies = (fetcher: typeof fetch): DownloadDependencies => ({
  fetcher,
  sleep: async () => undefined,
});

test("fresh anonymous download verifies object chain and restores every archived byte", async () => {
  const source = await bundleFixture();
  const target = await destination();
  const remote = await published(source);

  const result = await downloadAssets(
    target,
    { kind: "nightly" },
    dependencies(remote.fetcher),
  );

  assert.deepEqual(result, {
    status: "ok",
    operation: "download",
    snapshotSha256: remote.snapshot.sha256,
  });
  for (const file of remote.files) {
    const bytes = await readFile(path.join(target, file.path));
    assert.equal(bytes.length, file.bytes);
    assert.equal(digest(bytes), file.sha256);
  }
  const receipt = JSON.parse(
    await readFile(path.join(target, "assets/.install-receipt.json"), "utf8"),
  );
  assert.equal(receipt.snapshotSha256, remote.snapshot.sha256);
  assert.deepEqual(receipt.retired, []);
  assert(
    remote.requests.every((request) =>
      request.url.startsWith("https://assets.example/ascencio-assets/v1/"),
    ),
  );
});

test("repeat is hash-idempotent; edited managed file blocks entire install", async () => {
  const source = await bundleFixture();
  const target = await destination();
  const remote = await published(source);
  await downloadAssets(
    target,
    { kind: "nightly" },
    dependencies(remote.fetcher),
  );
  const chosen = remote.files[0]!;
  const installed = path.join(target, chosen.path);
  const before = (await stat(installed, { bigint: true })).mtimeNs;
  await downloadAssets(
    target,
    { kind: "nightly" },
    dependencies(remote.fetcher),
  );
  assert.equal((await stat(installed, { bigint: true })).mtimeNs, before);

  await writeFile(installed, "local edit");
  const receiptBefore = await readFile(
    path.join(target, "assets/.install-receipt.json"),
  );
  await assert.rejects(
    downloadAssets(target, { kind: "nightly" }, dependencies(remote.fetcher)),
    /ASSET_LOCAL_CONFLICT/,
  );
  assert.equal(await readFile(installed, "utf8"), "local edit");
  assert.deepEqual(
    await readFile(path.join(target, "assets/.install-receipt.json")),
    receiptBefore,
  );
});

test("validated strong ETag resumes partial archive with strict Range", async () => {
  const source = await bundleFixture();
  const target = await destination();
  const remote = await published(source);
  const snapshotBytes = await remote.fetcher(
    `https://assets.example/ascencio-assets/v1/${remote.snapshot.key}`,
  );
  const snapshot = (await snapshotBytes.json()) as { dev: ObjectRef };
  const manifestResponse = await remote.fetcher(
    `https://assets.example/ascencio-assets/v1/${snapshot.dev.key}`,
  );
  const manifest = (await manifestResponse.json()) as { archive: ObjectRef };
  const archiveResponse = await remote.fetcher(
    `https://assets.example/ascencio-assets/v1/${manifest.archive.key}`,
  );
  const archive = new Uint8Array(await archiveResponse.arrayBuffer());
  const cache = path.join(
    target,
    "generated/asset-delivery/downloads",
    manifest.archive.sha256,
  );
  await mkdir(cache, { recursive: true });
  await writeFile(path.join(cache, "archive.part"), archive.subarray(0, 31));
  await writeFile(
    path.join(cache, "download.json"),
    canonicalBytes({
      schemaVersion: 1,
      url: `https://assets.example/ascencio-assets/v1/${manifest.archive.key}`,
      bytes: manifest.archive.bytes,
      sha256: manifest.archive.sha256,
      etag: `"${manifest.archive.sha256}"`,
    }),
  );
  remote.requests.length = 0;

  await downloadAssets(
    target,
    { kind: "nightly" },
    dependencies(remote.fetcher),
  );

  assert(remote.requests.some((request) => request.range === "bytes=31-"));
});

test("removed remote file stays retired until explicit hash-safe local prune", async () => {
  const source = await bundleFixture();
  const target = await destination();
  let remote = await published(source);
  await downloadAssets(
    target,
    { kind: "nightly" },
    dependencies(remote.fetcher),
  );
  const retiredPath = "assets/battle/original.blend";
  await unlink(path.join(source, retiredPath));
  remote = await published(source);
  await downloadAssets(
    target,
    { kind: "nightly" },
    dependencies(remote.fetcher),
  );
  assert.equal(
    await readFile(path.join(target, retiredPath), "utf8"),
    "original",
  );

  const plan = await previewLocalPrune(target);
  assert.deepEqual(
    plan.candidates.map((entry) => entry.path),
    [retiredPath],
  );
  const result = await applyLocalPrune(target, plan);
  assert.deepEqual(result, {
    status: "ok",
    operation: "prune",
    snapshotSha256: remote.snapshot.sha256,
  });
  await assert.rejects(readFile(path.join(target, retiredPath)), /ENOENT/);
  const receipt = JSON.parse(
    await readFile(path.join(target, "assets/.install-receipt.json"), "utf8"),
  );
  assert.deepEqual(receipt.retired, []);
});

test("local prune refuses stale receipt or edited retired bytes before deletion", async () => {
  const source = await bundleFixture();
  const target = await destination();
  let remote = await published(source);
  await downloadAssets(
    target,
    { kind: "nightly" },
    dependencies(remote.fetcher),
  );
  const first = "assets/battle/original.blend";
  const second = "assets/deck-editor/unused.kra";
  await unlink(path.join(source, first));
  await unlink(path.join(source, second));
  remote = await published(source);
  await downloadAssets(
    target,
    { kind: "nightly" },
    dependencies(remote.fetcher),
  );
  const plan = await previewLocalPrune(target);
  await writeFile(path.join(target, second), "user changed retired byte");

  await assert.rejects(applyLocalPrune(target, plan), /ASSET_PRUNE_STALE/);
  assert.equal(await readFile(path.join(target, first), "utf8"), "original");
  assert.equal(
    await readFile(path.join(target, second), "utf8"),
    "user changed retired byte",
  );
});

test("download transport strictly handles restart, range, and integrity responses", async (t) => {
  const payload = Buffer.from("complete archive payload");
  const ref = {
    key: `dev/archives/${digest(payload)}.zip`,
    bytes: payload.length,
    sha256: digest(payload),
  };
  const baseUrl = "https://assets.example/ascencio-assets/v1/";
  const url = new URL(ref.key, baseUrl).href;
  const preparePartial = async (target: string) => {
    const directory = path.join(
      target,
      "generated/asset-delivery/downloads",
      ref.sha256,
    );
    await mkdir(directory, { recursive: true });
    await writeFile(
      path.join(directory, "archive.part"),
      payload.subarray(0, 4),
    );
    await writeFile(
      path.join(directory, "download.json"),
      canonicalBytes({
        schemaVersion: 1,
        url,
        bytes: ref.bytes,
        sha256: ref.sha256,
        etag: '"strong"',
      }),
    );
  };

  await t.test("200 restarts an existing partial from zero", async () => {
    const target = await destination();
    await preparePartial(target);
    const requests: (string | null)[] = [];
    const fetcher: typeof fetch = async (_input, init) => {
      requests.push(new Headers(init?.headers).get("range"));
      return new Response(payload, {
        status: 200,
        headers: {
          etag: '"strong"',
          "content-length": String(payload.length),
        },
      });
    };
    const complete = await downloadArchive(
      target,
      baseUrl,
      ref,
      dependencies(fetcher),
    );
    assert.deepEqual(requests, ["bytes=4-"]);
    assert.deepEqual(await readFile(path.join(target, complete)), payload);
  });

  await t.test("416 performs one clean restart", async () => {
    const target = await destination();
    await preparePartial(target);
    const requests: (string | null)[] = [];
    const fetcher: typeof fetch = async (_input, init) => {
      const range = new Headers(init?.headers).get("range");
      requests.push(range);
      if (range)
        return new Response(null, {
          status: 416,
          headers: { etag: '"strong"' },
        });
      return new Response(payload, {
        status: 200,
        headers: {
          etag: '"strong"',
          "content-length": String(payload.length),
        },
      });
    };
    await downloadArchive(target, baseUrl, ref, dependencies(fetcher));
    assert.deepEqual(requests, ["bytes=4-", null]);
  });

  await t.test(
    "malformed resumed range end fails before cache activation",
    async () => {
      const target = await destination();
      await preparePartial(target);
      const fetcher: typeof fetch = async () =>
        new Response(payload.subarray(4), {
          status: 206,
          headers: {
            etag: '"strong"',
            "content-range": `bytes 4-5/${payload.length}`,
          },
        });
      await assert.rejects(
        downloadArchive(target, baseUrl, ref, dependencies(fetcher)),
        /ASSET_INTEGRITY_FAILED/,
      );
    },
  );

  await t.test(
    "full-body integrity mismatch never activates cache",
    async () => {
      const target = await destination();
      const wrong = Buffer.alloc(payload.length, 1);
      const fetcher: typeof fetch = async () =>
        new Response(wrong, {
          status: 200,
          headers: { "content-length": String(wrong.length) },
        });
      await assert.rejects(
        downloadArchive(target, baseUrl, ref, dependencies(fetcher)),
        /ASSET_INTEGRITY_FAILED/,
      );
    },
  );
});

test("expired nightly re-resolves once while explicit release stays exact", async () => {
  const source = await bundleFixture();
  const target = await destination();
  const remote = await published(source);
  const currentState = await (
    await remote.fetcher(
      "https://assets.example/ascencio-assets/v1/channels/index.json",
    )
  ).json();
  let stateReads = 0;
  const stale = {
    key: `snapshots/${"b".repeat(64)}.json`,
    bytes: 1,
    sha256: "b".repeat(64),
  };
  const fetcher: typeof fetch = async (input, init) => {
    if (new URL(String(input)).pathname.endsWith("/channels/index.json")) {
      stateReads++;
      return new Response(
        Buffer.from(
          canonicalBytes({
            ...(currentState as Record<string, unknown>),
            nightly:
              stateReads === 1
                ? stale
                : (currentState as { nightly: ObjectRef }).nightly,
          }),
        ),
        { status: 200 },
      );
    }
    return remote.fetcher(input, init);
  };

  await downloadAssets(target, { kind: "nightly" }, dependencies(fetcher));
  assert.equal(stateReads, 2);

  const releaseTarget = await destination();
  await assert.rejects(
    downloadAssets(
      releaseTarget,
      { kind: "release", version: "0.1.0" },
      dependencies(remote.fetcher),
    ),
    /ASSET_REVISION_UNAVAILABLE/,
  );
});

test("install temp recovery removes only journal-owned complete bytes", async (t) => {
  const writeCrashState = async (
    target: string,
    tempBytes: Uint8Array,
    identity: "owned" | "unknown",
  ) => {
    const snapshotSha256 = "a".repeat(64);
    const managed = "assets/story/crash.bin";
    const temporary = "assets/story/.i-00000000-0000-0000-0000-000000000000";
    const after = {
      path: managed,
      bytes: 8,
      sha256: digest(Buffer.from("expected")),
    };
    await put(target, temporary, tempBytes);
    const info = await stat(path.join(target, temporary), { bigint: true });
    await put(
      target,
      INSTALL_JOURNAL_PATH,
      canonicalBytes({
        schemaVersion: 1,
        snapshotSha256,
        phase: "applying",
        previousReceipt: null,
        nextReceipt: {
          schemaVersion: 1,
          layoutVersion: 1,
          snapshotSha256,
          files: [after],
          retired: [],
        },
        changes: [{ path: managed, before: null, after }],
      }),
    );
    await put(
      target,
      INSTALL_PENDING_TEMP_PATH,
      canonicalBytes({
        schemaVersion: 1,
        snapshotSha256,
        path: managed,
        temporary,
        identity:
          identity === "owned"
            ? {
                dev: String(info.dev),
                ino: String(info.ino),
                birthtimeNs: String(info.birthtimeNs),
              }
            : null,
      }),
    );
    return temporary;
  };

  await t.test("complete owned temp is removed during rollback", async () => {
    const target = await destination();
    const temporary = await writeCrashState(
      target,
      Buffer.from("expected"),
      "owned",
    );
    await recoverInstallAlreadyLocked(target);
    for (const relative of [
      temporary,
      INSTALL_PENDING_TEMP_PATH,
      INSTALL_JOURNAL_PATH,
    ])
      await assert.rejects(stat(path.join(target, relative)), {
        code: "ENOENT",
      });
  });

  for (const [name, bytes, identity] of [
    ["post-crash edit", Buffer.from("changed!"), "owned"],
    ["unknown collision", Buffer.from("expected"), "unknown"],
  ] as const)
    await t.test(`${name} is preserved`, async () => {
      const target = await destination();
      const temporary = await writeCrashState(target, bytes, identity);
      await assert.rejects(recoverInstallAlreadyLocked(target), {
        message: "ASSET_RECOVERY_REQUIRED",
      });
      assert.deepEqual(await readFile(path.join(target, temporary)), bytes);
    });
});

test("install journal recovers managed rename and receipt commit boundaries", async (t) => {
  const snapshotSha256 = "c".repeat(64);
  const managed = "assets/story/boundary.bin";
  const expected = Buffer.from("installed");
  const after = {
    path: managed,
    bytes: expected.length,
    sha256: digest(expected),
  };
  const nextReceipt = {
    schemaVersion: 1,
    layoutVersion: 1,
    snapshotSha256,
    files: [after],
    retired: [],
  };
  const writeJournal = async (target: string) =>
    put(
      target,
      INSTALL_JOURNAL_PATH,
      canonicalBytes({
        schemaVersion: 1,
        snapshotSha256,
        phase: "applying",
        previousReceipt: null,
        nextReceipt,
        changes: [{ path: managed, before: null, after }],
      }),
    );

  await t.test("rename before receipt rolls back", async () => {
    const target = await destination();
    await put(target, managed, expected);
    await writeJournal(target);
    await recoverInstallAlreadyLocked(target);
    await assert.rejects(stat(path.join(target, managed)), { code: "ENOENT" });
    await assert.rejects(stat(path.join(target, INSTALL_JOURNAL_PATH)), {
      code: "ENOENT",
    });
  });

  await t.test("post-crash managed edit blocks rollback", async () => {
    const target = await destination();
    await put(target, managed, "post-crash edit");
    await writeJournal(target);
    await assert.rejects(recoverInstallAlreadyLocked(target), {
      message: "ASSET_RECOVERY_REQUIRED",
    });
    assert.equal(
      await readFile(path.join(target, managed), "utf8"),
      "post-crash edit",
    );
  });

  await t.test(
    "receipt commit keeps installed bytes and clears journal",
    async () => {
      const target = await destination();
      await put(target, managed, expected);
      await put(target, INSTALL_RECEIPT_PATH, canonicalBytes(nextReceipt));
      await writeJournal(target);
      await recoverInstallAlreadyLocked(target);
      assert.deepEqual(await readFile(path.join(target, managed)), expected);
      await assert.rejects(stat(path.join(target, INSTALL_JOURNAL_PATH)), {
        code: "ENOENT",
      });
    },
  );
});

test("local prune checks missing candidate before durable delete intent", async () => {
  const source = await bundleFixture();
  const target = await destination();
  let remote = await published(source);
  await downloadAssets(
    target,
    { kind: "nightly" },
    dependencies(remote.fetcher),
  );
  const retiredPath = "assets/battle/original.blend";
  await unlink(path.join(source, retiredPath));
  remote = await published(source);
  await downloadAssets(
    target,
    { kind: "nightly" },
    dependencies(remote.fetcher),
  );
  const plan = await previewLocalPrune(target);
  const journal = path.join(target, LOCAL_PRUNE_JOURNAL_PATH);
  const originalRename = fs.rename;
  let removedBeforeIntent = false;
  const fault = mock.method(
    fs,
    "rename",
    async (...args: Parameters<typeof fs.rename>) => {
      await originalRename(...args);
      if (!removedBeforeIntent && args[1] === journal) {
        removedBeforeIntent = true;
        await fs.unlink(path.join(target, retiredPath));
      }
    },
  );
  syncBuiltinESMExports();
  try {
    await assert.rejects(applyLocalPrune(target, plan), {
      message: "ASSET_RECOVERY_REQUIRED",
    });
  } finally {
    fault.mock.restore();
    syncBuiltinESMExports();
  }
  assert(removedBeforeIntent);
  const persisted = JSON.parse(await readFile(journal, "utf8")) as {
    intentPaths: string[];
  };
  assert.deepEqual(persisted.intentPaths, []);
});

test("local prune rejects candidate removed after new durable delete intent", async () => {
  const source = await bundleFixture();
  const target = await destination();
  let remote = await published(source);
  await downloadAssets(
    target,
    { kind: "nightly" },
    dependencies(remote.fetcher),
  );
  const retiredPath = "assets/battle/original.blend";
  await unlink(path.join(source, retiredPath));
  remote = await published(source);
  await downloadAssets(
    target,
    { kind: "nightly" },
    dependencies(remote.fetcher),
  );
  const plan = await previewLocalPrune(target);
  const candidate = path.join(target, retiredPath);
  const journal = path.join(target, LOCAL_PRUNE_JOURNAL_PATH);
  const originalRename = fs.rename;
  let removedAfterIntent = false;
  const fault = mock.method(
    fs,
    "rename",
    async (...args: Parameters<typeof fs.rename>) => {
      await originalRename(...args);
      if (!removedAfterIntent && args[1] === journal) {
        const persisted = JSON.parse(await readFile(journal, "utf8")) as {
          intentPaths: string[];
        };
        if (persisted.intentPaths.includes(retiredPath)) {
          removedAfterIntent = true;
          await fs.unlink(candidate);
        }
      }
    },
  );
  syncBuiltinESMExports();
  try {
    await assert.rejects(applyLocalPrune(target, plan), {
      message: "ASSET_PRUNE_STALE",
    });
  } finally {
    fault.mock.restore();
    syncBuiltinESMExports();
  }
  assert(removedAfterIntent);
});

test("local prune resume accepts candidate missing after prior durable intent", async () => {
  const source = await bundleFixture();
  const target = await destination();
  let remote = await published(source);
  await downloadAssets(
    target,
    { kind: "nightly" },
    dependencies(remote.fetcher),
  );
  const retiredPath = "assets/battle/original.blend";
  await unlink(path.join(source, retiredPath));
  remote = await published(source);
  await downloadAssets(
    target,
    { kind: "nightly" },
    dependencies(remote.fetcher),
  );
  const plan = await previewLocalPrune(target);
  const candidate = path.join(target, retiredPath);
  const originalUnlink = fs.unlink;
  let crashed = false;
  const fault = mock.method(
    fs,
    "unlink",
    async (...args: Parameters<typeof fs.unlink>) => {
      if (!crashed && args[0] === candidate) {
        crashed = true;
        await originalUnlink(...args);
        throw new Error("simulated crash after prune unlink");
      }
      return originalUnlink(...args);
    },
  );
  syncBuiltinESMExports();
  try {
    await assert.rejects(applyLocalPrune(target, plan), {
      message: "simulated crash after prune unlink",
    });
  } finally {
    fault.mock.restore();
    syncBuiltinESMExports();
  }
  assert(crashed);

  assert.deepEqual(await resumeLocalPrune(target), {
    status: "ok",
    operation: "prune",
    snapshotSha256: remote.snapshot.sha256,
  });
  await assert.rejects(stat(candidate), { code: "ENOENT" });
});

test("local prune resume preserves post-crash edits after durable intent", async () => {
  const source = await bundleFixture();
  const target = await destination();
  let remote = await published(source);
  await downloadAssets(
    target,
    { kind: "nightly" },
    dependencies(remote.fetcher),
  );
  const retiredPath = "assets/battle/original.blend";
  await unlink(path.join(source, retiredPath));
  remote = await published(source);
  await downloadAssets(
    target,
    { kind: "nightly" },
    dependencies(remote.fetcher),
  );
  const plan = await previewLocalPrune(target);
  const candidate = path.join(target, retiredPath);
  const originalUnlink = fs.unlink;
  let crashed = false;
  const fault = mock.method(
    fs,
    "unlink",
    async (...args: Parameters<typeof fs.unlink>) => {
      if (!crashed && args[0] === candidate) {
        crashed = true;
        await originalUnlink(...args);
        await fs.writeFile(candidate, "post-crash edit");
        throw new Error("simulated crash after prune unlink");
      }
      return originalUnlink(...args);
    },
  );
  syncBuiltinESMExports();
  try {
    await assert.rejects(applyLocalPrune(target, plan), {
      message: "simulated crash after prune unlink",
    });
  } finally {
    fault.mock.restore();
    syncBuiltinESMExports();
  }
  assert(crashed);
  await assert.rejects(resumeLocalPrune(target), {
    message: "ASSET_RECOVERY_REQUIRED",
  });
  assert.equal(await readFile(candidate, "utf8"), "post-crash edit");
});

test("symlinked managed root rejects archive install without touching target", async () => {
  const source = await bundleFixture();
  const target = await destination();
  const outside = await mkdtemp(path.join(path.dirname(target), "outside-"));
  roots.push(outside);
  await symlink(outside, path.join(target, "assets"));
  const remote = await published(source);

  await assert.rejects(
    downloadAssets(target, { kind: "nightly" }, dependencies(remote.fetcher)),
    /ASSET_PATH_UNSAFE/,
  );
  assert.deepEqual(await fs.readdir(outside), []);
});

test("download and prune CLI help preserve stable exit/result contract", async () => {
  const target = await destination();
  const out: string[] = [];
  const err: string[] = [];
  assert.equal(await runDownload(target, ["--help"], dependencies(fetch)), 0);
  assert.equal(
    await runDownload(
      target,
      ["--help", "--version", "0.1.0"],
      dependencies(fetch),
      out.push.bind(out),
      err.push.bind(err),
    ),
    2,
  );
  assert.match(out.at(-1)!, /"code":"ASSET_ARGUMENT_INVALID"/);
  assert.equal(
    await runPrune(target, ["--help"], out.push.bind(out), err.push.bind(err)),
    0,
  );
  assert.match(out.at(-1)!, /"operation":"prune"/);
});
