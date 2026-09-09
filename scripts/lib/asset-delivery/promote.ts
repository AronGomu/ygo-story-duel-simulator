import { canonicalBytes } from "./canonical-json.ts";
import {
  parseAssetProfile,
  parseProfileId,
  type AssetProfile,
  type AssetRule,
} from "./asset-profile.ts";
import type { ProfileId } from "./identity.ts";
import {
  ASSET_ROOTS,
  assertSourcePath,
  assertSafePath,
} from "./path-guards.ts";
import { mappedLogicalPath } from "./source-mapping.ts";
import { loadProfiles, loadSelection, compareRules } from "./profile-set.ts";
import { readSource, sourceStat } from "./source-files.ts";
import { scanAssetProfiles, EMPTY_RETAINED_METADATA } from "./scan-assets.ts";
import { acquireAssetDeliveryLock } from "./local-lock.ts";
import { replaceMetadata } from "./atomic-metadata.ts";
import { fail } from "./failure.ts";
import { addedRules } from "./promotion-rule-diff.ts";

export interface PromotionOptions {
  readonly profile: ProfileId;
  readonly filesFrom?: string | undefined;
  readonly from?: string | undefined;
  readonly all?: boolean;
  readonly logicalPrefix?: string | undefined;
  readonly apply?: boolean;
}
export interface PromotionPreview {
  readonly before: AssetProfile;
  readonly after: AssetProfile;
  readonly changes: readonly {
    readonly path: string;
    readonly logicalPath: string;
    readonly profile: ProfileId;
    readonly kind: "file" | "tree";
  }[];
}
function sourceRule(
  relative: string,
  kind: "file" | "tree",
  prefix?: string,
): AssetRule {
  assertSourcePath(relative);
  const [assets, family, ...parts] = relative.split("/");
  const root = ASSET_ROOTS.find((r) => r === family);
  if (assets !== "assets" || !root || (kind === "file" && !parts.length))
    fail("ASSET_PATH_UNSAFE");
  const logicalPath =
    prefix === undefined ? mappedLogicalPath(relative) : assertSafePath(prefix);
  if (logicalPath === null) fail("ASSET_CONFIG_INVALID", relative);
  return { root, path: parts.join("/"), kind, logicalPath };
}
function validateOptions(options: PromotionOptions): void {
  parseProfileId(options.profile);
  if (
    (options.filesFrom === undefined) === (options.from === undefined) ||
    (options.from !== undefined && options.all !== true) ||
    (options.filesFrom !== undefined &&
      (options.all || options.logicalPrefix !== undefined))
  )
    fail("ASSET_ARGUMENT_INVALID");
}
async function prepare(root: string, options: PromotionOptions) {
  const profiles = await loadProfiles(root);
  const before = profiles.find((p) => p.id === options.profile);
  if (!before)
    fail("ASSET_REFERENCE_MISSING", `asset-profiles/${options.profile}.json`);
  const rules: AssetRule[] = [];
  if (options.filesFrom !== undefined) {
    assertSourcePath(options.filesFrom);
    const input = (await readSource(root, options.filesFrom, true)).bytes!;
    let list: string;
    try {
      list = new TextDecoder("utf-8", { fatal: true }).decode(input);
    } catch (error) {
      if (error instanceof TypeError)
        fail("ASSET_CONFIG_INVALID", options.filesFrom);
      throw error;
    }
    for (const line of list.split(/\r?\n/)) {
      if (line.trim() === "") continue;
      const rule = sourceRule(line, "file");
      const info = await sourceStat(root, line);
      if (!info) fail("ASSET_REFERENCE_MISSING", line);
      if (!info.isFile()) fail("ASSET_PATH_UNSAFE", line);
      rules.push(rule);
    }
    if (!rules.length) fail("ASSET_ARGUMENT_INVALID");
  } else {
    const rule = sourceRule(options.from!, "tree", options.logicalPrefix);
    const info = await sourceStat(root, options.from!);
    if (!info) fail("ASSET_REFERENCE_MISSING", options.from!);
    if (!info.isDirectory()) fail("ASSET_PATH_UNSAFE", options.from!);
    rules.push(rule);
  }
  const after = parseAssetProfile({
    ...before,
    rules: [...before.rules, ...rules].sort(compareRules),
  });
  const selection = await loadSelection(root);
  // Validate every profile including unselected declarations; proposed target is selected only here for preview.
  const previewSelection = {
    ...selection,
    profiles: [...new Set([...selection.profiles, options.profile])],
  };
  const candidateProfiles = profiles.map((p) =>
    p.id === after.id ? after : p,
  );
  const report = await scanAssetProfiles(
    root,
    previewSelection,
    EMPTY_RETAINED_METADATA,
    null,
    candidateProfiles,
  );
  const changes = addedRules(before.rules, after.rules).map((r) => ({
    path: `assets/${r.root}${r.path ? `/${r.path}` : ""}`,
    logicalPath: r.logicalPath,
    profile: options.profile,
    kind: r.kind,
  }));
  return {
    preview: { before, after, changes } satisfies PromotionPreview,
    profiles,
    selection,
    inventory: report.inventory,
  };
}
export async function promoteAssets(
  root: string,
  options: PromotionOptions,
): Promise<PromotionPreview> {
  validateOptions(options);
  const release = options.apply ? await acquireAssetDeliveryLock(root) : null;
  try {
    const target = `asset-profiles/${options.profile}.json`;
    const baseline = options.apply
      ? (await readSource(root, target)).digest
      : null;
    const first = await prepare(root, options);
    if (options.apply) {
      const second = await prepare(root, options);
      // The wrapper repeats profile bytes; only protocol constituents have a 32 MiB cap.
      for (const key of ["profiles", "selection", "inventory"] as const)
        if (
          !Buffer.from(canonicalBytes(first[key])).equals(
            Buffer.from(canonicalBytes(second[key])),
          )
        )
          fail("ASSET_SOURCE_CHANGED");
      await replaceMetadata(root, target, second.preview.after, baseline);
    }
    return first.preview;
  } finally {
    if (release) await release();
  }
}
