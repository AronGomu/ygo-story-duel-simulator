import { snapshotId, type SnapshotId } from "../../duel/contracts/ids.ts";

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
  if (value.schemaVersion !== 1) {
    throw new Error(
      `Unsupported runtime manifest schema: ${String(value.schemaVersion)}`,
    );
  }
  if (
    typeof value.generatedAt !== "string" ||
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
  if (
    value.engine.package !== "ocgcore-wasm" ||
    value.engine.version !== "0.1.2" ||
    typeof value.engine.integrity !== "string" ||
    !Array.isArray(value.engine.coreVersion) ||
    value.engine.coreVersion.length !== 2 ||
    !value.engine.coreVersion.every((part) => Number.isSafeInteger(part)) ||
    typeof value.engine.embeddedCoreRevision !== "string" ||
    !isSha256(value.engine.manifestSha256)
  ) {
    throw new Error("Runtime manifest engine section is invalid");
  }
  if (
    !isSha256(value.assets.manifestSha256) ||
    typeof value.assets.babelCdbRevision !== "string" ||
    typeof value.assets.cardScriptsRevision !== "string" ||
    typeof value.assets.distributionRevision !== "string" ||
    !Array.isArray(value.assets.files)
  ) {
    throw new Error("Runtime manifest assets section is invalid");
  }
  for (const file of value.assets.files) {
    if (
      !isRecord(file) ||
      typeof file.path !== "string" ||
      file.path.startsWith("/") ||
      file.path.includes("..") ||
      !Number.isSafeInteger(file.bytes) ||
      (file.bytes as number) < 0 ||
      !isSha256(file.sha256)
    ) {
      throw new Error("Runtime manifest contains an invalid file record");
    }
  }

  return {
    ...(value as unknown as RuntimeSnapshotManifest),
    snapshotId: snapshotId(value.snapshotId),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isSha256(value: unknown): value is string {
  return typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
}
