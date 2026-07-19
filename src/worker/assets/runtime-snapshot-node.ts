import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import {
  isSafeManifestPath,
  parseRuntimeSnapshotManifest,
  type RuntimeSnapshotManifest,
} from "./runtime-manifest.ts";

export interface AssetManifest {
  readonly schemaVersion: number;
  readonly generatedAt: string;
  readonly sources: {
    readonly babelCdb: { readonly commit: string };
    readonly cardScripts: { readonly commit: string };
    readonly distribution: { readonly commit: string };
  };
  readonly files: readonly {
    readonly path: string;
    readonly bytes: number;
    readonly sha256: string;
  }[];
}

interface VendorManifest {
  readonly schemaVersion: number;
  readonly package: string;
  readonly version: string;
  readonly integrity: string;
  readonly embeddedCoreRevision: string;
  readonly coreVersion: readonly [number, number];
}

export async function buildRuntimeSnapshotManifest(
  assetRoot: string,
  vendorRoot: string,
): Promise<RuntimeSnapshotManifest> {
  const [assetBytes, vendorBytes] = await Promise.all([
    readFile(path.join(assetRoot, "manifest.json")),
    readFile(path.join(vendorRoot, "vendor-manifest.json")),
  ]);
  const assets = JSON.parse(assetBytes.toString("utf8")) as AssetManifest;
  const engine = JSON.parse(vendorBytes.toString("utf8")) as VendorManifest;
  if (assets.schemaVersion !== 1)
    throw new Error(`Unsupported asset schema: ${assets.schemaVersion}`);
  if (
    engine.schemaVersion !== 1 ||
    engine.package !== "ocgcore-wasm" ||
    engine.version !== "0.1.2"
  ) {
    throw new Error("Unsupported vendored engine manifest");
  }
  const assetManifestSha256 = sha256(assetBytes);
  const assetContentSha256 = runtimeAssetContentSha256(assets);
  const engineManifestSha256 = sha256(vendorBytes);
  const id = deriveRuntimeSnapshotId(assetContentSha256, engineManifestSha256);

  return parseRuntimeSnapshotManifest({
    schemaVersion: 1,
    generatedAt: assets.generatedAt,
    snapshotId: id,
    engine: {
      package: "ocgcore-wasm",
      version: "0.1.2",
      integrity: engine.integrity,
      coreVersion: engine.coreVersion,
      embeddedCoreRevision: engine.embeddedCoreRevision,
      manifestSha256: engineManifestSha256,
    },
    assets: {
      manifestSha256: assetManifestSha256,
      babelCdbRevision: assets.sources.babelCdb.commit,
      cardScriptsRevision: assets.sources.cardScripts.commit,
      distributionRevision: assets.sources.distribution.commit,
      files: assets.files,
    },
  });
}

export function runtimeAssetContentSha256(assets: AssetManifest): string {
  return sha256(
    JSON.stringify({
      schemaVersion: assets.schemaVersion,
      sources: assets.sources,
      files: assets.files,
    }),
  );
}

export function deriveRuntimeSnapshotId(
  assetContentSha256: string,
  engineManifestSha256: string,
): string {
  return sha256(
    JSON.stringify({
      schemaVersion: 1,
      assetContentSha256,
      engineManifestSha256,
    }),
  );
}

export async function verifyRuntimeSnapshotFiles(
  manifest: RuntimeSnapshotManifest,
  assetRoot: string,
): Promise<void> {
  const failures: string[] = [];
  for (const file of manifest.assets.files) {
    const absolutePath = safeArtifactPath(assetRoot, file.path);
    try {
      const metadata = await stat(absolutePath);
      if (metadata.size !== file.bytes) {
        failures.push(
          `${file.path}: expected ${file.bytes} bytes, found ${metadata.size}`,
        );
        continue;
      }
      const digest = sha256(await readFile(absolutePath));
      if (digest !== file.sha256)
        failures.push(`${file.path}: SHA-256 mismatch`);
    } catch (error) {
      failures.push(`${file.path}: ${(error as Error).message}`);
    }
  }
  if (failures.length > 0) {
    throw new Error(
      `Runtime snapshot validation failed:\n${failures.join("\n")}`,
    );
  }
}

export function safeArtifactPath(root: string, relativePath: string): string {
  if (relativePath.split(/[\\/]/).includes(".."))
    throw new Error(`Artifact path escapes snapshot root: ${relativePath}`);
  if (path.isAbsolute(relativePath) || !isSafeManifestPath(relativePath))
    throw new Error(`Artifact path must be safe and relative: ${relativePath}`);
  const resolvedRoot = path.resolve(root);
  const resolved = path.resolve(root, ...relativePath.split("/"));
  const relative = path.relative(resolvedRoot, resolved);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`Artifact path escapes snapshot root: ${relativePath}`);
  }
  return resolved;
}

function sha256(value: Uint8Array | string): string {
  return createHash("sha256").update(value).digest("hex");
}
