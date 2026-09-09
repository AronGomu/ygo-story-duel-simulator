import type { FileDigest } from "./file-digest.ts";
import { assertManagedPath, assertNoPathCollisions } from "./path-guards.ts";
import { fail } from "./failure.ts";

export const MAX_ARCHIVE_BYTES = 16 * 1024 * 1024 * 1024;
export function assertArchiveFiles(
  files: readonly FileDigest[],
  archiveBytes: number,
): void {
  let total = 0;
  if (files.length > 100_000 || archiveBytes > MAX_ARCHIVE_BYTES)
    fail("ASSET_LIMIT_EXCEEDED");
  for (const file of files) {
    assertManagedPath(file.path);
    total += file.bytes;
    if (!Number.isSafeInteger(total) || total > MAX_ARCHIVE_BYTES)
      fail("ASSET_LIMIT_EXCEEDED");
  }
  assertNoPathCollisions(files.map((file) => file.path));
}
