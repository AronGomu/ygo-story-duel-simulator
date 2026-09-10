import { constants, type BigIntStats } from "node:fs";
import { mkdir, open } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import type { FileDigest } from "./file-digest.ts";
import { assertSafeParents } from "./path-guards.ts";
import { sameDigest, sameFile, sourceStat } from "./source-files.ts";
import { fail } from "./failure.ts";

export const STREAM_CHUNK_BYTES = 256 * 1024;
export type StreamObservation = (
  path: string,
  bytes: number,
) => void | Promise<void>;

/** Independent bytes, never hardlinks. Caller owns a fresh private run directory. */
export async function freezeFile(
  root: string,
  source: FileDigest,
  destination: string,
  observed?: BigIntStats,
  onChunk?: StreamObservation,
): Promise<void> {
  const before = await sourceStat(root, source.path);
  if (!before || (observed && !sameFile(observed, before)))
    fail("ASSET_SOURCE_CHANGED", source.path);
  if (!before.isFile()) fail("ASSET_PATH_UNSAFE", source.path);
  if (before.size !== BigInt(source.bytes))
    fail("ASSET_SOURCE_CHANGED", source.path);
  const sourcePath = await assertSafeParents(root, source.path);
  let input;
  try {
    input = await open(sourcePath, constants.O_RDONLY | constants.O_NOFOLLOW);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT")
      fail("ASSET_SOURCE_CHANGED", source.path);
    if ((error as NodeJS.ErrnoException).code === "ELOOP")
      fail("ASSET_PATH_UNSAFE", source.path);
    throw error;
  }
  try {
    if (!sameFile(before, await input.stat({ bigint: true })))
      fail("ASSET_SOURCE_CHANGED", source.path);
    const target = await assertSafeParents(root, destination);
    await mkdir(path.dirname(target), { recursive: true });
    const output = await open(
      await assertSafeParents(root, destination),
      "wx",
      0o600,
    );
    try {
      const buffer = Buffer.alloc(STREAM_CHUNK_BYTES);
      const hash = createHash("sha256");
      let bytes = 0;
      for (;;) {
        const read = await input.read(buffer, 0, buffer.length, null);
        if (read.bytesRead === 0) break;
        bytes += read.bytesRead;
        if (bytes > source.bytes) fail("ASSET_SOURCE_CHANGED", source.path);
        const chunk = buffer.subarray(0, read.bytesRead);
        hash.update(chunk);
        await output.writeFile(chunk);
        await onChunk?.(source.path, read.bytesRead);
      }
      const after = await sourceStat(root, source.path);
      if (
        !after ||
        !sameFile(before, after) ||
        !sameFile(before, await input.stat({ bigint: true })) ||
        !sameDigest(source, { bytes, sha256: hash.digest("hex") })
      )
        fail("ASSET_SOURCE_CHANGED", source.path);
      await output.sync();
    } finally {
      await output.close();
    }
  } finally {
    await input.close();
  }
}
