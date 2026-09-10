import { ZipWriter } from "@zip.js/zip.js";
import { constants } from "node:fs";
import { mkdir, open } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import { MAX_ARCHIVE_BYTES } from "./archive-limits.ts";
import { assertNoPathCollisions, assertSafeParents } from "./path-guards.ts";
import { compareCodePoints } from "./canonical-json.ts";
import { sameDigest, sameFile, sourceStat } from "./source-files.ts";
import { ZipFileReader } from "./zip-file-reader.ts";
import type { FileDigest } from "./file-digest.ts";
import { fail } from "./failure.ts";

export interface ArchiveFile extends FileDigest {
  readonly stagedPath: string;
}
/** STORE overhead includes signed data descriptors and both UTF-8 names. Non-ZIP64 only. */
export function playerArchiveBytes(files: readonly FileDigest[]): number {
  return (
    22 +
    files.reduce(
      (total, f) => total + f.bytes + 92 + 2 * Buffer.byteLength(f.path),
      0,
    )
  );
}
export async function writeArchive(
  root: string,
  destination: string,
  files: readonly ArchiveFile[],
  player = false,
): Promise<FileDigest> {
  assertNoPathCollisions(files.map((f) => f.path));
  const ordered = [...files].sort((a, b) => compareCodePoints(a.path, b.path));
  const limit = player ? 20971520 : MAX_ARCHIVE_BYTES;
  const total = files.reduce((sum, f) => sum + f.bytes, 0);
  if (
    files.length > (player ? 2048 : 100000) ||
    total > (player ? 33554432 : MAX_ARCHIVE_BYTES) ||
    files.some(
      (f) =>
        !Number.isSafeInteger(f.bytes) ||
        f.bytes < 0 ||
        (player && f.bytes > 16777216),
    ) ||
    (player && playerArchiveBytes(files) > limit)
  )
    fail("ASSET_LIMIT_EXCEEDED");
  const absolute = await assertSafeParents(root, destination);
  await mkdir(path.dirname(absolute), { recursive: true });
  const handle = await open(
    await assertSafeParents(root, destination),
    "wx",
    0o600,
  );
  const hash = createHash("sha256");
  let bytes = 0;
  const writer = new ZipWriter(
    new WritableStream<Uint8Array>({
      write: async (chunk) => {
        bytes += chunk.length;
        if (bytes > limit) fail("ASSET_LIMIT_EXCEEDED");
        hash.update(chunk);
        await handle.writeFile(chunk);
      },
    }),
    {
      level: 0,
      bufferedWrite: false,
      dataDescriptor: true,
      dataDescriptorSignature: true,
      useWebWorkers: false,
      useCompressionStream: false,
      useUnicodeFileNames: true,
      rawLastModDate: 0x00210000,
      lastModDate: new Date("1980-01-01T00:00:00Z"),
      extendedTimestamp: false,
      ntfsTimestamp: false,
      msDosCompatible: true,
      versionMadeBy: 20,
      externalFileAttributes: 0,
      internalFileAttributes: 0,
      keepOrder: true,
      ...(player ? { zip64: false } : {}),
    },
  );
  try {
    for (const file of ordered) {
      const before = await sourceStat(root, file.stagedPath);
      if (!before || !before.isFile() || before.size !== BigInt(file.bytes))
        fail("ASSET_INTEGRITY_FAILED", file.path);
      const input = await open(
        await assertSafeParents(root, file.stagedPath),
        constants.O_RDONLY | constants.O_NOFOLLOW,
      );
      try {
        const reader = new ZipFileReader(input, file.bytes);
        const digest = createHash("sha256");
        let consumed = 0;
        const originalRead = reader.readUint8Array.bind(reader);
        reader.readUint8Array = async (offset, length) => {
          if (offset !== consumed) fail("ASSET_INTEGRITY_FAILED", file.path);
          const chunk = await originalRead(offset, length);
          consumed += chunk.length;
          digest.update(chunk);
          return chunk;
        };
        await writer.add(file.path, reader);
        const after = await sourceStat(root, file.stagedPath);
        if (
          !after ||
          !sameFile(before, after) ||
          !sameFile(before, await input.stat({ bigint: true })) ||
          !sameDigest(file, { bytes: consumed, sha256: digest.digest("hex") })
        )
          fail("ASSET_INTEGRITY_FAILED", file.path);
      } finally {
        await input.close();
      }
    }
    await writer.close();
    await handle.sync();
    return { path: destination, bytes, sha256: hash.digest("hex") };
  } finally {
    // Failed run remains private; do not finalize a salvage archive or activate it.
    await handle.close();
  }
}
