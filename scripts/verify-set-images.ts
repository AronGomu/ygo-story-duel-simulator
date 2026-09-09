import { ASSET_SOURCES } from "./lib/asset-roots.ts";
import { readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { sha256File } from "./lib/files.ts";
import {
  IMAGE_CONTENT_LOCK_FILE,
  parseImageContentLock,
  verifyLockedSetImages,
} from "./lib/image-content-lock.ts";
import { resolveProjectSubpath } from "./lib/paths.ts";
import type { SetImageFile, SetImageManifest } from "./lib/set-images.ts";
import { verifySetImageManifest } from "./lib/set-images.ts";

/* ADR-052. Re-hashes the acquired shop set art against the manifest
   `scripts/download-set-images.ts` wrote. Reads only the local archive, so it
   is the offline half of the pipeline and runs inside `npm run assets:verify`. */

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(scriptDirectory, "..");
const imageRoot = resolveProjectSubpath(
  projectRoot,
  ASSET_SOURCES.setImages.source,
  path.posix.dirname(ASSET_SOURCES.setImages.source),
  "set image archive",
);
const manifest = JSON.parse(
  await readManifest(path.join(imageRoot, "manifest.json")),
) as SetImageManifest;

const failures: string[] = [];
const filesOnDisk: SetImageFile[] = [];
for (const entry of await readdir(imageRoot, { withFileTypes: true })) {
  if (entry.name === "manifest.json") continue;
  const filePath = path.join(imageRoot, entry.name);
  if (!entry.isFile() || !entry.name.endsWith(".jpg")) {
    failures.push(`Unexpected set image archive entry: ${entry.name}`);
    continue;
  }
  filesOnDisk.push({
    fileName: entry.name,
    bytes: (await stat(filePath)).size,
    sha256: await sha256File(filePath),
  });
}
const verification = verifySetImageManifest(manifest, filesOnDisk);
failures.push(...verification.failures);

/* Audit F16b. The manifest above was written by the downloader from these same
   bytes, so it cannot tell art refreshed upstream from art substituted there.
   The tracked lock can: it is checked in, and only `npm run assets:lock`
   rewrites it. */
const lock = parseImageContentLock(
  JSON.parse(
    await readFile(path.join(projectRoot, IMAGE_CONTENT_LOCK_FILE), "utf8"),
  ) as unknown,
);
failures.push(...verifyLockedSetImages(lock, filesOnDisk));

console.log(
  JSON.stringify(
    {
      status: failures.length ? "failed" : "ok",
      sets: manifest.files.length,
      missing: manifest.missing.length,
      archiveBytes: filesOnDisk.reduce((total, file) => total + file.bytes, 0),
      failures,
    },
    null,
    2,
  ),
);
if (failures.length) {
  process.exitCode = 1;
}

async function readManifest(manifestPath: string): Promise<string> {
  try {
    return await readFile(manifestPath, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    throw new Error(
      `Set image manifest is missing: ${path.relative(projectRoot, manifestPath).replaceAll(path.sep, "/")}. Run \`npm run assets:sets\`.`,
    );
  }
}
