import type { Sha256 } from "./identity.ts";
import type { AssetProfile, PlayerSelection } from "./asset-profile.ts";
import type { FileDigest } from "./file-digest.ts";
import type { SelectedAsset } from "./selected-asset.ts";
import type { RetainedMetadata } from "./retained-metadata.ts";
import type { PreparedPlayerMetadata } from "./prepared-player-metadata.ts";

export interface FrozenInventory {
  readonly schemaVersion: 1;
  readonly appVersion: string;
  readonly runtimeSnapshotId: Sha256 | null;
  readonly profiles: readonly AssetProfile[];
  readonly selection: PlayerSelection;
  readonly files: readonly SelectedAsset[];
  readonly vendorFiles: readonly FileDigest[];
  readonly retainedMetadata: RetainedMetadata;
  readonly playerMetadata: PreparedPlayerMetadata | null;
}

import {
  array,
  assertSorted,
  hash,
  nullable,
  object,
  releaseVersion,
  version,
} from "./schema.ts";
import { parseAssetProfile, parsePlayerSelection } from "./asset-profile.ts";
import { parseSelectedAsset } from "./selected-asset.ts";
import { parseFileDigests } from "./file-digest.ts";
import { parseRetainedMetadata } from "./retained-metadata.ts";
import { parsePreparedPlayerMetadata } from "./prepared-player-metadata.ts";
import { assertNoPathCollisions } from "./path-guards.ts";
import { fail } from "./failure.ts";
import { compareCodePoints } from "./canonical-json.ts";
export function parseFrozenInventory(value: unknown): FrozenInventory {
  const inventory = object(value, {
    schemaVersion: version,
    appVersion: releaseVersion,
    runtimeSnapshotId: nullable(hash),
    profiles: array(parseAssetProfile, (profile) => profile.id),
    selection: parsePlayerSelection,
    files: array(parseSelectedAsset),
    vendorFiles: parseFileDigests,
    retainedMetadata: parseRetainedMetadata,
    playerMetadata: nullable(parsePreparedPlayerMetadata),
  });
  assertSorted(inventory.files, (a, b) => compareCodePoints(a.path, b.path));
  assertSorted(inventory.vendorFiles, (a, b) =>
    compareCodePoints(a.path, b.path),
  );
  assertNoPathCollisions(inventory.files.map((file) => file.path));
  assertNoPathCollisions(
    inventory.files.flatMap((file) =>
      file.logicalPath === null ? [] : [file.logicalPath],
    ),
  );
  if (
    inventory.vendorFiles.some(
      (file) => !file.path.startsWith("vendor/ocgcore-wasm/0.1.2/"),
    )
  )
    fail("ASSET_PATH_UNSAFE");
  const ids = new Set(inventory.profiles.map((profile) => profile.id));
  if (
    ids.size !== inventory.selection.profiles.length ||
    inventory.selection.profiles.some((id) => !ids.has(id)) ||
    inventory.files.some(
      (file) => file.profile !== "dev-only" && !ids.has(file.profile),
    ) ||
    inventory.profiles.some((p) => p.dependsOn.some((id) => !ids.has(id)))
  )
    fail("ASSET_REFERENCE_MISSING");
  if (
    inventory.playerMetadata !== null &&
    inventory.runtimeSnapshotId !== inventory.playerMetadata.runtimeSnapshotId
  )
    fail("ASSET_INTEGRITY_FAILED");
  return inventory;
}
