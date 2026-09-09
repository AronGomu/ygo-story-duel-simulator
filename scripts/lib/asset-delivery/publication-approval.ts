import type { Sha256, AssetRoot, BundleTarget } from "./identity.ts";
import type { FileDigest } from "./file-digest.ts";

export type ApprovalRule =
  | {
      readonly root: AssetRoot | "vendor";
      readonly kind: "file";
      readonly path: string;
      readonly sha256: Sha256;
      readonly evidence: FileDigest;
    }
  | {
      readonly root: AssetRoot;
      readonly kind: "tree";
      readonly path: string;
      readonly includesFutureFiles: true;
      readonly evidence: FileDigest;
    };
export interface PublicationApproval {
  readonly schemaVersion: 1;
  readonly status: "approved";
  readonly targets: readonly BundleTarget[];
  readonly rules: readonly ApprovalRule[];
}

import { array, hash, literal, object, version } from "./schema.ts";
import { parseFileDigest } from "./file-digest.ts";
import { assertSourcePath, parseAssetRoot } from "./path-guards.ts";
import { fail } from "./failure.ts";
import type { AssetResult } from "./asset-result.ts";

export function parseApprovalRule(value: unknown): ApprovalRule {
  if (typeof value !== "object" || value === null || !("kind" in value)) fail();
  if (value.kind === "tree")
    return object(value, {
      root: parseAssetRoot,
      kind: literal("tree"),
      path: (v) => assertSourcePath(v, true),
      includesFutureFiles: literal(true),
      evidence: parseFileDigest,
    });
  const rule = object(value, {
    root: (v) => (v === "vendor" ? v : parseAssetRoot(v)),
    kind: literal("file"),
    path: assertSourcePath,
    sha256: hash,
    evidence: parseFileDigest,
  });
  if (rule.root === "vendor" && !rule.path.startsWith("ocgcore-wasm/0.1.2/"))
    fail("ASSET_PATH_UNSAFE");
  return rule;
}
export function parsePublicationApproval(value: unknown): PublicationApproval {
  const approval = object(value, {
    schemaVersion: version,
    status: literal("approved"),
    targets: array(literal("dev", "prod"), (v) => v, 2),
    rules: array(parseApprovalRule, (r) => `${r.root}/${r.path}/${r.kind}`),
  });
  if (!approval.targets.length) fail();
  return approval;
}

/** Rights scope only. Caller must verify evidence bytes before any publication. */
export function checkPublicationScope(
  approval: PublicationApproval,
  target: BundleTarget,
  sources: readonly {
    readonly root: AssetRoot | "vendor";
    readonly path: string;
    readonly sha256: Sha256;
  }[],
): AssetResult {
  const parsed = parsePublicationApproval(approval);
  const denied = (path: string | null): AssetResult => ({
    status: "failed",
    code: "ASSET_PUBLICATION_DENIED",
    path,
  });
  if (!parsed.targets.includes(target)) return denied(null);
  const files = new Map<string, string>();
  const trees = new Set<string>();
  for (const rule of parsed.rules) {
    const key = `${rule.root}/${rule.path}`;
    if (rule.kind === "file") files.set(key, rule.sha256);
    else trees.add(key);
  }
  for (const source of sources) {
    assertSourcePath(source.path);
    hash(source.sha256);
    if (source.root !== "vendor") parseAssetRoot(source.root);
    let covered = files.get(`${source.root}/${source.path}`) === source.sha256;
    const segments = source.path.split("/");
    for (let i = 0; !covered && i < segments.length; i++) {
      covered = trees.has(`${source.root}/${segments.slice(0, i).join("/")}`);
    }
    if (!covered)
      return denied(
        source.root === "vendor"
          ? `vendor/${source.path}`
          : `assets/${source.root}/${source.path}`,
      );
  }
  return { status: "ok", operation: "check", snapshotSha256: null };
}
