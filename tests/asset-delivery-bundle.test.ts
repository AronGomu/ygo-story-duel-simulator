import { frozenSourcePath } from "../scripts/lib/asset-delivery/frozen-source-path.ts";
import assert from "node:assert/strict";
import { cp, readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { ZipReader, Uint8ArrayReader, Uint8ArrayWriter } from "@zip.js/zip.js";
import { bundleAssets } from "../scripts/lib/asset-delivery/bundle.ts";
import { verifyBundle } from "../scripts/lib/asset-delivery/verify-bundle.ts";
import { canonicalBytes } from "../scripts/lib/asset-delivery/canonical-json.ts";
import { EMPTY_RETAINED_METADATA } from "../scripts/lib/asset-delivery/scan-assets.ts";
import { acquireAssetDeliveryLock } from "../scripts/lib/asset-delivery/local-lock.ts";
import {
  contentObjectUrl,
  parseContentIndex,
  parseContentManifest,
} from "../src/content/index.ts";

import {
  sha,
  put,
  fixture,
  prepared,
  current,
} from "./fixtures/asset-delivery-bundle.ts";

test("same inputs across root/order/TZ/channel produce identical bytes; dev originals and core stay separate", async () => {
  const a = await fixture();
  const b = await fixture(true);
  const { chmod, utimes } = await import("node:fs/promises");
  await chmod(path.join(b, "assets/battle/original.blend"), 0o755);
  await utimes(path.join(b, "assets/battle/original.blend"), 123456, 123456);
  await put(
    a,
    "asset-delivery.config.json",
    '{"publicBaseUrl":"https://one.example/"}',
  );
  await put(
    b,
    "asset-delivery.config.json",
    '{"publicBaseUrl":"https://two.example/elsewhere/"}',
  );
  const priorTZ = process.env.TZ;
  try {
    process.env.TZ = "Pacific/Honolulu";
    const first = await bundleAssets(
      a,
      "all",
      { kind: "nightly" },
      EMPTY_RETAINED_METADATA,
      prepared,
    );
    process.env.TZ = "Asia/Tokyo";
    const second = await bundleAssets(
      b,
      "all",
      { kind: "release", version: "0.1.0" },
      EMPTY_RETAINED_METADATA,
      prepared,
    );
    assert.deepEqual(second, first);
    const pointer = await current(a);
    const objects = path.join(a, pointer.run, "objects");
    const other = path.join(b, (await current(b)).run, "objects");
    for (const ref of first.objects) {
      const bytes = await readFile(path.join(objects, ref.key));
      assert.equal(bytes.length, ref.bytes);
      assert.equal(sha(bytes), ref.sha256);
      assert.deepEqual(await readFile(path.join(other, ref.key)), bytes);
    }
    await verifyBundle(a, pointer.run);
    const dev = JSON.parse(
      await readFile(path.join(objects, first.dev!.key), "utf8"),
    );
    const archive = await readFile(path.join(objects, dev.archive.key));
    const reader = new ZipReader(new Uint8ArrayReader(archive));
    const entries = await reader.getEntries();
    assert.deepEqual(
      entries.map((e) => e.filename),
      dev.files.map((f: { path: string }) => f.path),
    );
    assert(entries.some((e) => e.filename.endsWith("original.blend")));
    assert(entries.some((e) => e.filename.endsWith("unused.kra")));
    for (const entry of entries) {
      assert.equal(entry.compressionMethod, 0);
      assert.equal(entry.rawLastModDate, 0x00210000);
      assert.equal(entry.externalFileAttributes, 0);
      assert.equal(entry.directory, false);
      assert.equal(entry.encrypted, false);
      const bytes = await entry.getData!(new Uint8ArrayWriter());
      assert.equal(
        sha(bytes),
        dev.files.find((f: { path: string }) => f.path === entry.filename)
          .sha256,
      );
    }
    await reader.close();
    const indexBytes = await readFile(
      path.join(objects, first.prod!.index.key),
    );
    assert.deepEqual(
      indexBytes,
      await readFile(
        path.join(objects, `content/catalogs/${first.prod!.index.sha256}.json`),
      ),
    );
    const parsed = parseContentIndex(JSON.parse(indexBytes.toString()));
    assert.equal(parsed.kind, "ok");
    if (parsed.kind !== "ok") throw new Error("index parse failed");
    assert.equal(parsed.value.releaseId, `0.1.0+${first.inventory.sha256}`);
    assert.equal(parsed.value.chapters.length, 1);
    for (const ref of first.objects.filter((r) =>
      r.key.startsWith("content/manifests/"),
    )) {
      const manifest = parseContentManifest(
        JSON.parse(await readFile(path.join(objects, ref.key), "utf8")),
      );
      assert.equal(manifest.kind, "ok");
      if (manifest.kind === "ok")
        assert(!manifest.value.files.some((f) => f.path.startsWith("fonts/")));
    }
  } finally {
    if (priorTZ === undefined) delete process.env.TZ;
    else process.env.TZ = priorTZ;
  }
});

test("single public lock, structural prod input, failed candidate preserves current", async () => {
  const root = await fixture();
  await bundleAssets(
    root,
    "dev",
    { kind: "nightly" },
    EMPTY_RETAINED_METADATA,
    null,
  );
  const before = await readFile(
    path.join(root, "generated/asset-delivery/current.json"),
  );
  const release = await acquireAssetDeliveryLock(root);
  try {
    await assert.rejects(
      bundleAssets(
        root,
        "dev",
        { kind: "nightly" },
        EMPTY_RETAINED_METADATA,
        null,
      ),
      /ASSET_BUSY/,
    );
  } finally {
    await release();
  }
  await assert.rejects(
    bundleAssets(
      root,
      "prod",
      { kind: "nightly" },
      EMPTY_RETAINED_METADATA,
      null,
    ),
    /ASSET_TARGET_UNAVAILABLE/,
  );
  await put(root, "assets/story/unsafe.js", "not player code");
  await put(
    root,
    "asset-profiles/chapter-01.json",
    canonicalBytes({
      schemaVersion: 1,
      id: "chapter-01",
      dependsOn: ["runtime"],
      rules: [
        {
          root: "story",
          path: "unsafe.js",
          kind: "file",
          logicalPath: "story/unsafe.js",
        },
      ],
    }),
  );
  await assert.rejects(
    bundleAssets(
      root,
      "all",
      { kind: "nightly" },
      EMPTY_RETAINED_METADATA,
      prepared,
    ),
    /ASSET_ARCHIVE_REJECTED/,
  );
  assert.deepEqual(
    await readFile(path.join(root, "generated/asset-delivery/current.json")),
    before,
  );
});

test("content URL transport accepts exact HTTPS prefix/kind/hash only", () => {
  assert.equal(
    contentObjectUrl(
      "https://assets.example.test/base/",
      "indexes",
      "a".repeat(64),
    ),
    `https://assets.example.test/base/content/indexes/${"a".repeat(64)}.json`,
  );
  for (const base of [
    "http://assets.example/",
    "https://user@assets.example/",
    "https://assets.example/a/../",
    "https://assets.example/?q=x",
    "https://assets.example",
    "https://assets.example/%2f/",
  ])
    assert.throws(() => contentObjectUrl(base, "parts", "a".repeat(64)));
});

test("source mutation during bounded freeze fails; prior current remains readable; no background rejection", async () => {
  const { bundleAlreadyLocked } =
    await import("../scripts/lib/asset-delivery/bundle-locked.ts");
  const { STREAM_CHUNK_BYTES } =
    await import("../scripts/lib/asset-delivery/freeze-file.ts");
  const { open } = await import("node:fs/promises");
  const root = await fixture();
  await bundleAssets(
    root,
    "dev",
    { kind: "nightly" },
    EMPTY_RETAINED_METADATA,
    null,
  );
  const before = await current(root);
  const original = "assets/battle/original.blend";
  const handle = await open(path.join(root, original), "r+");
  await handle.truncate(3 * STREAM_CHUNK_BYTES + 13);
  await handle.close();
  let reads = 0;
  const release = await acquireAssetDeliveryLock(root);
  try {
    await assert.rejects(
      bundleAlreadyLocked(
        root,
        "dev",
        { kind: "nightly" },
        EMPTY_RETAINED_METADATA,
        null,
        {
          onFreezeChunk: async (file, bytes) => {
            assert(bytes <= STREAM_CHUNK_BYTES);
            if (file === original && ++reads === 2)
              await put(root, original, "mutated");
          },
        },
      ),
      /ASSET_SOURCE_CHANGED/,
    );
  } finally {
    await release();
  }
  assert.equal(reads, 2);
  assert.deepEqual(await current(root), before);
  await verifyBundle(root, before.run);
});

test("frozen files are independent; later source edits cannot alter completed candidate", async () => {
  const { stat } = await import("node:fs/promises");
  const root = await fixture();
  const snapshot = await bundleAssets(
    root,
    "dev",
    { kind: "nightly" },
    EMPTY_RETAINED_METADATA,
    null,
  );
  const { run } = await current(root);
  const file = "assets/battle/original.blend";
  assert.notEqual(
    (await stat(path.join(root, file))).ino,
    (await stat(path.join(root, frozenSourcePath(run, file)))).ino,
  );
  await put(root, file, "edited after freeze");
  assert.equal(
    await readFile(path.join(root, frozenSourcePath(run, file)), "utf8"),
    "original",
  );
  assert.deepEqual(await verifyBundle(root, run), snapshot);
});

test("retained release A catalog/manifests/parts stay reachable in release B; no history inference", async () => {
  const root = await fixture();
  const a = await bundleAssets(
    root,
    "prod",
    { kind: "nightly" },
    EMPTY_RETAINED_METADATA,
    prepared,
  );
  const runA = (await current(root)).run;
  const indexA = JSON.parse(
    await readFile(path.join(root, runA, "objects", a.prod!.index.key), "utf8"),
  );
  const refs = [indexA.runtime, indexA.chapters[0].manifest].sort((a, b) =>
    a.sha256.localeCompare(b.sha256),
  );
  const history = {
    schemaVersion: 1 as const,
    catalogs: [{ sha256: a.prod!.index.sha256, bytes: a.prod!.index.bytes }],
    manifests: refs,
  };
  await assert.rejects(
    bundleAssets(root, "prod", { kind: "nightly" }, history, prepared),
    /ASSET_REFERENCE_MISSING/,
  );
  assert.equal((await current(root)).run, runA);
  await cp(
    path.join(root, runA, "objects"),
    path.join(root, "generated/asset-delivery/retained/objects"),
    { recursive: true },
  );
  await put(root, "assets/story/map.png", "release-B art");
  const b = await bundleAssets(
    root,
    "prod",
    { kind: "nightly" },
    history,
    prepared,
  );
  const runB = (await current(root)).run;
  assert.notEqual(b.prod!.index.sha256, a.prod!.index.sha256);
  const objects = new Set(b.objects.map((r) => r.key));
  for (const ref of a.objects.filter((r) => r.key.startsWith("content/"))) {
    assert(objects.has(ref.key), ref.key);
    assert.deepEqual(
      await readFile(path.join(root, runA, "objects", ref.key)),
      await readFile(path.join(root, runB, "objects", ref.key)),
    );
  }
  const indexB = JSON.parse(
    await readFile(path.join(root, runB, "objects", b.prod!.index.key), "utf8"),
  );
  assert.deepEqual(indexB.retainedCatalogs, history.catalogs);
  assert.deepEqual(indexB.retainedManifests, refs);
  const policyManifest = JSON.parse(
    await readFile(
      path.join(
        root,
        runB,
        "objects",
        `content/manifests/${indexB.chapters[0].manifest.sha256}.json`,
      ),
      "utf8",
    ),
  );
  const policy = policyManifest.files.find(
    (f: { path: string }) => f.path === "story/policy/chapter-01.json",
  );
  const reader = new ZipReader(
    new Uint8ArrayReader(
      await readFile(
        path.join(
          root,
          runB,
          "objects",
          `content/parts/${policy.partSha256}.zip`,
        ),
      ),
    ),
  );
  const entry = (await reader.getEntries()).find(
    (e) => e.filename === policy.entry,
  )!;
  assert.equal(entry.directory, false);
  const value = JSON.parse(
    new TextDecoder().decode(await entry.getData!(new Uint8ArrayWriter())),
  );
  assert.deepEqual(value.setIds, prepared.chapters[0]!.setIds);
  await reader.close();
  await verifyBundle(root, runB);
});

test("real 24 MiB player input splits into bounded STORE parts; 16 MiB+1 selected file rejected", async () => {
  const { open } = await import("node:fs/promises");
  const root = await fixture();
  await put(
    root,
    "asset-profiles/chapter-01.json",
    canonicalBytes({
      schemaVersion: 1,
      id: "chapter-01",
      dependsOn: ["runtime"],
      rules: [
        { root: "story", kind: "tree", path: "", logicalPath: "story/media" },
      ],
    }),
  );
  for (const file of ["one.png", "two.png"]) {
    const handle = await open(path.join(root, "assets/story", file), "wx");
    await handle.truncate(12 * 1024 * 1024);
    await handle.close();
  }
  const snapshot = await bundleAssets(
    root,
    "prod",
    { kind: "nightly" },
    EMPTY_RETAINED_METADATA,
    prepared,
  );
  const pointer = await current(root);
  const objectDir = path.join(root, pointer.run, "objects");
  const index = JSON.parse(
    await readFile(path.join(objectDir, snapshot.prod!.index.key), "utf8"),
  );
  const manifest = JSON.parse(
    await readFile(
      path.join(
        objectDir,
        `content/manifests/${index.chapters[0].manifest.sha256}.json`,
      ),
      "utf8",
    ),
  );
  assert.equal(manifest.parts.length, 2);
  for (const part of manifest.parts) {
    assert(part.bytes <= 20971520);
    assert(part.unpackedBytes <= 33554432);
    const reader = new ZipReader(
      new Uint8ArrayReader(
        await readFile(
          path.join(objectDir, `content/parts/${part.sha256}.zip`),
        ),
      ),
    );
    for (const entry of await reader.getEntries())
      assert.equal(entry.zip64, false);
    await reader.close();
  }
  const handle = await open(path.join(root, "assets/story/one.png"), "r+");
  await handle.truncate(16777217);
  await handle.close();
  await assert.rejects(
    bundleAssets(
      root,
      "prod",
      { kind: "nightly" },
      EMPTY_RETAINED_METADATA,
      prepared,
    ),
    /ASSET_LIMIT_EXCEEDED/,
  );
  assert.deepEqual(await current(root), pointer);
});

test("player parsers reject extras, traversal, collisions, dangling parts, chapter-02, limits", () => {
  const h = "b".repeat(64);
  const manifest = {
    schemaVersion: 1,
    packId: "runtime",
    runtimeSnapshotId: h,
    storyContentId: null,
    dependencies: [],
    cardCodes: [1],
    opponentIds: [],
    parts: [{ sha256: h, bytes: 200, unpackedBytes: 1 }],
    files: [
      {
        path: "safe.png",
        entry: "safe.png",
        bytes: 1,
        sha256: h,
        mediaType: "image/png",
        partSha256: h,
      },
    ],
  };
  assert.equal(parseContentManifest(manifest).kind, "ok");
  for (const invalid of [
    { ...manifest, extra: true },
    { ...manifest, packId: "chapter-02" },
    { ...manifest, files: [{ ...manifest.files[0], path: "../unsafe.png" }] },
    { ...manifest, files: [{ ...manifest.files[0], path: "unsafe.js" }] },
    { ...manifest, files: [{ ...manifest.files[0], bytes: 16777217 }] },
    { ...manifest, parts: [] },
    { ...manifest, cardCodes: [2, 1] },
    {
      ...manifest,
      files: [...manifest.files, { ...manifest.files[0], path: "SAFE.png" }],
    },
    { ...manifest, parts: [{ ...manifest.parts[0], bytes: 20971521 }] },
    {
      ...manifest,
      dependencies: [{ packId: "runtime", sha256: h, bytes: 20 }],
    },
  ])
    assert.equal(parseContentManifest(invalid).kind, "failed");
  const index = {
    schemaVersion: 1,
    releaseId: "0.1.0+" + h,
    runtimeSnapshotId: h,
    runtime: { packId: "runtime", sha256: h, bytes: 200 },
    chapters: [{ id: "chapter-01", title: "DM", status: "unreleased" }],
    retainedCatalogs: [],
    retainedManifests: [],
  };
  assert.equal(parseContentIndex(index).kind, "ok");
  assert.equal(
    parseContentIndex({
      ...index,
      chapters: [{ id: "chapter-02", title: "GX", status: "unreleased" }],
    }).kind,
    "failed",
  );
  assert.equal(
    parseContentIndex({
      ...index,
      runtime: { ...index.runtime, bytes: Infinity },
    }).kind,
    "failed",
  );
});

test("ZIP verifier rejects ZIP64 player fixtures, encryption, dirs, extras, undeclared files and CRC faults", async () => {
  const { ZipWriter } = await import("@zip.js/zip.js");
  const { verifyArchive } =
    await import("../scripts/lib/asset-delivery/verify-archive.ts");
  const root = await fixture();
  const file = {
    path: "safe.png",
    bytes: 4,
    sha256: sha(new TextEncoder().encode("data")),
  };
  const cases = [
    { zip64: true },
    { password: "fixture-password" },
    { directory: true },
    { comment: "extra" },
    { lastModDate: new Date("2020-01-01"), rawLastModDate: 0 },
    { extraField: new Map([[0x1234, new Uint8Array([1])]]) },
  ];
  for (const [i, options] of cases.entries()) {
    const writer = new ZipWriter(new Uint8ArrayWriter(), {
      level: 0,
      useWebWorkers: false,
      rawLastModDate: 0x00210000,
      extendedTimestamp: false,
      msDosCompatible: true,
      externalFileAttributes: 0,
      useUnicodeFileNames: true,
    });
    await writer.add(
      file.path,
      new Uint8ArrayReader(new TextEncoder().encode("data")),
      options,
    );
    const bytes = await writer.close();
    const relative = `bad-${i}.zip`;
    await put(root, relative, bytes);
    await assert.rejects(
      verifyArchive(
        root,
        relative,
        {
          key: `content/parts/${sha(bytes)}.zip`,
          bytes: bytes.length,
          sha256: sha(bytes),
        },
        [file],
        true,
      ),
      /ASSET_ARCHIVE_REJECTED/,
    );
  }
  const writer = new ZipWriter(new Uint8ArrayWriter(), {
    level: 0,
    useWebWorkers: false,
    rawLastModDate: 0x00210000,
    extendedTimestamp: false,
    msDosCompatible: true,
    externalFileAttributes: 0,
    useUnicodeFileNames: true,
  });
  await writer.add(
    file.path,
    new Uint8ArrayReader(new TextEncoder().encode("data")),
  );
  const valid = await writer.close();
  await put(root, "valid.zip", valid);
  const ref = {
    key: `content/parts/${sha(valid)}.zip`,
    bytes: valid.length,
    sha256: sha(valid),
  };
  await assert.rejects(
    verifyArchive(root, "valid.zip", ref, [], true),
    /ASSET_ARCHIVE_REJECTED/,
  );
  const bad = Uint8Array.from(valid);
  bad[30 + file.path.length] = bad[30 + file.path.length]! ^ 0xff;
  await put(root, "crc.zip", bad);
  await assert.rejects(
    verifyArchive(root, "crc.zip", { ...ref, bytes: bad.length }, [file], true),
    /ASSET_ARCHIVE_REJECTED|ASSET_INTEGRITY_FAILED/,
  );
});

test("explicit content:catalog preserves duplicate-membership set IDs; pins source bytes; unmapped names fail", async () => {
  const { preparePlayerMetadata } =
    await import("../scripts/lib/asset-delivery/prepare-player.ts");
  const root = await fixture();
  const source = canonicalBytes({
    schemaVersion: 1,
    generatedAt: "2026-09-07T00:00:00Z",
    sets: [
      { name: "One", tcgReleaseDate: "2002-01-01", cards: [{ id: 1 }] },
      { name: "Two", tcgReleaseDate: "2002-01-02", cards: [{ id: 1 }] },
    ],
    cardsWithoutSetMembership: [],
  });
  const shard = canonicalBytes([{ code: 1 }, { code: 2 }]);
  await put(root, "content/authoring/card-set-source.json", source);
  await put(
    root,
    "content/chapter-selections.json",
    canonicalBytes({
      schemaVersion: 1,
      sourceSha256: sha(source),
      chapters: [
        {
          id: "chapter-01",
          title: "DM",
          published: true,
          setNames: ["Two", "One"],
          additionalCardCodes: [],
          opponentIds: ["practice-bot"],
          storyContentId: "prototype-prologue-v1",
        },
      ],
    }),
  );
  await put(
    root,
    "content/authoring/chapter-policy.json",
    canonicalBytes({
      schemaVersion: 1,
      status: "approved-chapter-one-scope",
      sourceSha256: sha(source),
      chapters: [
        { id: "chapter-01", startsOn: "2001-01-01", endsBefore: "2005-05-28" },
      ],
    }),
  );
  await put(
    root,
    "public/story/shop-sets.v1.json",
    canonicalBytes({
      version: 1,
      sets: [
        { id: "one", name: "One" },
        { id: "two", name: "Two" },
      ],
    }),
  );
  await put(root, "assets/shared/data/current/catalog/cards/00.json", shard);
  await put(
    root,
    "assets/shared/data/current/manifest.json",
    canonicalBytes({ schemaVersion: 1 }),
  );
  await put(
    root,
    "assets/shared/runtime/current/manifest.json",
    canonicalBytes({
      schemaVersion: 1,
      snapshotId: "a".repeat(64),
      assets: {
        files: [
          {
            path: "catalog/cards/00.json",
            bytes: shard.length,
            sha256: sha(shard),
          },
        ],
      },
    }),
  );
  const output = await preparePlayerMetadata(root);
  assert.deepEqual(output.chapters[0]!.setIds, ["one", "two"]);
  assert.deepEqual(output.chapters[0]!.cardCodes, [1]);
  assert.deepEqual(output.runtimeCardCodes, [1, 2]);
  assert.equal(output.sourceInputs.length, 7);
  for (const input of output.sourceInputs)
    assert.equal(
      sha(await readFile(path.join(root, input.path))),
      input.sha256,
    );
  const before = await readFile(
    path.join(root, "generated/asset-delivery/prepared-player.json"),
  );
  await put(
    root,
    "public/story/shop-sets.v1.json",
    canonicalBytes({ version: 1, sets: [{ id: "one", name: "One" }] }),
  );
  await assert.rejects(preparePlayerMetadata(root), /ASSET_REFERENCE_MISSING/);
  assert.deepEqual(
    await readFile(
      path.join(root, "generated/asset-delivery/prepared-player.json"),
    ),
    before,
  );
});

test("archive reads are bounded; injected I/O error leaves no active candidate or held lock", async () => {
  const { mock } = await import("node:test");
  const { ZipFileReader } =
    await import("../scripts/lib/asset-delivery/zip-file-reader.ts");
  const { STREAM_CHUNK_BYTES } =
    await import("../scripts/lib/asset-delivery/freeze-file.ts");
  const { open } = await import("node:fs/promises");
  const root = await fixture();
  const input = await open(
    path.join(root, "assets/battle/original.blend"),
    "r+",
  );
  await input.truncate(STREAM_CHUNK_BYTES * 4);
  await input.close();
  const read = ZipFileReader.prototype.readUint8Array;
  let chunks = 0;
  const fault = mock.method(
    ZipFileReader.prototype,
    "readUint8Array",
    async function (
      this: InstanceType<typeof ZipFileReader>,
      offset: number,
      size: number,
    ) {
      assert(size <= STREAM_CHUNK_BYTES);
      if (++chunks === 3)
        throw Object.assign(new Error("injected bounded reader I/O fault"), {
          code: "EIO",
        });
      return read.call(this, offset, size);
    },
  );
  try {
    await assert.rejects(
      bundleAssets(
        root,
        "dev",
        { kind: "nightly" },
        EMPTY_RETAINED_METADATA,
        null,
      ),
      /injected bounded reader I\/O fault/,
    );
  } finally {
    fault.mock.restore();
  }
  assert.equal(chunks, 3);
  await assert.rejects(
    readFile(path.join(root, "generated/asset-delivery/current.json")),
    { code: "ENOENT" },
  );
  const release = await acquireAssetDeliveryLock(root);
  await release();
  await bundleAssets(
    root,
    "dev",
    { kind: "nightly" },
    EMPTY_RETAINED_METADATA,
    null,
  );
});

test("producer dependency graph has no semantic validator, acquisition, or preparation invocation", async () => {
  const visited = new Set<string>();
  const visit = async (file: string): Promise<void> => {
    if (visited.has(file)) return;
    visited.add(file);
    const text = await readFile(file, "utf8");
    assert(
      !/(?<!\.)\b(?:fetch|exec|spawn|inspectSetupRuntime|verifyContentSetup|preparePlayerMetadata)\s*\(/.test(
        text,
      ),
      file,
    );
    for (const match of text.matchAll(
      /(?:from\s*|import\s*\(\s*)["'](\.[^"']+\.ts)["']/g,
    ))
      await visit(path.resolve(path.dirname(file), match[1]!));
  };
  await visit(path.resolve("scripts/bundle-assets.ts"));
  await visit(path.resolve("scripts/content-pack.ts"));
  for (const name of [
    "prepare-player.ts",
    "content-setup-runtime.ts",
    "verify-assets.ts",
    "download-images.ts",
    "vite-runtime-assets.ts",
  ])
    assert(![...visited].some((file) => file.endsWith("/" + name)), name);
});

test("exact closure rejects a correctly hashed unreferenced object, changed object bytes", async () => {
  const root = await fixture();
  const snapshot = await bundleAssets(
    root,
    "dev",
    { kind: "nightly" },
    EMPTY_RETAINED_METADATA,
    null,
  );
  const { run } = await current(root);
  const extra = canonicalBytes({ extra: "not reachable" });
  const extraRef = {
    key: `content/catalogs/${sha(extra)}.json`,
    bytes: extra.length,
    sha256: sha(extra),
  };
  await put(root, `${run}/objects/${extraRef.key}`, extra);
  const changed = canonicalBytes({
    ...snapshot,
    objects: [...snapshot.objects, extraRef].sort((a, b) =>
      a.key.localeCompare(b.key),
    ),
  });
  const ref = {
    key: `snapshots/${sha(changed)}.json`,
    bytes: changed.length,
    sha256: sha(changed),
  };
  await put(root, `${run}/objects/${ref.key}`, changed);
  await put(
    root,
    `${run}/candidate.json`,
    canonicalBytes({ schemaVersion: 1, snapshot: ref }),
  );
  await assert.rejects(verifyBundle(root, run), /ASSET_INTEGRITY_FAILED/);
  const original = canonicalBytes(snapshot);
  await put(
    root,
    `${run}/candidate.json`,
    canonicalBytes({
      schemaVersion: 1,
      snapshot: {
        key: `snapshots/${sha(original)}.json`,
        bytes: original.length,
        sha256: sha(original),
      },
    }),
  );
  await put(
    root,
    `${run}/objects/${snapshot.inventory.key}`,
    canonicalBytes({ wrong: true }),
  );
  await assert.rejects(verifyBundle(root, run), /ASSET_INTEGRITY_FAILED/);
});

test("CLI adapters reject missing target/history, return exact hashes, preserve public pure seam", async () => {
  const { runBundle } =
    await import("../scripts/lib/asset-delivery/bundle-cli.ts");
  const { runContent } =
    await import("../scripts/lib/asset-delivery/content-cli.ts");
  const { mock } = await import("node:test");
  const root = await fixture();
  await put(
    root,
    "generated/asset-delivery/prepared-player.json",
    canonicalBytes(prepared),
  );
  const stdout: string[] = [];
  const stderr: string[] = [];
  const out = mock.method(console, "log", (line: string) => {
    stdout.push(line);
  });
  const err = mock.method(console, "error", (line: string) => {
    stderr.push(line);
  });
  try {
    assert.equal(await runBundle(root, []), 2);
    assert.equal(await runBundle(root, ["--target", "prod"]), 2);
    assert.equal(await runBundle(root, ["--help"]), 0);
    assert.equal(
      await runBundle(root, ["--target", "dev", "--version", "9.9.9"]),
      2,
    );
    assert.equal(
      await runBundle(root, [
        "--target",
        "prod",
        "--empty-history",
        "--retained-metadata",
        "history.json",
      ]),
      2,
    );
    assert.equal(await runContent(root, "pack", ["--empty-history"]), 0);
    const first = JSON.parse(stdout.at(-1)!);
    assert.equal(first.status, "ok");
    assert.match(first.snapshotSha256, /^[a-f0-9]{64}$/);
    assert.equal(await runContent(root, "verify", []), 0);
    assert.equal(
      JSON.parse(stdout.at(-1)!).snapshotSha256,
      first.snapshotSha256,
    );
    await put(root, "generated/asset-delivery/prepared-player.json", "{");
    assert.equal(await runContent(root, "pack", ["--empty-history"]), 2);
    assert.equal(JSON.parse(stdout.at(-1)!).code, "ASSET_TARGET_UNAVAILABLE");
    await put(
      root,
      "generated/asset-delivery/prepared-player.json",
      canonicalBytes(prepared),
    );
    const direct = await bundleAssets(
      root,
      "prod",
      { kind: "nightly" },
      EMPTY_RETAINED_METADATA,
      prepared,
    );
    assert.equal(first.snapshotSha256, sha(canonicalBytes(direct)));
    for (const line of stderr)
      assert.deepEqual(Object.keys(JSON.parse(line)).sort(), [
        "bytes",
        "operation",
        "path",
        "phase",
      ]);
  } finally {
    out.mock.restore();
    err.mock.restore();
  }
});

test("prod verification binds current manifest declarations to frozen prepared metadata", async () => {
  const root = await fixture();
  const snapshot = await bundleAssets(
    root,
    "prod",
    { kind: "nightly" },
    EMPTY_RETAINED_METADATA,
    prepared,
  );
  const { run } = await current(root);
  const read = async (key: string) =>
    JSON.parse(await readFile(path.join(root, run, "objects", key), "utf8"));
  const write = async (prefix: string, value: unknown) => {
    const bytes = canonicalBytes(value);
    const ref = {
      key: `${prefix}/${sha(bytes)}.json`,
      bytes: bytes.length,
      sha256: sha(bytes),
    };
    await put(root, `${run}/objects/${ref.key}`, bytes);
    return ref;
  };
  const index = await read(snapshot.prod!.index.key);
  const runtimeKey = `content/manifests/${index.runtime.sha256}.json`;
  const runtime = await write("content/manifests", {
    ...(await read(runtimeKey)),
    cardCodes: [999],
  });
  const chapterKey = `content/manifests/${index.chapters[0].manifest.sha256}.json`;
  const chapter = await write("content/manifests", {
    ...(await read(chapterKey)),
    dependencies: [
      { packId: "runtime", bytes: runtime.bytes, sha256: runtime.sha256 },
    ],
  });
  const indexValue = {
    ...index,
    runtime: {
      packId: "runtime",
      bytes: runtime.bytes,
      sha256: runtime.sha256,
    },
    chapters: [
      {
        ...index.chapters[0],
        manifest: {
          packId: "chapter-01",
          bytes: chapter.bytes,
          sha256: chapter.sha256,
        },
      },
    ],
  };
  const nextIndex = await write("content/indexes", indexValue);
  const nextCatalog = await write("content/catalogs", indexValue);
  const replacements = new Map([
    [runtimeKey, runtime],
    [chapterKey, chapter],
    [snapshot.prod!.index.key, nextIndex],
    [`content/catalogs/${snapshot.prod!.index.sha256}.json`, nextCatalog],
  ]);
  const changed = {
    ...snapshot,
    prod: { ...snapshot.prod!, index: nextIndex },
    objects: snapshot.objects
      .map((ref) => replacements.get(ref.key) ?? ref)
      .sort((a, b) => a.key.localeCompare(b.key)),
  };
  const ref = await write("snapshots", changed);
  await put(
    root,
    `${run}/candidate.json`,
    canonicalBytes({ schemaVersion: 1, snapshot: ref }),
  );
  await assert.rejects(verifyBundle(root, run), /ASSET_INTEGRITY_FAILED/);
});

test("retained prod A beside new dev B resolves core against A inventory, never newer workspace fonts", async () => {
  const { randomUUID } = await import("node:crypto");
  const root = await fixture();
  const prod = await bundleAssets(
    root,
    "prod",
    { kind: "nightly" },
    EMPTY_RETAINED_METADATA,
    prepared,
  );
  const runA = (await current(root)).run;
  await put(
    root,
    "assets/shared/fonts/test.woff2",
    "later workspace font bytes",
  );
  const dev = await bundleAssets(
    root,
    "dev",
    { kind: "nightly" },
    EMPTY_RETAINED_METADATA,
    null,
  );
  const runB = (await current(root)).run;
  assert.notEqual(dev.inventory.sha256, prod.inventory.sha256);
  const run = `generated/asset-delivery/runs/${randomUUID()}`;
  const objects = new Map(
    [...prod.objects, ...dev.objects].map((ref) => [ref.key, ref]),
  );
  for (const ref of objects.values()) {
    const origin = prod.objects.some((other) => other.key === ref.key)
      ? runA
      : runB;
    await put(
      root,
      `${run}/objects/${ref.key}`,
      await readFile(path.join(root, origin, "objects", ref.key)),
    );
  }
  const snapshot = {
    ...dev,
    prod: prod.prod,
    objects: [...objects.values()].sort((a, b) => a.key.localeCompare(b.key)),
  };
  const bytes = canonicalBytes(snapshot);
  const ref = {
    key: `snapshots/${sha(bytes)}.json`,
    bytes: bytes.length,
    sha256: sha(bytes),
  };
  await put(root, `${run}/objects/${ref.key}`, bytes);
  await put(
    root,
    `${run}/candidate.json`,
    canonicalBytes({ schemaVersion: 1, snapshot: ref }),
  );
  assert.deepEqual(await verifyBundle(root, run), snapshot);
  const core = JSON.parse(
    await readFile(
      path.join(root, run, "objects", prod.prod!.core.key),
      "utf8",
    ),
  );
  assert.deepEqual(core.inventory, prod.inventory);
  assert.equal(core.files[0].sha256, sha(new TextEncoder().encode("font")));
  const reader = new ZipReader(
    new Uint8ArrayReader(
      await readFile(path.join(root, run, "objects", core.archive.key)),
    ),
  );
  const [entry] = await reader.getEntries();
  assert(entry && !entry.directory);
  assert.equal(
    new TextDecoder().decode(await entry.getData!(new Uint8ArrayWriter())),
    "font",
  );
  await reader.close();
});
