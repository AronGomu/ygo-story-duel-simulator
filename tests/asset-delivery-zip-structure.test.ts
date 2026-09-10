import assert from "node:assert/strict";
import test from "node:test";
import { ZipWriter, Uint8ArrayWriter, Uint8ArrayReader } from "@zip.js/zip.js";
import { fixture, put, sha } from "./fixtures/asset-delivery-bundle.ts";
import { verifyArchive } from "../scripts/lib/asset-delivery/verify-archive.ts";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { bundleAssets } from "../scripts/lib/asset-delivery/bundle.ts";
import { verifyBundle } from "../scripts/lib/asset-delivery/verify-bundle.ts";
import { EMPTY_RETAINED_METADATA } from "../scripts/lib/asset-delivery/scan-assets.ts";
import { current } from "./fixtures/asset-delivery-bundle.ts";
import { rehashGraph } from "./fixtures/asset-delivery-rehash.ts";

async function archive(zip64 = false): Promise<Buffer> {
  const writer = new ZipWriter(new Uint8ArrayWriter(), {
    zip64,
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
  await writer.add("safe.png", new Uint8ArrayReader(Buffer.from("data")));
  return Buffer.from(await writer.close());
}
function localExtra(input: Buffer, extra: Buffer): Buffer {
  const start = 30 + input.readUInt16LE(26);
  const result = Buffer.concat([
    input.subarray(0, start),
    extra,
    input.subarray(start),
  ]);
  result.writeUInt16LE(extra.length, 28);
  result.writeUInt32LE(
    input.readUInt32LE(input.length - 6) + extra.length,
    result.length - 6,
  );
  let central = input.readUInt32LE(input.length - 6) + extra.length;
  while (result.readUInt32LE(central) === 0x02014b50) {
    const offset = result.readUInt32LE(central + 42);
    if (offset > 0) result.writeUInt32LE(offset + extra.length, central + 42);
    central +=
      46 +
      result.readUInt16LE(central + 28) +
      result.readUInt16LE(central + 30) +
      result.readUInt16LE(central + 32);
  }
  return result;
}
function envelope64(input: Buffer): Buffer {
  const end = input.length - 22;
  const records = Buffer.alloc(76);
  records.writeUInt32LE(0x06064b50);
  records.writeBigUInt64LE(44n, 4);
  records.writeUInt16LE(45, 12);
  records.writeUInt16LE(45, 14);
  records.writeBigUInt64LE(1n, 24);
  records.writeBigUInt64LE(1n, 32);
  records.writeBigUInt64LE(BigInt(input.readUInt32LE(end + 12)), 40);
  records.writeBigUInt64LE(BigInt(input.readUInt32LE(end + 16)), 48);
  records.writeUInt32LE(0x07064b50, 56);
  records.writeBigUInt64LE(BigInt(end), 64);
  records.writeUInt32LE(1, 72);
  const eocd = Buffer.from(input.subarray(end));
  eocd.fill(0xff, 4, 20);
  return Buffer.concat([input.subarray(0, end), records, eocd]);
}
test("R1 strict ZIP rejects archive-level ZIP64 and local-only optional structures", async (t) => {
  const root = await fixture();
  const valid = await archive();
  const timestamp = Buffer.from(valid);
  timestamp.writeUInt32LE(0x00210001, 10);
  const digital = Buffer.alloc(7);
  digital.writeUInt32LE(0x05054b50);
  digital.writeUInt16LE(1, 4);
  const signed = Buffer.concat([
    valid.subarray(0, -22),
    digital,
    valid.subarray(-22),
  ]);
  const sizedSignature = Buffer.from(signed);
  sizedSignature.writeUInt32LE(
    valid.readUInt32LE(valid.length - 10) + digital.length,
    sizedSignature.length - 10,
  );
  const cases = [
    ["archive ZIP64", envelope64(valid)],
    ["local timestamp", timestamp],
    [
      "local unknown extra",
      localExtra(valid, Buffer.from([0x34, 0x12, 1, 0, 1])),
    ],
    [
      "local malformed extra",
      localExtra(valid, Buffer.from([0x34, 0x12, 8, 0, 1])),
    ],
    ["local trailing extra byte", localExtra(valid, Buffer.from([1]))],
    ["local unnecessary ZIP64", localExtra(valid, Buffer.from([1, 0, 0, 0]))],
    ["central digital signature", signed],
    ["central sized digital signature", sizedSignature],
    ["trailing bytes", Buffer.concat([valid, Buffer.from([0])])],
  ] as const;
  const file = { path: "safe.png", bytes: 4, sha256: sha(Buffer.from("data")) };
  for (const [name, bytes] of cases)
    await t.test(name, async () => {
      await put(root, "hostile.zip", bytes);
      await assert.rejects(
        verifyArchive(
          root,
          "hostile.zip",
          {
            key: `content/parts/${sha(bytes)}.zip`,
            bytes: bytes.length,
            sha256: sha(bytes),
          },
          [file],
          true,
        ),
        { message: "ASSET_ARCHIVE_REJECTED" },
      );
    });
  for (const zip64 of [false, true])
    await t.test(`dev ZIP64=${zip64}`, async () => {
      const bytes = await archive(zip64);
      await put(root, "dev.zip", bytes);
      await verifyArchive(
        root,
        "dev.zip",
        {
          key: `dev/archives/${sha(bytes)}.zip`,
          bytes: bytes.length,
          sha256: sha(bytes),
        },
        [file],
      );
    });
});

test("R1 full rehashed dev bundle rejects local-only optional ZIP extra", async () => {
  const root = await fixture();
  const snapshot = await bundleAssets(
    root,
    "dev",
    { kind: "nightly" },
    EMPTY_RETAINED_METADATA,
    null,
  );
  const { run } = await current(root);
  const dev = JSON.parse(
    await readFile(path.join(root, run, "objects", snapshot.dev!.key), "utf8"),
  );
  const bytes = localExtra(
    await readFile(path.join(root, run, "objects", dev.archive.key)),
    Buffer.from([0x34, 0x12, 1, 0, 1]),
  );
  const ref = {
    key: `dev/archives/${sha(bytes)}.zip`,
    bytes: bytes.length,
    sha256: sha(bytes),
  };
  await put(root, `${run}/objects/${ref.key}`, bytes);
  await rehashGraph(root, run, snapshot, (prefix, value) => {
    if (prefix === "dev/manifests") value.archive = ref;
    if (prefix === "snapshots")
      value.objects = (value.objects as { key: string }[]).map((object) =>
        object.key === dev.archive.key ? ref : object,
      );
  });
  await assert.rejects(verifyBundle(root, run), {
    message: "ASSET_ARCHIVE_REJECTED",
  });
});
