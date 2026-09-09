import type { Sha256 } from "./identity.ts";

export type AssetFailureCode =
  | "ASSET_ARGUMENT_INVALID"
  | "ASSET_CONFIG_INVALID"
  | "ASSET_PATH_UNSAFE"
  | "ASSET_PROFILE_CONFLICT"
  | "ASSET_REFERENCE_MISSING"
  | "ASSET_SOURCE_CHANGED"
  | "ASSET_LIMIT_EXCEEDED"
  | "ASSET_NETWORK_FAILED"
  | "ASSET_REVISION_UNAVAILABLE"
  | "ASSET_INTEGRITY_FAILED"
  | "ASSET_ARCHIVE_REJECTED"
  | "ASSET_LOCAL_CONFLICT"
  | "ASSET_LAYOUT_INCOMPATIBLE"
  | "ASSET_BUSY"
  | "ASSET_DISK_FULL"
  | "ASSET_PUBLICATION_CONFLICT"
  | "ASSET_RELEASE_EXISTS"
  | "ASSET_PUBLICATION_DENIED"
  | "ASSET_TARGET_UNAVAILABLE"
  | "ASSET_PRUNE_STALE"
  | "ASSET_RECOVERY_REQUIRED";
export interface AssetFailure {
  readonly status: "failed";
  readonly code: AssetFailureCode;
  readonly path: string | null;
}
export interface AssetSuccess {
  readonly status: "ok";
  readonly operation:
    | "setup"
    | "scan"
    | "check"
    | "promote"
    | "migrate"
    | "bundle"
    | "publish"
    | "download"
    | "prune";
  readonly snapshotSha256: Sha256 | null;
}
export type AssetResult = AssetSuccess | AssetFailure;

import { literal, nullable, object, hash } from "./schema.ts";
import { assertSafePath } from "./path-guards.ts";
import { fail } from "./failure.ts";
export const ASSET_FAILURE_CODES = [
  "ASSET_ARGUMENT_INVALID",
  "ASSET_CONFIG_INVALID",
  "ASSET_PATH_UNSAFE",
  "ASSET_PROFILE_CONFLICT",
  "ASSET_REFERENCE_MISSING",
  "ASSET_SOURCE_CHANGED",
  "ASSET_LIMIT_EXCEEDED",
  "ASSET_NETWORK_FAILED",
  "ASSET_REVISION_UNAVAILABLE",
  "ASSET_INTEGRITY_FAILED",
  "ASSET_ARCHIVE_REJECTED",
  "ASSET_LOCAL_CONFLICT",
  "ASSET_LAYOUT_INCOMPATIBLE",
  "ASSET_BUSY",
  "ASSET_DISK_FULL",
  "ASSET_PUBLICATION_CONFLICT",
  "ASSET_RELEASE_EXISTS",
  "ASSET_PUBLICATION_DENIED",
  "ASSET_TARGET_UNAVAILABLE",
  "ASSET_PRUNE_STALE",
  "ASSET_RECOVERY_REQUIRED",
] as const;
export function parseAssetResult(value: unknown): AssetResult {
  if (typeof value !== "object" || value === null || !("status" in value))
    fail();
  if (value.status === "failed")
    return object(value, {
      status: literal("failed"),
      code: literal(...ASSET_FAILURE_CODES),
      path: nullable(assertSafePath),
    });
  return object(value, {
    status: literal("ok"),
    operation: literal(
      "setup",
      "scan",
      "check",
      "promote",
      "migrate",
      "bundle",
      "publish",
      "download",
      "prune",
    ),
    snapshotSha256: nullable(hash),
  });
}
