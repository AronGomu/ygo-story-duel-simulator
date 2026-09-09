import { ASSET_SOURCES } from "./lib/asset-roots.ts";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readCappedResponseBody } from "./lib/capped-response-body.ts";
import { isJpeg, validJpegFileSize } from "./lib/images.ts";
import { CATALOG_SHARD_COUNT, type ImageRecord } from "./lib/model.ts";
import { resolveProjectSubpath } from "./lib/paths.ts";
import { acquireAssetDeliveryLock } from "./lib/asset-delivery/local-lock.ts";
import {
  collectShopCodes,
  mergeShopImageRecords,
} from "./lib/shop-set-image-codes.ts";
import { loadDeckSources } from "../src/battle/duel/presets/deck-sources-node.ts";
import { reviewedCardPool } from "../src/battle/duel/presets/reviewed-card-pool.ts";

/* The biggest of the 14,579 files in the local card archive is 330,480 bytes,
   so this clears legitimate art by roughly 25x. It exists because an endless
   upstream body has no ceiling otherwise: `arrayBuffer()` allocates outside the
   V8 heap, and reached 15.7 GB RSS in one 15 s fetch window when measured. */
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(scriptDirectory, "..");
const options = parseOptions(process.argv.slice(2));
const assetRoot = resolveProjectSubpath(
  projectRoot,
  options.assetDirectory,
  path.posix.dirname(ASSET_SOURCES.data.source),
  "--assets",
);
const imageRoot = resolveProjectSubpath(
  projectRoot,
  options.outputDirectory,
  path.posix.dirname(path.posix.dirname(ASSET_SOURCES.fullImages.source)),
  "--output",
);
const selectedImageRoot = path.join(imageRoot, options.kind);
const reportPath = path.join(
  projectRoot,
  "generated/card-images/archive",
  options.kind === "full"
    ? "download-report.json"
    : options.active
      ? "cropped-active-download-report.json"
      : "cropped-download-report.json",
);
const releaseRunLock = await acquireAssetDeliveryLock(projectRoot);

try {
  await mkdir(selectedImageRoot, { recursive: true });
  const shopJson = await readFile(
    path.join(projectRoot, "public/story/shop-sets.v1.json"),
    "utf8",
  );
  const manifestRecords = await readImageManifest(assetRoot);
  let records = mergeShopImageRecords(
    manifestRecords,
    collectShopCodes(shopJson),
  );
  if (options.active) {
    const activeCodes = new Set(reviewedCardPool(await loadDeckSources()));
    records = records.filter(({ code }) => activeCodes.has(code));
  }
  records = records.slice(0, options.limit);
  const limiter = createRateLimiter(options.requestsPerSecond);
  const queue = [...records];
  const results: DownloadResult[] = [];
  let completed = 0;

  await Promise.all(
    Array.from({ length: options.concurrency }, async () => {
      while (queue.length) {
        const record = queue.shift();
        if (!record) {
          return;
        }
        const result = await downloadCardImage(
          record,
          selectedImageRoot,
          limiter,
          options.force,
          options.kind,
        );
        results.push(result);
        completed += 1;
        if (completed % 100 === 0 || completed === records.length) {
          emit({
            operation: "downloadImages",
            status: "progress",
            completed,
            total: records.length,
            downloaded: results.filter((item) => item.status === "downloaded")
              .length,
            cached: results.filter((item) => item.status === "cached").length,
            missing: results.filter((item) => item.status === "missing").length,
            failed: results.filter((item) => item.status === "failed").length,
          });
        }
      }
    }),
  );

  results.sort((left, right) => left.code - right.code);
  const report = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    sourceAssets: path
      .relative(projectRoot, assetRoot)
      .replaceAll(path.sep, "/"),
    output: path
      .relative(projectRoot, selectedImageRoot)
      .replaceAll(path.sep, "/"),
    requested: records.length,
    downloaded: results.filter((result) => result.status === "downloaded")
      .length,
    cached: results.filter((result) => result.status === "cached").length,
    missing: results.filter((result) => result.status === "missing").length,
    failed: results.filter((result) => result.status === "failed").length,
    unavailable: results.filter(
      (result) => result.status === "missing" || result.status === "failed",
    ),
  };
  await mkdir(path.dirname(reportPath), { recursive: true });
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");

  console.log(
    JSON.stringify(
      { status: report.failed ? "partial" : "ok", ...report },
      null,
      2,
    ),
  );
  if (report.failed) {
    process.exitCode = 1;
  }
} finally {
  await releaseRunLock();
}

interface DownloadOptions {
  assetDirectory: string;
  outputDirectory: string;
  concurrency: number;
  requestsPerSecond: number;
  limit: number;
  force: boolean;
  kind: "full" | "cropped";
  active: boolean;
}

type DownloadResult =
  | { code: number; status: "downloaded" | "cached"; bytes: number }
  | { code: number; status: "missing"; httpStatus: number }
  | { code: number; status: "failed"; error: string };

function parseOptions(args: string[]): DownloadOptions {
  const values = new Map<string, string>();
  let force = false;
  let active = false;

  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--force") {
      force = true;
      continue;
    }
    if (argument === "--active") {
      active = true;
      continue;
    }
    if (!argument?.startsWith("--")) {
      throw new Error(`Unknown argument: ${argument ?? "<missing>"}`);
    }
    const value = args[index + 1];
    if (!value || value.startsWith("--")) {
      throw new Error(`Missing value for ${argument}`);
    }
    values.set(argument, value);
    index += 1;
  }

  const concurrency = positiveInteger(
    values.get("--concurrency") ?? "18",
    "--concurrency",
  );
  const requestsPerSecond = positiveInteger(
    values.get("--requests-per-second") ?? "18",
    "--requests-per-second",
  );
  if (requestsPerSecond > 20) {
    throw new Error(
      "--requests-per-second cannot exceed YGOPRODeck's documented limit of 20",
    );
  }

  const kind = values.get("--kind") ?? "full";
  if (kind !== "full" && kind !== "cropped")
    throw new Error("--kind must be full or cropped");
  if (active && kind !== "cropped")
    throw new Error("--active is only supported with --kind cropped");

  return {
    assetDirectory: values.get("--assets") ?? ASSET_SOURCES.data.source,
    outputDirectory:
      values.get("--output") ??
      path.posix.dirname(ASSET_SOURCES.fullImages.source),
    concurrency,
    requestsPerSecond,
    limit: values.has("--limit")
      ? positiveInteger(values.get("--limit") ?? "", "--limit")
      : Number.POSITIVE_INFINITY,
    force,
    kind,
    active,
  };
}

async function readImageManifest(root: string): Promise<ImageRecord[]> {
  const records: ImageRecord[] = [];
  for (let shard = 0; shard < CATALOG_SHARD_COUNT; shard += 1) {
    const name = shard.toString(16).padStart(2, "0");
    const content = await readFile(
      path.join(root, "images", `${name}.json`),
      "utf8",
    );
    records.push(...(JSON.parse(content) as ImageRecord[]));
  }
  return records.sort((left, right) => left.code - right.code);
}

async function downloadCardImage(
  record: ImageRecord,
  outputRoot: string,
  rateLimit: () => Promise<void>,
  force: boolean,
  kind: "full" | "cropped",
): Promise<DownloadResult> {
  const output = path.join(outputRoot, `${record.code}.jpg`);
  if (!force) {
    const existingBytes = await validJpegFileSize(output);
    if (existingBytes !== null) {
      return { code: record.code, status: "cached", bytes: existingBytes };
    }
  }

  for (let attempt = 1; attempt <= 2; attempt += 1) {
    await rateLimit();
    try {
      const response = await fetch(record[kind], {
        headers: {
          "user-agent": "YGO-Story-Duel-Simulator/0.1 asset importer",
        },
        signal: AbortSignal.timeout(15_000),
      });
      if (response.status === 404) {
        return { code: record.code, status: "missing", httpStatus: 404 };
      }
      if (!response.ok) {
        if (
          attempt < 2 &&
          (response.status === 429 || response.status >= 500)
        ) {
          await sleep(attempt * 1_000);
          continue;
        }
        return {
          code: record.code,
          status: "failed",
          error: `HTTP ${response.status}`,
        };
      }

      const body = await readCappedResponseBody(
        response,
        MAX_IMAGE_BYTES,
        `${record.code}.jpg`,
      );
      if (body.status === "too-large") {
        return { code: record.code, status: "failed", error: body.error };
      }
      const bytes = body.bytes;
      if (!isJpeg(bytes)) {
        return {
          code: record.code,
          status: "failed",
          error: `Expected JPEG, received ${response.headers.get("content-type") ?? "unknown"}`,
        };
      }

      const temporary = `${output}.tmp-${process.pid}`;
      await writeFile(temporary, bytes);
      await rm(output, { force: true });
      await rename(temporary, output);
      return {
        code: record.code,
        status: "downloaded",
        bytes: bytes.byteLength,
      };
    } catch (error) {
      if (attempt < 2) {
        await sleep(attempt * 1_000);
        continue;
      }
      return {
        code: record.code,
        status: "failed",
        error: (error as Error).message,
      };
    }
  }

  return { code: record.code, status: "failed", error: "Retry loop exhausted" };
}

function createRateLimiter(requestsPerSecond: number): () => Promise<void> {
  const interval = Math.ceil(1_000 / requestsPerSecond);
  let nextRequestAt = Date.now();

  return async () => {
    const now = Date.now();
    const scheduledAt = Math.max(now, nextRequestAt);
    nextRequestAt = scheduledAt + interval;
    await sleep(scheduledAt - now);
  };
}

function positiveInteger(value: string, option: string): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error(`${option} must be a positive integer`);
  }
  return parsed;
}

function sleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function emit(event: Record<string, unknown>): void {
  process.stderr.write(
    `${JSON.stringify({ timestamp: new Date().toISOString(), ...event })}\n`,
  );
}
