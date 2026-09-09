import { randomUUID } from "node:crypto";
import { mkdir, open, rename, unlink } from "node:fs/promises";
import path from "node:path";
import { assertSafeParents } from "./path-guards.ts";
import { canonicalBytes } from "./canonical-json.ts";
import { digestSource, sameDigest, sourceStat } from "./source-files.ts";
import type { FileDigest } from "./file-digest.ts";
import { fail } from "./failure.ts";

/** Caller holds common lock. Expected bytes protect read-modify-write metadata. */
export async function replaceMetadata(
  root: string,
  relative: string,
  value: unknown,
  expected?: FileDigest | null,
): Promise<void> {
  const target = await assertSafeParents(root, relative);
  await mkdir(path.dirname(target), { recursive: true });
  const temporary = `${relative}.${randomUUID()}.tmp`;
  const temp = await assertSafeParents(root, temporary);
  const handle = await open(temp, "wx", 0o600);
  let installed = false;
  try {
    try {
      await handle.writeFile(canonicalBytes(value));
      await handle.sync();
    } finally {
      await handle.close();
    }
    await assertSafeParents(root, relative);
    if (expected !== undefined) {
      const current = await sourceStat(root, relative);
      if (
        expected === null
          ? current !== null
          : current === null ||
            !sameDigest(await digestSource(root, relative), expected)
      )
        fail("ASSET_SOURCE_CHANGED", relative);
    }
    await assertSafeParents(root, relative);
    await rename(temp, target);
    installed = true;
  } finally {
    if (!installed) {
      await assertSafeParents(root, temporary);
      await unlink(temp);
    }
  }
}
