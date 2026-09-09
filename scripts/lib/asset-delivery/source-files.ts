import { constants } from "node:fs";
import { createHash } from "node:crypto";
import { lstat, open, readdir } from "node:fs/promises";
import type { BigIntStats } from "node:fs";
import {
  assertNoPathCollisions,
  assertSafeParents,
  assertSourcePath,
} from "./path-guards.ts";
import {
  compareCodePoints,
  MAX_METADATA_BYTES,
  parseJsonBytes,
} from "./canonical-json.ts";
import type { FileDigest } from "./file-digest.ts";
import { MAX_ARCHIVE_BYTES } from "./archive-limits.ts";
import { fail } from "./failure.ts";
import { assertNotMigrationTemp } from "./migration-temp.ts";

export async function sourceStat(
  root: string,
  relative: string,
): Promise<BigIntStats | null> {
  try {
    return await lstat(await assertSafeParents(root, relative), {
      bigint: true,
    });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}
export function sameFile(a: BigIntStats, b: BigIntStats): boolean {
  return (
    a.dev === b.dev &&
    a.ino === b.ino &&
    a.size === b.size &&
    a.mtimeNs === b.mtimeNs &&
    a.ctimeNs === b.ctimeNs
  );
}

/** Bounded streaming, handle + pathname identity checks; no media decoding. */
export async function readSource(
  root: string,
  relative: string,
  retainBytes = false,
  observed = false,
): Promise<{ digest: FileDigest; bytes: Uint8Array | null }> {
  const before = await sourceStat(root, relative);
  if (!before)
    fail(
      observed ? "ASSET_SOURCE_CHANGED" : "ASSET_REFERENCE_MISSING",
      relative,
    );
  if (!before.isFile()) fail("ASSET_PATH_UNSAFE", relative);
  const limit = retainBytes ? MAX_METADATA_BYTES : MAX_ARCHIVE_BYTES;
  if (before.size > BigInt(limit)) fail("ASSET_LIMIT_EXCEEDED", relative);
  const file = await assertSafeParents(root, relative);
  let handle;
  try {
    handle = await open(file, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT")
      fail("ASSET_SOURCE_CHANGED", relative);
    if ((error as NodeJS.ErrnoException).code === "ELOOP")
      fail("ASSET_PATH_UNSAFE", relative);
    throw error;
  }
  try {
    if (!sameFile(before, await handle.stat({ bigint: true })))
      fail("ASSET_SOURCE_CHANGED", relative);
    const hash = createHash("sha256");
    const buffer = Buffer.alloc(1024 * 1024);
    const parts: Buffer[] = [];
    let bytes = 0;
    for (;;) {
      const read = await handle.read(buffer, 0, buffer.length, null);
      if (read.bytesRead === 0) break;
      bytes += read.bytesRead;
      if (bytes > limit) fail("ASSET_LIMIT_EXCEEDED", relative);
      if (BigInt(bytes) > before.size) fail("ASSET_SOURCE_CHANGED", relative);
      const chunk = buffer.subarray(0, read.bytesRead);
      hash.update(chunk);
      if (retainBytes) parts.push(Buffer.from(chunk));
    }
    const after = await sourceStat(root, relative);
    if (
      !after ||
      !sameFile(before, after) ||
      !sameFile(before, await handle.stat({ bigint: true })) ||
      BigInt(bytes) !== before.size
    )
      fail("ASSET_SOURCE_CHANGED", relative);
    return {
      digest: { path: relative, bytes, sha256: hash.digest("hex") },
      bytes: retainBytes ? Buffer.concat(parts, bytes) : null,
    };
  } finally {
    await handle.close();
  }
}
export async function digestSource(
  root: string,
  relative: string,
  observed = false,
): Promise<FileDigest> {
  return (await readSource(root, relative, false, observed)).digest;
}
export async function readSourceJson(
  root: string,
  relative: string,
  observed = false,
): Promise<unknown> {
  return parseJsonBytes(
    (await readSource(root, relative, true, observed)).bytes!,
  );
}
export function sameDigest(
  a: Pick<FileDigest, "bytes" | "sha256">,
  b: Pick<FileDigest, "bytes" | "sha256">,
): boolean {
  return a.bytes === b.bytes && a.sha256 === b.sha256;
}

/** Only initially missing roots are empty; validate every entry, including empty directories. */
export async function sourceEntries(
  root: string,
  relative: string,
  observed = false,
): Promise<{ files: string[]; directories: string[] }> {
  const files: string[] = [];
  const directories: string[] = [];
  const spellings = new Map<string, string>();
  const visit = async (entry: string, optional = false): Promise<void> => {
    assertSourcePath(entry);
    assertNotMigrationTemp(entry);
    const folded = entry
      .normalize("NFD")
      .toLowerCase()
      .toUpperCase()
      .normalize("NFD");
    if (spellings.has(folded) && spellings.get(folded) !== entry)
      fail("ASSET_PATH_UNSAFE");
    spellings.set(folded, entry);
    const info = await sourceStat(root, entry);
    if (info === null) {
      if (optional) return;
      fail("ASSET_SOURCE_CHANGED", entry);
    }
    if (info.isFile()) {
      files.push(entry);
      if (files.length > 100_000) fail("ASSET_LIMIT_EXCEEDED");
    } else if (info.isDirectory()) {
      directories.push(entry);
      let children: string[];
      try {
        children = await readdir(await assertSafeParents(root, entry));
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT")
          fail("ASSET_SOURCE_CHANGED", entry);
        throw error;
      }
      for (const child of children.sort(compareCodePoints))
        await visit(`${entry}/${child}`);
    } else fail("ASSET_PATH_UNSAFE", entry);
  };
  await visit(relative, !observed);
  assertNoPathCollisions(files, directories);
  return { files: files.sort(compareCodePoints), directories };
}
export async function sourceFiles(
  root: string,
  relative: string,
  observed = false,
): Promise<string[]> {
  return (await sourceEntries(root, relative, observed)).files;
}
