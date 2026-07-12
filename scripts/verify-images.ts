import { readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { validJpegFileSize } from "./lib/images.ts";
import { CATALOG_SHARD_COUNT, type ImageRecord } from "./lib/model.ts";
import { resolveProjectSubpath } from "./lib/paths.ts";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(scriptDirectory, "..");
const assetRoot = resolveProjectSubpath(
  projectRoot,
  "generated/assets/current",
  "generated/assets",
  "asset root",
);
const archiveRoot = resolveProjectSubpath(
  projectRoot,
  "generated/card-images/archive",
  "generated/card-images",
  "image archive",
);
const imageRoot = path.join(archiveRoot, "full");
const report = JSON.parse(
  await readFile(path.join(archiveRoot, "download-report.json"), "utf8"),
) as {
  requested: number;
  failed: number;
  unavailable: Array<{ code: number; status: "missing" | "failed" }>;
};

const expectedCodes = new Set<number>();
for (let shard = 0; shard < CATALOG_SHARD_COUNT; shard += 1) {
  const name = shard.toString(16).padStart(2, "0");
  const records = JSON.parse(
    await readFile(path.join(assetRoot, "images", `${name}.json`), "utf8"),
  ) as ImageRecord[];
  for (const record of records) {
    expectedCodes.add(record.code);
  }
}

const archivedCodes = new Set<number>();
const failures: string[] = [];
for (const entry of await readdir(imageRoot, { withFileTypes: true })) {
  if (!entry.isFile() || !/^\d+\.jpg$/.test(entry.name)) {
    failures.push(`Unexpected image archive entry: ${entry.name}`);
    continue;
  }
  const code = Number(entry.name.slice(0, -4));
  archivedCodes.add(code);
  if (!expectedCodes.has(code)) {
    failures.push(`Image is not present in the current card catalog: ${entry.name}`);
  }
  const imagePath = path.join(imageRoot, entry.name);
  if ((await validJpegFileSize(imagePath)) === null) {
    failures.push(`Invalid or truncated JPEG: ${entry.name}`);
  }
}

const missingCodes = [...expectedCodes].filter((code) => !archivedCodes.has(code)).sort((a, b) => a - b);
const reportedMissing = new Set(
  report.unavailable.filter((item) => item.status === "missing").map((item) => item.code),
);
if (report.requested !== expectedCodes.size) {
  failures.push(`Download report covers ${report.requested} of ${expectedCodes.size} cards`);
}
if (report.failed !== 0) {
  failures.push(`Download report still contains ${report.failed} transient failures`);
}
if (
  missingCodes.length !== reportedMissing.size ||
  missingCodes.some((code) => !reportedMissing.has(code))
) {
  failures.push(
    `Archive/report missing-image mismatch: ${missingCodes.length} absent, ${reportedMissing.size} reported`,
  );
}

const result = {
  status: failures.length ? "failed" : "ok",
  catalogImages: expectedCodes.size,
  archivedImages: archivedCodes.size,
  providerMissing: missingCodes.length,
  archiveBytes: await directoryBytes(imageRoot),
  failures,
};
console.log(JSON.stringify(result, null, 2));
if (failures.length) {
  process.exitCode = 1;
}

async function directoryBytes(directory: string): Promise<number> {
  let bytes = 0;
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.isFile() && entry.name.endsWith(".jpg")) {
      bytes += (await stat(path.join(directory, entry.name))).size;
    }
  }
  return bytes;
}
