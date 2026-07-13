import { snapshotId, type SnapshotId } from "../../duel/contracts/ids.ts";

const MAXIMUM_RUNTIME_FILES = 50_000;
const MAXIMUM_MANIFEST_STRING = 512;

export interface RuntimeManifestFile {
  readonly path: string;
  readonly bytes: number;
  readonly sha256: string;
}

export interface RuntimeSnapshotManifest {
  readonly schemaVersion: 1;
  readonly generatedAt: string;
  readonly snapshotId: SnapshotId;
  readonly engine: {
    readonly package: "ocgcore-wasm";
    readonly version: "0.1.2";
    readonly integrity: string;
    readonly coreVersion: readonly [number, number];
    readonly embeddedCoreRevision: string;
    readonly manifestSha256: string;
  };
  readonly assets: {
    readonly manifestSha256: string;
    readonly babelCdbRevision: string;
    readonly cardScriptsRevision: string;
    readonly distributionRevision: string;
    readonly files: readonly RuntimeManifestFile[];
  };
}

export function parseRuntimeSnapshotManifest(
  value: unknown,
): RuntimeSnapshotManifest {
  if (!isRecord(value)) throw new Error("Runtime manifest must be an object");
  requireExactKeys(
    value,
    ["schemaVersion", "generatedAt", "snapshotId", "engine", "assets"],
    "runtime manifest",
  );
  if (value.schemaVersion !== 1) {
    throw new Error(
      `Unsupported runtime manifest schema: ${String(value.schemaVersion)}`,
    );
  }
  if (
    typeof value.generatedAt !== "string" ||
    value.generatedAt.length > MAXIMUM_MANIFEST_STRING ||
    Number.isNaN(Date.parse(value.generatedAt))
  ) {
    throw new Error("Runtime manifest generatedAt is invalid");
  }
  if (
    typeof value.snapshotId !== "string" ||
    !/^[a-f0-9]{64}$/.test(value.snapshotId)
  ) {
    throw new Error("Runtime manifest snapshotId must be a SHA-256 digest");
  }
  if (!isRecord(value.engine) || !isRecord(value.assets)) {
    throw new Error("Runtime manifest engine and assets sections are required");
  }
  requireExactKeys(
    value.engine,
    [
      "package",
      "version",
      "integrity",
      "coreVersion",
      "embeddedCoreRevision",
      "manifestSha256",
    ],
    "runtime manifest engine",
  );
  requireExactKeys(
    value.assets,
    [
      "manifestSha256",
      "babelCdbRevision",
      "cardScriptsRevision",
      "distributionRevision",
      "files",
    ],
    "runtime manifest assets",
  );
  if (
    value.engine.package !== "ocgcore-wasm" ||
    value.engine.version !== "0.1.2" ||
    !isBoundedString(value.engine.integrity) ||
    !isDenseArray(value.engine.coreVersion) ||
    value.engine.coreVersion.length !== 2 ||
    !value.engine.coreVersion.every((part) => Number.isSafeInteger(part)) ||
    !isBoundedString(value.engine.embeddedCoreRevision) ||
    !isSha256(value.engine.manifestSha256)
  ) {
    throw new Error("Runtime manifest engine section is invalid");
  }
  if (
    !isSha256(value.assets.manifestSha256) ||
    !isBoundedString(value.assets.babelCdbRevision) ||
    !isBoundedString(value.assets.cardScriptsRevision) ||
    !isBoundedString(value.assets.distributionRevision) ||
    !isDenseArray(value.assets.files) ||
    value.assets.files.length > MAXIMUM_RUNTIME_FILES
  ) {
    throw new Error("Runtime manifest assets section is invalid");
  }
  const files: RuntimeManifestFile[] = [];
  const paths = new Set<string>();
  for (const file of value.assets.files) {
    if (!isRecord(file))
      throw new Error("Runtime manifest contains an invalid file record");
    requireExactKeys(file, ["path", "bytes", "sha256"], "runtime file");
    if (
      typeof file.path !== "string" ||
      !isSafeManifestPath(file.path) ||
      !Number.isSafeInteger(file.bytes) ||
      (file.bytes as number) < 0 ||
      !isSha256(file.sha256)
    ) {
      throw new Error("Runtime manifest contains an invalid file record");
    }
    if (paths.has(file.path))
      throw new Error(`Runtime manifest contains duplicate path: ${file.path}`);
    paths.add(file.path);
    files.push({
      path: file.path,
      bytes: file.bytes as number,
      sha256: file.sha256,
    });
  }

  const coreVersion = value.engine.coreVersion as unknown[];
  return {
    schemaVersion: 1,
    generatedAt: value.generatedAt,
    snapshotId: snapshotId(value.snapshotId),
    engine: {
      package: "ocgcore-wasm",
      version: "0.1.2",
      integrity: value.engine.integrity,
      coreVersion: [coreVersion[0] as number, coreVersion[1] as number],
      embeddedCoreRevision: value.engine.embeddedCoreRevision,
      manifestSha256: value.engine.manifestSha256,
    },
    assets: {
      manifestSha256: value.assets.manifestSha256,
      babelCdbRevision: value.assets.babelCdbRevision,
      cardScriptsRevision: value.assets.cardScriptsRevision,
      distributionRevision: value.assets.distributionRevision,
      files: Object.freeze(files),
    },
  };
}

export function isSafeManifestPath(value: string): boolean {
  if (
    value.length === 0 ||
    value.length > MAXIMUM_MANIFEST_STRING ||
    value.startsWith("/") ||
    value.includes("\\") ||
    value.includes(":") ||
    value.includes("\0") ||
    /[%?#]/.test(value)
  ) {
    return false;
  }
  return value
    .split("/")
    .every((part) => part.length > 0 && part !== "." && part !== "..");
}

function requireExactKeys(
  value: Record<string, unknown>,
  expected: readonly string[],
  label: string,
): void {
  const actual = Object.keys(value).sort();
  const sortedExpected = [...expected].sort();
  if (actual.join("\n") !== sortedExpected.join("\n"))
    throw new Error(`${label} has unknown or missing fields`);
}

function isDenseArray(value: unknown): value is unknown[] {
  return (
    Array.isArray(value) &&
    Object.keys(value).length === value.length &&
    value.every((_entry, index) => Object.hasOwn(value, index))
  );
}

function isBoundedString(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= MAXIMUM_MANIFEST_STRING
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isSha256(value: unknown): value is string {
  return typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
}
