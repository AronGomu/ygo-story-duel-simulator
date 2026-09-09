import { ASSET_SOURCES } from "./lib/asset-roots.ts";
import {
  mkdir,
  readFile,
  readdir,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readCappedResponseBody } from "./lib/capped-response-body.ts";
import { isJpeg } from "./lib/images.ts";
import { resolveProjectSubpath } from "./lib/paths.ts";
import { writeJsonAtomic } from "./lib/run-lock.ts";
import { acquireAssetDeliveryLock } from "./lib/asset-delivery/local-lock.ts";
import type {
  SetImageDownload,
  ShopSetIdentity,
  UpstreamSetRecord,
} from "./lib/set-images.ts";
import {
  buildSetImageManifest,
  resolveSetImageSources,
  setImageFileName,
} from "./lib/set-images.ts";

/* ADR-052. Acquires the shop set art the visual novel renders. The bytes are
   pinned by the sha256 manifest this writes; `scripts/verify-set-images.ts`
   re-hashes them, and a set the upstream index has no image for is recorded
   rather than treated as a failure. */

const SET_INDEX_URL = "https://db.ygoprodeck.com/api/v7/cardsets.php";
const USER_AGENT = "YGO-Story-Duel-Simulator/0.1 asset importer";
/* YGOPRODeck documents a 20-request/second ceiling; one image every 100 ms
   stays an order of magnitude inside it for a 50-file archive. */
const REQUEST_INTERVAL_MS = 100;
/* The biggest of the 50 set images on disk is 152,797 bytes, so this clears
   legitimate art by roughly 55x. It exists because an endless upstream body has
   no ceiling otherwise: `arrayBuffer()` allocates outside the V8 heap, and
   reached 15.7 GB RSS in one 15 s fetch window when measured. */
const MAX_SET_IMAGE_BYTES = 8 * 1024 * 1024;

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
  const shop = JSON.parse(
    await readFile(
      path.join(projectRoot, "public/story/shop-sets.v1.json"),
      "utf8",
    ),
  ) as { sets: readonly ShopSetIdentity[] };
  if (!Array.isArray(shop.sets) || shop.sets.length === 0) {
    throw new Error("Shop set list is empty: public/story/shop-sets.v1.json");
  }
  const upstream = await fetchSetIndex();
  const sources = resolveSetImageSources(shop.sets, upstream);

  const downloads: SetImageDownload[] = [];
  const failures: string[] = [];
  for (const source of sources) {
    if (source.sourceUrl === null) {
      downloads.push({ ...source, bytes: null });
      continue;
    }
    await sleep(REQUEST_INTERVAL_MS);
    const result = await downloadSetImage(
      source.sourceUrl,
      setImageFileName(source.setId),
    );
    if (result.status === "downloaded") {
      downloads.push({ ...source, bytes: result.bytes });
      continue;
    }
    if (result.status === "failed") {
      failures.push(`${source.setId}: ${result.error}`);
    }
    downloads.push({ ...source, bytes: null });
  }

  const manifest = buildSetImageManifest(downloads);
  await mkdir(outputRoot, { recursive: true });
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
        status: failures.length ? "partial" : "ok",
        sets: sources.length,
        downloaded: manifest.files.length,
        missing: manifest.missing,
        bytes: manifest.files.reduce((total, file) => total + file.bytes, 0),
        output: path
          .relative(projectRoot, outputRoot)
          .replaceAll(path.sep, "/"),
        failures,
      },
      null,
      2,
    ),
  );
  if (failures.length) {
    process.exitCode = 1;
  }
} finally {
  await releaseRunLock();
}

type SetImageResult =
  | { status: "downloaded"; bytes: Uint8Array }
  | { status: "missing" }
  | { status: "failed"; error: string };

async function fetchSetIndex(): Promise<UpstreamSetRecord[]> {
  const response = await fetch(SET_INDEX_URL, {
    headers: { "user-agent": USER_AGENT },
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} fetching ${SET_INDEX_URL}`);
  }
  const index = (await response.json()) as unknown;
  if (!Array.isArray(index)) {
    throw new Error(`${SET_INDEX_URL} did not return a set list`);
  }
  return index as UpstreamSetRecord[];
}

/** Fetch one set image. HTTP 404 means the upstream record's URL is stale. */
async function downloadSetImage(
  url: string,
  fileName: string,
): Promise<SetImageResult> {
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    try {
      const response = await fetch(url, {
        headers: { "user-agent": USER_AGENT },
        signal: AbortSignal.timeout(15_000),
      });
      if (response.status === 404) return { status: "missing" };
      if (!response.ok) {
        if (
          attempt < 2 &&
          (response.status === 429 || response.status >= 500)
        ) {
          await sleep(attempt * 1_000);
          continue;
        }
        return { status: "failed", error: `HTTP ${response.status}` };
      }
      const body = await readCappedResponseBody(
        response,
        MAX_SET_IMAGE_BYTES,
        fileName,
      );
      if (body.status === "too-large") {
        return { status: "failed", error: body.error };
      }
      const bytes = body.bytes;
      if (!isJpeg(bytes)) {
        return {
          status: "failed",
          error: `Expected JPEG, received ${response.headers.get("content-type") ?? "unknown"}`,
        };
      }
      return { status: "downloaded", bytes };
    } catch (error) {
      if (attempt < 2) {
        await sleep(attempt * 1_000);
        continue;
      }
      return { status: "failed", error: (error as Error).message };
    }
  }
  return { status: "failed", error: "Retry loop exhausted" };
}

/* A set dropped from the shop list would otherwise leave its image behind, and
   verification rejects any file the manifest does not list — including the
   temporary a crashed run left. Re-running acquisition is the repair. */
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
