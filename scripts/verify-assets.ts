import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { listFiles, sha256File } from "./lib/files.ts";
import {
  CATALOG_SHARD_COUNT,
  SCRIPT_SHARD_COUNT,
  type AssetManifest,
  type CardTextRecord,
  type EngineCardRecord,
  type ImageRecord,
  type SystemStrings,
} from "./lib/model.ts";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(scriptDirectory, "..");
const outputArgument = readOutputArgument(process.argv.slice(2));
const root = path.resolve(projectRoot, outputArgument);
const manifest = await readJson<AssetManifest>(path.join(root, "manifest.json"));
const failures: string[] = [];

const digestPath = path.join(root, "manifest.sha256");
try {
  const declaredDigest = (await readFile(digestPath, "utf8")).trim().split(/\s+/)[0];
  const actualDigest = await sha256File(path.join(root, "manifest.json"));
  if (declaredDigest !== actualDigest) {
    failures.push("manifest.json SHA-256 mismatch");
  }
} catch (error) {
  failures.push(`manifest.sha256: ${(error as Error).message}`);
}

if (manifest.schemaVersion !== 1) {
  failures.push(`Unsupported manifest schema: ${manifest.schemaVersion}`);
}
if (manifest.sharding.catalog !== CATALOG_SHARD_COUNT) {
  failures.push(`Unexpected catalog shard count: ${manifest.sharding.catalog}`);
}
if (manifest.sharding.scripts !== SCRIPT_SHARD_COUNT) {
  failures.push(`Unexpected script shard count: ${manifest.sharding.scripts}`);
}

const expectedFiles = new Set(manifest.files.map((file) => file.path));
const actualFiles = new Set(
  (await listFiles(root))
    .map((file) => path.relative(root, file).replaceAll(path.sep, "/"))
    .filter((file) => file !== "manifest.json" && file !== "manifest.sha256"),
);
for (const extra of [...actualFiles].filter((file) => !expectedFiles.has(file))) {
  failures.push(`Unmanifested generated file: ${extra}`);
}
for (const missing of [...expectedFiles].filter((file) => !actualFiles.has(file))) {
  failures.push(`Manifest references missing file: ${missing}`);
}

for (const file of manifest.files) {
  const absolute = path.join(root, file.path);
  try {
    const fileStat = await stat(absolute);
    if (fileStat.size !== file.bytes) {
      failures.push(`${file.path}: expected ${file.bytes} bytes, found ${fileStat.size}`);
      continue;
    }
    const hash = await sha256File(absolute);
    if (hash !== file.sha256) {
      failures.push(`${file.path}: SHA-256 mismatch`);
    }
  } catch (error) {
    failures.push(`${file.path}: ${(error as Error).message}`);
  }
}

const cards = await readShards<EngineCardRecord>(root, "catalog/cards", CATALOG_SHARD_COUNT);
const texts = await readShards<CardTextRecord>(root, "catalog/texts/en", CATALOG_SHARD_COUNT);
const images = await readShards<ImageRecord>(root, "images", CATALOG_SHARD_COUNT);
const strings = await readJson<SystemStrings>(path.join(root, "strings", "en.json"));
const scriptIndex = await readJson<{
  official: string[];
  preRelease: string[];
  globals: string[];
  shardCount: number;
}>(path.join(root, "scripts", "index.json"));
const globalScripts = await readJson<Record<string, string>>(
  path.join(root, "scripts", "globals.json"),
);

checkCount("cards", cards.length, manifest.counts.cards);
checkCount("texts", texts.length, manifest.counts.texts);
checkCount("images", images.length, manifest.counts.imageRecords);
checkCount("official scripts", scriptIndex.official.length, manifest.counts.officialScripts);
checkCount(
  "pre-release scripts",
  scriptIndex.preRelease.length,
  manifest.counts.preReleaseScripts,
);
checkCount("global scripts", scriptIndex.globals.length, manifest.counts.globalScripts);
checkCount("system strings", Object.keys(strings.system).length, manifest.counts.systemStrings);
checkCount("victory strings", Object.keys(strings.victory).length, manifest.counts.victoryStrings);
checkCount("counter strings", Object.keys(strings.counter).length, manifest.counts.counterStrings);
checkCount("set-name strings", Object.keys(strings.setname).length, manifest.counts.setNameStrings);

const cardCodes = new Set(cards.map((card) => card.code));
const textCodes = new Set(texts.map((text) => text.code));
const imageCodes = new Set(images.map((image) => image.code));
checkUnique("card", cardCodes.size, cards.length);
checkUnique("text", textCodes.size, texts.length);
checkUnique("image", imageCodes.size, images.length);
checkSameCodes("text", cardCodes, textCodes);
checkSameCodes("image", cardCodes, imageCodes);

for (const image of images) {
  const expectedSuffix = `/${image.code}.jpg`;
  if (!image.full.endsWith(expectedSuffix) || !image.cropped.endsWith(expectedSuffix)) {
    failures.push(`Image URLs do not match card ${image.code}`);
  }
}

const allIndexedScriptNames = [...scriptIndex.official, ...scriptIndex.preRelease];
const scriptNames = new Set(allIndexedScriptNames);
checkUnique("card script", scriptNames.size, allIndexedScriptNames.length);
const shardedScriptNames = new Set<string>();
for (let shard = 0; shard < SCRIPT_SHARD_COUNT; shard += 1) {
  const shardName = shard.toString(16).padStart(2, "0");
  const scripts = await readJson<Record<string, string>>(
    path.join(root, "scripts", "cards", `${shardName}.json`),
  );
  for (const scriptName of Object.keys(scripts)) {
    if (shardedScriptNames.has(scriptName)) {
      failures.push(`Official script appears in multiple shards: ${scriptName}`);
    }
    shardedScriptNames.add(scriptName);
    const match = /^c(\d+)\.lua$/.exec(scriptName);
    if (!match?.[1]) {
      failures.push(`Unsupported official script filename: ${scriptName}`);
      continue;
    }
    const expectedShard = (Number(match[1]) % SCRIPT_SHARD_COUNT)
      .toString(16)
      .padStart(2, "0");
    if (expectedShard !== shardName) {
      failures.push(`${scriptName}: expected shard ${expectedShard}, found ${shardName}`);
    }
  }
}
for (const scriptName of allIndexedScriptNames) {
  if (!shardedScriptNames.has(scriptName)) {
    failures.push(`Indexed official script is missing from shards: ${scriptName}`);
  }
}
for (const scriptName of shardedScriptNames) {
  if (!scriptNames.has(scriptName)) {
    failures.push(`Sharded official script is missing from index: ${scriptName}`);
  }
}

const indexedGlobals = new Set(scriptIndex.globals);
const packagedGlobals = new Set(Object.keys(globalScripts));
if (
  indexedGlobals.size !== packagedGlobals.size ||
  [...indexedGlobals].some((name) => !packagedGlobals.has(name))
) {
  failures.push("Global script index does not match globals.json");
}
if (!scriptIndex.globals.includes("constant.lua") || !scriptIndex.globals.includes("utility.lua")) {
  failures.push("Global scripts must include constant.lua and utility.lua");
}

if (manifest.sources.imageProvider.redistributionApproved) {
  failures.push("Image redistribution must remain false until explicitly approved");
}

if (failures.length) {
  console.error(
    JSON.stringify(
      {
        status: "failed",
        root,
        generatedAt: manifest.generatedAt,
        sources: manifest.sources,
        failures,
      },
      null,
      2,
    ),
  );
  process.exitCode = 1;
} else {
  console.log(
    JSON.stringify(
      {
        status: "ok",
        root,
        generatedAt: manifest.generatedAt,
        counts: manifest.counts,
      },
      null,
      2,
    ),
  );
}

function readOutputArgument(args: string[]): string {
  if (!args.length) {
    return "generated/assets/current";
  }
  if (args.length === 2 && args[0] === "--output" && args[1]) {
    return args[1];
  }
  throw new Error("Usage: node scripts/verify-assets.ts [--output <directory>]");
}

async function readJson<T>(filePath: string): Promise<T> {
  return JSON.parse(await readFile(filePath, "utf8")) as T;
}

async function readShards<T>(
  rootDirectory: string,
  relativeDirectory: string,
  shardCount: number,
): Promise<T[]> {
  const records: T[] = [];
  for (let shard = 0; shard < shardCount; shard += 1) {
    const name = shard.toString(16).padStart(2, "0");
    records.push(
      ...(await readJson<T[]>(path.join(rootDirectory, relativeDirectory, `${name}.json`))),
    );
  }
  return records;
}

function checkCount(label: string, actual: number, expected: number): void {
  if (actual !== expected) {
    failures.push(`${label}: expected ${expected}, found ${actual}`);
  }
}

function checkUnique(label: string, unique: number, total: number): void {
  if (unique !== total) {
    failures.push(`${label} IDs/names are not unique: ${unique} unique for ${total} records`);
  }
}

function checkSameCodes(label: string, expected: Set<number>, actual: Set<number>): void {
  const missing = [...expected].filter((code) => !actual.has(code));
  const extra = [...actual].filter((code) => !expected.has(code));
  if (missing.length || extra.length) {
    failures.push(
      `${label} coverage mismatch: ${missing.length} missing, ${extra.length} extra`,
    );
  }
}
