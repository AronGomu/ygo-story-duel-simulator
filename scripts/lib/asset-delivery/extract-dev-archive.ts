import * as zip from "@zip.js/zip.js";
import { constants } from "node:fs";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, open, rename, unlink } from "node:fs/promises";
import path from "node:path";
import type { FileDigest } from "./file-digest.ts";
import type { ObjectRef } from "./object-ref.ts";
import { ZipFileReader } from "./zip-file-reader.ts";
import { verifyArchive } from "./verify-archive.ts";
import { assertSafeParents } from "./path-guards.ts";
import { compareCodePoints } from "./canonical-json.ts";
import { digestSource, sameDigest } from "./source-files.ts";
import { fail } from "./failure.ts";

async function removeExtractTemp(root: string, temporary: string) {
  try {
    await unlink(await assertSafeParents(root, temporary));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
}

/** Archive digest/structure is verified before any extracted byte reaches staging. */
export async function extractDevArchive(
  root: string,
  archivePath: string,
  archive: ObjectRef,
  files: readonly FileDigest[],
  snapshotSha256: string,
): Promise<string> {
  await verifyArchive(root, archivePath, archive, files);
  const stage = `generated/asset-delivery/install/staged/${snapshotSha256}`;
  const ordered = [...files].sort((a, b) => compareCodePoints(a.path, b.path));
  const handle = await open(
    await assertSafeParents(root, archivePath),
    constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0),
  );
  const source = new ZipFileReader(handle, archive.bytes);
  const reader = new zip.ZipReader(source, {
    useWebWorkers: false,
    useCompressionStream: false,
    checkSignature: true,
    strictness: "strict",
  });
  try {
    let index = 0;
    for await (const entry of reader.getEntriesGenerator()) {
      const expected = ordered[index++];
      if (!expected || entry.filename !== expected.path || entry.directory)
        fail("ASSET_ARCHIVE_REJECTED");
      const destination = `${stage}/${expected.path}`;
      const target = await assertSafeParents(root, destination);
      await mkdir(path.dirname(target), { recursive: true });
      await assertSafeParents(root, destination);
      const temporary = `${destination}.${randomUUID()}.tmp`;
      const output = await open(
        await assertSafeParents(root, temporary),
        "wx",
        0o600,
      );
      let installed = false;
      let bytes = 0;
      const hash = createHash("sha256");
      try {
        await entry.getData!(
          new WritableStream<Uint8Array>({
            write: async (chunk) => {
              bytes += chunk.byteLength;
              if (bytes > expected.bytes)
                fail("ASSET_LIMIT_EXCEEDED", expected.path);
              hash.update(chunk);
              await output.writeFile(chunk);
            },
          }),
          { checkSignature: true, strictness: "strict" },
        );
        await output.sync();
        if (
          !sameDigest(expected, {
            bytes,
            sha256: hash.digest("hex"),
          })
        )
          fail("ASSET_INTEGRITY_FAILED", expected.path);
        await assertSafeParents(root, destination);
        await rename(
          await assertSafeParents(root, temporary),
          await assertSafeParents(root, destination),
        );
        installed = true;
      } finally {
        await output.close();
        if (!installed) await removeExtractTemp(root, temporary);
      }
    }
    if (index !== ordered.length) fail("ASSET_ARCHIVE_REJECTED");
  } finally {
    try {
      await reader.close();
    } finally {
      await handle.close();
    }
  }
  if (!sameDigest(await digestSource(root, archivePath, true), archive))
    fail("ASSET_INTEGRITY_FAILED", archive.key);
  return stage;
}
