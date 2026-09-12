import { ASSET_SOURCES } from "./lib/asset-roots.ts";
import { mkdir, readdir, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { resolveProjectSubpath } from "./lib/paths.ts";
import { writeJsonAtomic } from "./lib/run-lock.ts";
import { acquireAssetDeliveryLock } from "./lib/asset-delivery/local-lock.ts";
import type { SetImageDownload } from "./lib/set-images.ts";
import {
  buildSetImageManifest,
  resolveSetImageSources,
  setImageFileName,
} from "./lib/set-images.ts";
import { loadChapterOneContentSource } from "./lib/chapter-content-source.ts";
import {
  assertSelectedNullImageIds,
  fetchBoundedSetIndex,
  fetchSetImageBytes,
} from "./lib/set-image-acquisition.ts";

/* ADR-052. Acquires the shop set art the visual novel renders. The bytes are
   pinned by the sha256 manifest this writes; `scripts/verify-set-images.ts`
   re-hashes them, and a set the upstream index has no image for is recorded
   rather than treated as a failure. */

/* YGOPRODeck documents a 20-request/second ceiling; one image every 100 ms
   stays an order of magnitude inside it for this archive. */
const REQUEST_INTERVAL_MS = 100;

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(scriptDirectory, "..");
const outputRoot = resolveProjectSubpath(
  projectRoot,
  ASSET_SOURCES.setImages.source,
  path.posix.dirname(ASSET_SOURCES.setImages.source),
  "set image output",
);
const releaseRunLock = await acquireAssetDeliveryLock(projectRoot);

try {
  const chapter = await loadChapterOneContentSource(projectRoot);
  const upstream = await fetchBoundedSetIndex();
  const requestedSets = new Map(
    [...chapter.shopSets, ...chapter.sets].map(({ id, name }) => [
      id,
      { id, name },
    ]),
  );
  const sources = resolveSetImageSources([...requestedSets.values()], upstream);
  const selectedIds = new Set(chapter.sets.map(({ id }) => id));
  assertSelectedNullImageIds(
    sources,
    selectedIds,
    chapter.unavailableSetImageIds,
  );

  await mkdir(outputRoot, { recursive: true });
  const downloads: SetImageDownload[] = [];
  for (const source of sources) {
    if (source.sourceUrl === null) {
      if (!selectedIds.has(source.setId))
        throw new Error(
          `Unselected set image has no provider source: ${source.setId}`,
        );
      downloads.push({ ...source, bytes: null });
      continue;
    }
    await sleep(REQUEST_INTERVAL_MS);
    downloads.push({
      ...source,
      bytes: await fetchSetImageBytes(source.sourceUrl),
    });
  }

  const manifest = buildSetImageManifest(downloads);
  for (const download of downloads) {
    if (download.bytes === null) continue;
    await writeFileAtomic(
      path.join(outputRoot, setImageFileName(download.setId)),
      download.bytes,
    );
  }
  await removeUnlistedImages(manifest.files.map((file) => file.setId));
  await writeJsonAtomic(path.join(outputRoot, "manifest.json"), manifest);

  console.log(
    JSON.stringify(
      {
        status: "ok",
        sets: sources.length,
        downloaded: manifest.files.length,
        missing: manifest.missing,
        bytes: manifest.files.reduce((total, file) => total + file.bytes, 0),
        output: path
          .relative(projectRoot, outputRoot)
          .replaceAll(path.sep, "/"),
        failures: [],
      },
      null,
      2,
    ),
  );
} finally {
  await releaseRunLock();
}

/* Remove only files absent from merged prior + selected manifest. */
async function removeUnlistedImages(setIds: readonly string[]): Promise<void> {
  const listed = new Set(setIds.map((setId) => setImageFileName(setId)));
  listed.add("manifest.json");
  for (const entry of await readdir(outputRoot, { withFileTypes: true })) {
    if (!entry.isFile() || listed.has(entry.name)) continue;
    await rm(path.join(outputRoot, entry.name), { force: true });
  }
}

async function writeFileAtomic(
  filePath: string,
  bytes: Uint8Array,
): Promise<void> {
  const temporary = `${filePath}.tmp-${process.pid}`;
  await writeFile(temporary, bytes);
  await rm(filePath, { force: true });
  await rename(temporary, filePath);
}

function sleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
