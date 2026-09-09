import type { AssetRoot, ProfileId } from "./identity.ts";

export interface AssetRule {
  readonly root: AssetRoot;
  readonly path: string;
  readonly kind: "file" | "tree";
  readonly logicalPath: string;
}
export interface AssetProfile {
  readonly schemaVersion: 1;
  readonly id: ProfileId;
  readonly dependsOn: readonly ProfileId[];
  readonly rules: readonly AssetRule[];
}
export interface PlayerSelection {
  readonly schemaVersion: 1;
  readonly profiles: readonly ProfileId[];
}

import {
  array,
  assertSorted,
  literal,
  object,
  text,
  version,
} from "./schema.ts";
import {
  parseAssetRoot,
  assertSafePath,
  assertSourcePath,
} from "./path-guards.ts";
import { fail } from "./failure.ts";
import { canonicalBytes, compareCodePoints } from "./canonical-json.ts";

export function parseProfileId(value: unknown): ProfileId {
  const id = text(value);
  if (
    id !== "core" &&
    id !== "runtime" &&
    !/^chapter-[a-z0-9]+(?:-[a-z0-9]+)*$/.test(id)
  )
    fail();
  return id as ProfileId;
}
export function parseAssetRule(value: unknown): AssetRule {
  const rule = object(value, {
    root: parseAssetRoot,
    path: (v) => assertSourcePath(v, true),
    kind: literal("file", "tree"),
    logicalPath: assertSafePath,
  });
  if (rule.kind === "file") assertSourcePath(rule.path);
  return rule;
}
export function parseAssetProfile(value: unknown): AssetProfile {
  const profile = object(value, {
    schemaVersion: version,
    id: parseProfileId,
    dependsOn: array(parseProfileId, (id) => id),
    rules: array(parseAssetRule),
  });
  if (profile.dependsOn.includes(profile.id)) fail("ASSET_PROFILE_CONFLICT");
  const rules = [
    ...new Map(
      profile.rules.map((rule) => [
        Buffer.from(canonicalBytes(rule)).toString(),
        rule,
      ]),
    ).values(),
  ];
  assertSorted(
    rules,
    (left, right) =>
      compareCodePoints(left.root, right.root) ||
      compareCodePoints(left.path, right.path) ||
      compareCodePoints(left.kind, right.kind) ||
      compareCodePoints(left.logicalPath, right.logicalPath),
  );
  return { ...profile, rules };
}
export function parsePlayerSelection(value: unknown): PlayerSelection {
  return object(value, {
    schemaVersion: version,
    profiles: array(parseProfileId, (id) => id),
  });
}
