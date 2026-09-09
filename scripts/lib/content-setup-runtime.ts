import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { fileURLToPath } from "node:url";
import { cardCode } from "../../src/battle/duel/contracts/ids.ts";
import { loadActiveDuelDependencies } from "../../src/battle/worker/assets/active-duel-dependencies.ts";
import {
  parseRuntimeSnapshotManifest,
  type RuntimeManifestFile,
} from "../../src/battle/worker/assets/runtime-manifest.ts";
import {
  deriveRuntimeSnapshotId,
  runtimeAssetContentSha256,
  type AssetManifest,
} from "../../src/battle/worker/assets/runtime-snapshot-node.ts";
import { json, readBounded, record } from "./content-setup-io.ts";
import { CATALOG_SHARD_COUNT, SCRIPT_SHARD_COUNT } from "./model.ts";

// Match browser-runtime-assets.ts private limits; parity tests exercise that loader.
const MAXIMUM_RUNTIME_MANIFEST_BYTES = 1024 * 1024;
const MAXIMUM_ASSET_MANIFEST_BYTES = 2 * 1024 * 1024;
const MAXIMUM_VENDOR_MANIFEST_BYTES = 1024 * 1024;
const MAXIMUM_SNAPSHOT_FILES = 2048;
const MAXIMUM_SNAPSHOT_FILE_BYTES = 16 * 1024 * 1024;
const MAXIMUM_SNAPSHOT_BYTES = 256 * 1024 * 1024;

const ASSET_ROOT = "generated/assets/current";
const VENDOR_ROOT = "vendor/ocgcore-wasm/0.1.2";
const digest = (bytes: Uint8Array) =>
  createHash("sha256").update(bytes).digest("hex");
const decodeJson = (bytes: Uint8Array): unknown =>
  JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));

/** The checked-in frozen manifest, not the inspected root, supplies engine pins. */
export async function inspectSetupRuntime(
  root: string,
): Promise<Set<number> | null> {
  const runtimeValue = await json(
    root,
    "generated/runtime/current/manifest.json",
    MAXIMUM_RUNTIME_MANIFEST_BYTES,
  );
  if (runtimeValue === null) return null;
  const runtime = parseRuntimeSnapshotManifest(runtimeValue);
  if (
    runtime.assets.files.length > MAXIMUM_SNAPSHOT_FILES ||
    runtime.assets.files.some(
      (file) => file.bytes > MAXIMUM_SNAPSHOT_FILE_BYTES,
    ) ||
    runtime.assets.files.reduce((sum, file) => sum + file.bytes, 0) >
      MAXIMUM_SNAPSHOT_BYTES
  )
    return null;
  const assetBytes = await readBounded(
    root,
    `${ASSET_ROOT}/manifest.json`,
    MAXIMUM_ASSET_MANIFEST_BYTES,
  );
  const vendorBytes = await readBounded(
    root,
    `${VENDOR_ROOT}/vendor-manifest.json`,
    MAXIMUM_VENDOR_MANIFEST_BYTES,
  );
  const pinnedBytes = await readBounded(
    fileURLToPath(new URL("../../", import.meta.url)),
    `${VENDOR_ROOT}/vendor-manifest.json`,
    MAXIMUM_VENDOR_MANIFEST_BYTES,
  );
  if (
    assetBytes === null ||
    vendorBytes === null ||
    pinnedBytes === null ||
    !vendorBytes.equals(pinnedBytes)
  )
    return null;
  const assets = decodeJson(assetBytes) as AssetManifest;
  const engine = decodeJson(pinnedBytes) as {
    integrity: string;
    coreVersion: [number, number];
    embeddedCoreRevision: string;
    files: RuntimeManifestFile[];
  };
  if (assets.schemaVersion !== 1) return null;
  const engineManifestSha256 = digest(pinnedBytes);
  const derived = parseRuntimeSnapshotManifest({
    schemaVersion: 1,
    generatedAt: assets.generatedAt,
    snapshotId: deriveRuntimeSnapshotId(
      runtimeAssetContentSha256(assets),
      engineManifestSha256,
    ),
    engine: {
      package: "ocgcore-wasm",
      version: "0.1.2",
      integrity: engine.integrity,
      coreVersion: engine.coreVersion,
      embeddedCoreRevision: engine.embeddedCoreRevision,
      manifestSha256: engineManifestSha256,
    },
    assets: {
      manifestSha256: digest(assetBytes),
      babelCdbRevision: assets.sources.babelCdb.commit,
      cardScriptsRevision: assets.sources.cardScripts.commit,
      distributionRevision: assets.sources.distribution.commit,
      files: assets.files,
    },
  });
  if (!isDeepStrictEqual(runtime, derived)) return null;
  for (const file of engine.files)
    await verifiedBytes(root, `${VENDOR_ROOT}/${file.path}`, file);

  const files = new Map(runtime.assets.files.map((file) => [file.path, file]));
  const required = new Set([
    "scripts/index.json",
    "scripts/globals.json",
    "strings/en.json",
  ]);
  for (const [directory, count] of [
    ["catalog/cards", CATALOG_SHARD_COUNT],
    ["catalog/texts/en", CATALOG_SHARD_COUNT],
    ["images", CATALOG_SHARD_COUNT],
    ["scripts/cards", SCRIPT_SHARD_COUNT],
  ] as const) {
    for (let shard = 0; shard < count; shard++)
      required.add(`${directory}/${shard.toString(16).padStart(2, "0")}.json`);
  }
  if (
    [...required].some((relative) => !files.has(relative)) ||
    [...files.keys()].some(
      (relative) =>
        (relative.startsWith("catalog/cards/") ||
          relative.startsWith("catalog/texts/en/")) &&
        !required.has(relative),
    )
  )
    return null;
  const codes = new Set<number>();
  const indexedScripts = new Set<string>();
  const packagedScripts = new Set<string>();
  for (const file of files.values()) {
    const bytes = await verifiedBytes(root, `${ASSET_ROOT}/${file.path}`, file);
    if (!required.has(file.path)) continue;
    const value = decodeJson(bytes);
    if (!validRuntimeRecords(file.path, value)) return null;
    if (file.path.startsWith("catalog/cards/")) {
      for (const card of value as { code: number }[]) {
        if (codes.has(card.code) || codes.size >= 100_000) return null;
        codes.add(card.code);
      }
    }
    if (file.path === "scripts/index.json") {
      const index = value as { official: string[]; preRelease: string[] };
      for (const name of [...index.official, ...index.preRelease]) {
        if (indexedScripts.has(name)) return null;
        indexedScripts.add(name);
      }
    }
    if (file.path.startsWith("scripts/cards/"))
      for (const name of Object.keys(value as object))
        packagedScripts.add(name);
  }
  if (
    indexedScripts.size !== packagedScripts.size ||
    [...indexedScripts].some((name) => !packagedScripts.has(name))
  )
    return null;
  // Exercise the actual alias/text/image/script/global dependency closure before readiness.
  await loadActiveDuelDependencies(
    {
      async readJson<T>(relative: string): Promise<T> {
        const file = files.get(relative);
        if (file === undefined)
          throw new Error("Incomplete content setup runtime.");
        const value = decodeJson(
          await verifiedBytes(root, `${ASSET_ROOT}/${relative}`, file),
        );
        if (!validRuntimeRecords(relative, value))
          throw new Error("Invalid content setup runtime records.");
        return value as T;
      },
    },
    new Set([...codes].map(cardCode)),
  );
  return codes;
}

async function verifiedBytes(
  root: string,
  relative: string,
  file: RuntimeManifestFile,
): Promise<Buffer> {
  const bytes = await readBounded(
    root,
    relative,
    Math.min(file.bytes, MAXIMUM_SNAPSHOT_FILE_BYTES),
  );
  if (
    bytes === null ||
    bytes.length !== file.bytes ||
    digest(bytes) !== file.sha256
  )
    throw new Error("Content setup runtime integrity failed.");
  return bytes;
}

function stringMap(value: unknown): value is Record<string, string> {
  return (
    record(value) &&
    Object.values(value).every((item) => typeof item === "string")
  );
}
function stringArray(value: unknown): value is string[] {
  return (
    Array.isArray(value) &&
    value.length <= 100_000 &&
    value.every((item) => typeof item === "string")
  );
}
function integerInRange(
  value: unknown,
  minimum: number,
  maximum: number,
): value is number {
  return (
    typeof value === "number" &&
    Number.isInteger(value) &&
    value >= minimum &&
    value <= maximum
  );
}
function validRuntimeRecords(relative: string, value: unknown): boolean {
  if (relative === "scripts/index.json")
    return (
      record(value) &&
      value.shardCount === SCRIPT_SHARD_COUNT &&
      stringArray(value.official) &&
      stringArray(value.preRelease) &&
      [...value.official, ...value.preRelease].every((name) =>
        /^c[1-9]\d*\.lua$/.test(name),
      ) &&
      stringArray(value.globals) &&
      value.globals.includes("constant.lua") &&
      value.globals.includes("utility.lua")
    );
  if (relative === "strings/en.json")
    return (
      record(value) &&
      ["system", "victory", "counter", "setname"].every((key) =>
        stringMap(value[key]),
      )
    );
  if (relative.startsWith("scripts/"))
    return (
      stringMap(value) &&
      Object.entries(value).every(
        ([name, source]) =>
          source.trim().length > 0 &&
          (relative === "scripts/globals.json" ||
            (/^c[1-9]\d*\.lua$/.test(name) &&
              Number(name.slice(1, -4)) % SCRIPT_SHARD_COUNT ===
                shardNumber(relative))),
      )
    );
  if (!Array.isArray(value) || value.length > 100_000) return false;
  const codes = new Set<number>();
  return value.every((item: unknown) => {
    if (
      !record(item) ||
      !integerInRange(item.code, 1, 0xffffffff) ||
      item.code % CATALOG_SHARD_COUNT !== shardNumber(relative) ||
      codes.has(item.code)
    )
      return false;
    codes.add(item.code);
    // Frozen writeCardData uses uint32 fields, int32 stats, uint64 race.
    if (relative.startsWith("catalog/cards/"))
      return (
        [
          "alias",
          "type",
          "level",
          "attribute",
          "lscale",
          "rscale",
          "linkMarker",
        ].every((key) => integerInRange(item[key], 0, 0xffffffff)) &&
        ["attack", "defense"].every((key) =>
          integerInRange(item[key], -0x80000000, 0x7fffffff),
        ) &&
        Array.isArray(item.setcodes) &&
        item.setcodes.every((code) => integerInRange(code, 1, 0xffff)) &&
        typeof item.race === "string" &&
        /^\d{1,20}$/.test(item.race) &&
        BigInt(item.race) <= 0xffffffffffffffffn
      );
    if (relative.startsWith("catalog/texts/en/"))
      return (
        typeof item.name === "string" &&
        typeof item.description === "string" &&
        stringArray(item.strings)
      );
    return (
      typeof item.full === "string" &&
      item.full.length > 0 &&
      typeof item.cropped === "string" &&
      item.cropped.length > 0
    );
  });
}
function shardNumber(relative: string): number {
  return Number.parseInt(relative.slice(-7, -5), 16);
}
