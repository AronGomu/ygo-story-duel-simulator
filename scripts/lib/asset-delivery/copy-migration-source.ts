import { constants } from "node:fs";
import { createHash } from "node:crypto";
import { open, type FileHandle } from "node:fs/promises";
import { assertSafeParents } from "./path-guards.ts";
import { sourceStat, sameFile } from "./source-files.ts";
import type { MigrationPlan } from "./migration-plan.ts";
import { fail } from "./failure.ts";

/** Never reopen/truncate/unlink the owned destination; write errors leave partial bytes. */
export async function copyMigrationSource(
  root: string,
  file: MigrationPlan["files"][number],
  destination: FileHandle,
): Promise<void> {
  const before = await sourceStat(root, file.from);
  if (!before) fail("ASSET_SOURCE_CHANGED", file.from);
  if (!before.isFile()) fail("ASSET_PATH_UNSAFE", file.from);
  if (before.size !== BigInt(file.bytes))
    fail("ASSET_SOURCE_CHANGED", file.from);
  let source;
  try {
    source = await open(
      await assertSafeParents(root, file.from),
      constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0),
    );
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT") fail("ASSET_SOURCE_CHANGED", file.from);
    if (code === "ELOOP") fail("ASSET_PATH_UNSAFE", file.from);
    throw error;
  }
  try {
    if (!sameFile(before, await source.stat({ bigint: true })))
      fail("ASSET_SOURCE_CHANGED", file.from);
    const buffer = Buffer.alloc(1024 * 1024);
    const hash = createHash("sha256");
    let copied = 0;
    for (;;) {
      const { bytesRead } = await source.read(buffer, 0, buffer.length, copied);
      if (bytesRead === 0) break;
      if (copied + bytesRead > file.bytes)
        fail("ASSET_SOURCE_CHANGED", file.from);
      hash.update(buffer.subarray(0, bytesRead));
      let written = 0;
      while (written < bytesRead) {
        const { bytesWritten } = await destination.write(
          buffer,
          written,
          bytesRead - written,
          copied + written,
        );
        if (bytesWritten === 0) fail("ASSET_RECOVERY_REQUIRED", file.to);
        written += bytesWritten;
      }
      copied += bytesRead;
    }
    const after = await sourceStat(root, file.from);
    if (
      !after ||
      !sameFile(before, after) ||
      !sameFile(before, await source.stat({ bigint: true })) ||
      copied !== file.bytes ||
      hash.digest("hex") !== file.sha256
    )
      fail("ASSET_SOURCE_CHANGED", file.from);
  } finally {
    await source.close();
  }
}
