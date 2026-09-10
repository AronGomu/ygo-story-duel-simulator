import * as zip from "@zip.js/zip.js";
import { constants } from "node:fs";
import { open } from "node:fs/promises";
import { createHash } from "node:crypto";
import type { FileDigest } from "./file-digest.ts";
import type { ObjectRef } from "./object-ref.ts";
import { ZipFileReader } from "./zip-file-reader.ts";
import { verifyZipStructure } from "./zip-structure.ts";
import { assertNoPathCollisions, assertSafeParents } from "./path-guards.ts";
import { compareCodePoints } from "./canonical-json.ts";
import { MAX_ARCHIVE_BYTES } from "./archive-limits.ts";
import { sameDigest } from "./source-files.ts";
import { fail } from "./failure.ts";

const zipErrors = new Set(
  Object.entries(zip)
    .filter(
      ([name, value]) => name.startsWith("ERR_") && typeof value === "string",
    )
    .map(([, value]) => value),
);
/** Verification only; streamed hash sink, never extracts or installs assets. */
export async function verifyArchive(
  root: string,
  relative: string,
  ref: ObjectRef,
  files: readonly FileDigest[],
  player = false,
  capturePath?: string,
): Promise<Uint8Array | null> {
  const total = files.reduce((sum, f) => sum + f.bytes, 0);
  if (
    ref.bytes > (player ? 20971520 : MAX_ARCHIVE_BYTES) ||
    total > (player ? 33554432 : MAX_ARCHIVE_BYTES) ||
    files.length > (player ? 2048 : 100000)
  )
    fail("ASSET_LIMIT_EXCEEDED");
  assertNoPathCollisions(files.map((f) => f.path));
  const expected = [...files].sort((a, b) => compareCodePoints(a.path, b.path));
  const handle = await open(
    await assertSafeParents(root, relative),
    constants.O_RDONLY | constants.O_NOFOLLOW,
  );
  const source = new ZipFileReader(handle, ref.bytes);
  const reader = new zip.ZipReader(source, {
    useWebWorkers: false,
    useCompressionStream: false,
    checkSignature: true,
    strictness: "strict",
  });
  try {
    await verifyZipStructure(source, player, expected.length);
    let index = 0;
    let captured: Uint8Array | null = null;
    for await (const entry of reader.getEntriesGenerator()) {
      const file = expected[index++];
      if (
        !file ||
        entry.filename !== file.path ||
        entry.directory ||
        entry.symlink ||
        entry.encrypted ||
        !entry.filenameUTF8 ||
        entry.diskNumberStart !== 0 ||
        entry.compressionMethod !== 0 ||
        entry.compressedSize !== file.bytes ||
        entry.uncompressedSize !== file.bytes ||
        entry.rawLastModDate !== 0x00210000 ||
        entry.externalFileAttributes !== 0 ||
        entry.internalFileAttributes !== 0 ||
        entry.comment ||
        (player && entry.zip64) ||
        [...(entry.extraField?.keys() ?? [])].some((key) => key !== 1)
      )
        fail("ASSET_ARCHIVE_REJECTED");
      if (player && file.bytes > 16777216) fail("ASSET_LIMIT_EXCEEDED");
      const hash = createHash("sha256");
      if (file.path === capturePath) {
        if (file.bytes > 32 * 1024 * 1024) fail("ASSET_LIMIT_EXCEEDED");
        captured = new Uint8Array(file.bytes);
      }
      let bytes = 0;
      await entry.getData!(
        new WritableStream<Uint8Array>({
          write(chunk) {
            bytes += chunk.length;
            if (bytes > file.bytes) fail("ASSET_LIMIT_EXCEEDED");
            hash.update(chunk);
            if (file.path === capturePath)
              captured!.set(chunk, bytes - chunk.length);
          },
        }),
        { checkSignature: true, strictness: "strict" },
      );
      if (!sameDigest(file, { bytes, sha256: hash.digest("hex") }))
        fail("ASSET_INTEGRITY_FAILED");
    }
    if (index !== expected.length || reader.comment?.length)
      fail("ASSET_ARCHIVE_REJECTED");
    return captured;
  } catch (error) {
    if (error instanceof Error && zipErrors.has(error.message))
      fail("ASSET_ARCHIVE_REJECTED");
    throw error;
  } finally {
    try {
      await reader.close();
    } finally {
      await handle.close();
    }
  }
}
