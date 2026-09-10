import assert from "node:assert/strict";
import test, { mock } from "node:test";
import { cp, readFile } from "node:fs/promises";
import {
  ZipReader,
  ZipWriter,
  Uint8ArrayReader,
  Uint8ArrayWriter,
} from "@zip.js/zip.js";
import { sha } from "./fixtures/asset-delivery-bundle.ts";
import path from "node:path";
import {
  fixture,
  put,
  prepared,
  current,
} from "./fixtures/asset-delivery-bundle.ts";
import { rehashGraph } from "./fixtures/asset-delivery-rehash.ts";
import { bundleAssets } from "../scripts/lib/asset-delivery/bundle.ts";
import { verifyBundle } from "../scripts/lib/asset-delivery/verify-bundle.ts";
import { runContent } from "../scripts/lib/asset-delivery/content-cli.ts";
import { canonicalBytes } from "../scripts/lib/asset-delivery/canonical-json.ts";
import { EMPTY_RETAINED_METADATA } from "../scripts/lib/asset-delivery/scan-assets.ts";

function relabel(_prefix: string, value: Record<string, unknown>): void {
  const replace = (item: unknown): unknown => {
    if (item === prepared.runtimeSnapshotId) return "b".repeat(64);
    if (Array.isArray(item)) return item.map(replace);
    if (item && typeof item === "object")
      return Object.fromEntries(
        Object.entries(item).map(([key, next]) => [key, replace(next)]),
      );
    return item;
  };
  Object.assign(value, replace(value));
}
test("R2 fully rehashed current runtime A-to-B relabel rejects embedded A", async () => {
  const root = await fixture();
  const snapshot = await bundleAssets(
    root,
    "prod",
    { kind: "nightly" },
    EMPTY_RETAINED_METADATA,
    prepared,
  );
  const { run } = await current(root);
  await rehashGraph(root, run, snapshot, relabel);
  await assert.rejects(verifyBundle(root, run), {
    message: "ASSET_INTEGRITY_FAILED",
  });
});
test("R2 archived runtime schemaVersion is checked after full object rehash", async () => {
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
  const index = await read(snapshot.prod!.index.key);
  const runtime = await read(`content/manifests/${index.runtime.sha256}.json`);
  const oldPart = runtime.parts[0];
  const payload = canonicalBytes({
    schemaVersion: 2,
    snapshotId: prepared.runtimeSnapshotId,
  });
  const digest = { bytes: payload.length, sha256: sha(payload) };
  const reader = new ZipReader(
    new Uint8ArrayReader(
      await readFile(
        path.join(root, run, "objects", `content/parts/${oldPart.sha256}.zip`),
      ),
    ),
  );
  const writer = new ZipWriter(new Uint8ArrayWriter(), {
    zip64: false,
    level: 0,
    dataDescriptor: true,
    dataDescriptorSignature: true,
    rawLastModDate: 0x00210000,
    extendedTimestamp: false,
    ntfsTimestamp: false,
    useWebWorkers: false,
    useUnicodeFileNames: true,
    msDosCompatible: true,
    versionMadeBy: 20,
    externalFileAttributes: 0,
    internalFileAttributes: 0,
  });
  let unpackedBytes = 0;
  try {
    for (const entry of await reader.getEntries()) {
      assert.equal(entry.directory, false);
      const bytes =
        entry.filename === "runtime/current/manifest.json"
          ? payload
          : await entry.getData!(new Uint8ArrayWriter());
      unpackedBytes += bytes.length;
      await writer.add(entry.filename, new Uint8ArrayReader(bytes));
    }
  } finally {
    await reader.close();
  }
  const bytes = await writer.close();
  const ref = {
    key: `content/parts/${sha(bytes)}.zip`,
    bytes: bytes.length,
    sha256: sha(bytes),
  };
  await put(root, `${run}/objects/${ref.key}`, bytes);
  await rehashGraph(root, run, snapshot, (prefix, value) => {
    if (prefix === "inventories")
      value.files = (value.files as { path: string }[]).map((file) =>
        file.path === "assets/shared/runtime/manifest.json"
          ? { ...file, ...digest }
          : file,
      );
    if (prefix === "content/manifests" && value.packId === "runtime") {
      value.parts = [{ bytes: ref.bytes, sha256: ref.sha256, unpackedBytes }];
      value.files = (value.files as { path: string }[]).map((file) => ({
        ...file,
        ...(file.path === "runtime/current/manifest.json" ? digest : {}),
        partSha256: ref.sha256,
      }));
    }
    if (prefix === "snapshots")
      value.objects = (value.objects as { key: string }[]).map((object) =>
        object.key === `content/parts/${oldPart.sha256}.zip` ? ref : object,
      );
  });
  await assert.rejects(verifyBundle(root, run), {
    message: "ASSET_INTEGRITY_FAILED",
  });
});

test("R2 retained runtime declarations bind archived manifest without workspace fallback", async () => {
  const root = await fixture();
  const first = await bundleAssets(
    root,
    "prod",
    { kind: "nightly" },
    EMPTY_RETAINED_METADATA,
    prepared,
  );
  const { run } = await current(root);
  const ref = await rehashGraph(root, run, first, relabel);
  const altered = JSON.parse(
    await readFile(path.join(root, run, "objects", ref.key), "utf8"),
  );
  const index = JSON.parse(
    await readFile(
      path.join(root, run, "objects", altered.prod.index.key),
      "utf8",
    ),
  );
  await cp(
    path.join(root, run, "objects"),
    path.join(root, "generated/asset-delivery/retained/objects"),
    { recursive: true },
  );
  await assert.rejects(
    bundleAssets(
      root,
      "prod",
      { kind: "nightly" },
      {
        schemaVersion: 1,
        catalogs: [
          {
            bytes: altered.prod.index.bytes,
            sha256: altered.prod.index.sha256,
          },
        ],
        manifests: [index.runtime],
      },
      prepared,
    ),
    { message: "ASSET_INTEGRITY_FAILED" },
  );
  assert.equal((await current(root)).run, run);
});
test("R4 fully rehashed reversed inventory/dev/core arrays reject noncanonical metadata", async (t) => {
  for (const selected of [
    "inventories",
    "dev/manifests",
    "core/manifests",
    "inventory+dev",
    "inventory+core",
  ])
    await t.test(selected, async () => {
      const root = await fixture();
      await put(root, "assets/shared/fonts/second.woff2", "second font");
      const target =
        selected === "inventory+dev"
          ? "dev"
          : selected === "inventory+core"
            ? "prod"
            : "all";
      const snapshot = await bundleAssets(
        root,
        target,
        { kind: "nightly" },
        EMPTY_RETAINED_METADATA,
        target === "dev" ? null : prepared,
      );
      const { run } = await current(root);
      await rehashGraph(root, run, snapshot, (prefix, value) => {
        if (
          prefix === selected ||
          (selected === "inventory+dev" &&
            ["inventories", "dev/manifests"].includes(prefix)) ||
          (selected === "inventory+core" &&
            ["inventories", "core/manifests"].includes(prefix))
        )
          (value.files as unknown[]).reverse();
      });
      await assert.rejects(verifyBundle(root, run), {
        message: "ASSET_CONFIG_INVALID",
      });
    });
});
test("R3 current pointer validates schema/run/ref and binds actual candidate; explicit --run independent", async (t) => {
  const root = await fixture();
  await bundleAssets(
    root,
    "dev",
    { kind: "nightly" },
    EMPTY_RETAINED_METADATA,
    null,
  );
  const original = { schemaVersion: 1, ...(await current(root)) };
  const outputs: string[] = [];
  const out = mock.method(console, "log", (line: string) => outputs.push(line));
  const err = mock.method(console, "error", () => {});
  try {
    const cases = [
      ["schema", { ...original, schemaVersion: 2 }, "ASSET_CONFIG_INVALID"],
      ["extra", { ...original, extra: true }, "ASSET_CONFIG_INVALID"],
      ["run", { ...original, run: 3 }, "ASSET_PATH_UNSAFE"],
      [
        "run namespace",
        { ...original, run: "generated/other" },
        "ASSET_PATH_UNSAFE",
      ],
      [
        "SHA",
        { ...original, snapshot: { ...original.snapshot, sha256: "bad" } },
        "ASSET_CONFIG_INVALID",
      ],
      [
        "bytes",
        {
          ...original,
          snapshot: {
            ...original.snapshot,
            bytes: original.snapshot.bytes + 1,
          },
        },
        "ASSET_INTEGRITY_FAILED",
      ],
      [
        "role",
        {
          ...original,
          snapshot: {
            ...original.snapshot,
            key: original.snapshot.key.replace("snapshots/", "inventories/"),
          },
        },
        "ASSET_CONFIG_INVALID",
      ],
      [
        "candidate mismatch",
        {
          ...original,
          snapshot: {
            key: `snapshots/${"c".repeat(64)}.json`,
            sha256: "c".repeat(64),
            bytes: 1,
          },
        },
        "ASSET_INTEGRITY_FAILED",
      ],
    ] as const;
    for (const [name, pointer, code] of cases)
      await t.test(name, async () => {
        await put(
          root,
          "generated/asset-delivery/current.json",
          canonicalBytes(pointer),
        );
        assert.equal(await runContent(root, "verify", []), 2);
        assert.equal(JSON.parse(outputs.at(-1)!).code, code);
        assert.equal(
          await runContent(root, "verify", ["--run", original.run]),
          0,
        );
      });
    await put(
      root,
      "generated/asset-delivery/current.json",
      canonicalBytes(original),
    );
    assert.equal(await runContent(root, "verify", []), 0);
  } finally {
    out.mock.restore();
    err.mock.restore();
  }
});
