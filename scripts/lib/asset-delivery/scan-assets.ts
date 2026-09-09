import { ASSET_ROOTS, assertNoPathCollisions } from "./path-guards.ts";
import {
  loadProfiles,
  loadSelection,
  profileOwner,
  ruleSource,
  selectProfiles,
} from "./profile-set.ts";
import type { AssetProfile, PlayerSelection } from "./asset-profile.ts";
import {
  digestSource,
  readSourceJson,
  sourceFiles,
  sourceStat,
} from "./source-files.ts";
import { canonicalBytes, compareCodePoints } from "./canonical-json.ts";
import {
  parseFrozenInventory,
  type FrozenInventory,
} from "./frozen-inventory.ts";
import type { RetainedMetadata } from "./retained-metadata.ts";
import type { PreparedPlayerMetadata } from "./prepared-player-metadata.ts";
import type { SelectedAsset } from "./selected-asset.ts";
import { assertArchiveFiles } from "./archive-limits.ts";
import { fail } from "./failure.ts";
import { releaseVersion } from "./schema.ts";
import { scanVendorFiles } from "./vendor-files.ts";
import { assertMigrationReady } from "./migration-state.ts";

export interface ProfileDiagnostic {
  readonly phase:
    | "file-missing"
    | "tree-missing-dev-only-empty"
    | "dev-only"
    | "dependency-selected";
  readonly path: string;
  readonly bytes: number;
}
export interface ProfileScan {
  readonly inventory: FrozenInventory;
  readonly diagnostics: readonly ProfileDiagnostic[];
}
export const EMPTY_RETAINED_METADATA: RetainedMetadata = {
  schemaVersion: 1,
  catalogs: [],
  manifests: [],
};

async function allFiles(
  root: string,
  observedRoots: Set<string>,
): Promise<string[]> {
  const paths: string[] = [];
  for (const family of ASSET_ROOTS) {
    const relative = `assets/${family}`;
    const info = await sourceStat(root, relative);
    if (info && !info.isDirectory()) fail("ASSET_PATH_UNSAFE", relative);
    if (info) observedRoots.add(relative);
    paths.push(
      ...(await sourceFiles(root, relative, observedRoots.has(relative))),
    );
  }
  assertNoPathCollisions(paths);
  return paths.sort(compareCodePoints);
}
function checkSpellings(paths: readonly string[]): void {
  const spellings = new Map<string, string>();
  for (const file of paths) {
    const segments = file.split("/");
    for (let i = 1; i <= segments.length; i++) {
      const prefix = segments.slice(0, i).join("/");
      const folded = prefix
        .normalize("NFD")
        .toLowerCase()
        .toUpperCase()
        .normalize("NFD");
      if (spellings.has(folded) && spellings.get(folded) !== prefix)
        fail("ASSET_PATH_UNSAFE");
      spellings.set(folded, prefix);
    }
  }
}

/** Already-locked caller seam for sync/promotion/bundler; read-only, no nested lock. */
export async function scanAssetProfiles(
  root: string,
  selection: PlayerSelection,
  retainedMetadata: RetainedMetadata,
  playerMetadata: PreparedPlayerMetadata | null,
  profiles: readonly AssetProfile[] = [],
): Promise<ProfileScan> {
  await assertMigrationReady(root);
  const declarations = profiles.length ? profiles : await loadProfiles(root);
  const declarationBytes = canonicalBytes(declarations);
  const selected = selectProfiles(declarations, selection);
  const observedRoots = new Set<string>();
  const paths = await allFiles(root, observedRoots);
  const diagnostics: ProfileDiagnostic[] = [];
  checkSpellings([
    ...paths,
    ...declarations.flatMap((p) => p.rules.map(ruleSource)),
  ]);
  checkSpellings(
    declarations.flatMap((p) => p.rules.map((r) => r.logicalPath)),
  );
  for (const profile of declarations)
    for (const rule of profile.rules) {
      const relative = ruleSource(rule);
      const info = await sourceStat(root, relative);
      if (info && (rule.kind === "file" ? !info.isFile() : !info.isDirectory()))
        fail("ASSET_PROFILE_CONFLICT", relative);
      if (!info)
        diagnostics.push({
          phase:
            rule.kind === "file"
              ? "file-missing"
              : "tree-missing-dev-only-empty",
          path: relative,
          bytes: 0,
        });
    }
  for (const id of selected.selection.profiles)
    if (!selection.profiles.includes(id))
      diagnostics.push({
        phase: "dependency-selected",
        path: `asset-profiles/${id}.json`,
        bytes: 0,
      });
  const files: SelectedAsset[] = [];
  const owner = profileOwner(selected.profiles);
  const identities = new Map<string, string>();
  const identity = async (file: string): Promise<string> => {
    const stat = await sourceStat(root, file);
    if (!stat) fail("ASSET_SOURCE_CHANGED", file);
    return [stat.dev, stat.ino, stat.size, stat.mtimeNs, stat.ctimeNs].join(
      ":",
    );
  };
  for (const file of paths) {
    identities.set(file, await identity(file));
    const digest = await digestSource(root, file, true);
    const [, family, ...parts] = file.split("/");
    const rootName = ASSET_ROOTS.find((r) => r === family)!;
    const sourcePath = parts.join("/");
    const match = owner(file);
    const logicalPath = match
      ? match.rule.logicalPath +
        (match.rule.kind === "tree"
          ? `/${sourcePath.slice(match.rule.path ? match.rule.path.length + 1 : 0)}`
          : "")
      : null;
    files.push({
      ...digest,
      root: rootName,
      sourcePath,
      profile: match?.profile ?? "dev-only",
      logicalPath,
    });
    if (!match)
      diagnostics.push({ phase: "dev-only", path: file, bytes: digest.bytes });
  }
  if (
    JSON.stringify(paths) !==
    JSON.stringify(await allFiles(root, observedRoots))
  )
    fail("ASSET_SOURCE_CHANGED");
  for (const file of paths)
    if (identities.get(file) !== (await identity(file)))
      fail("ASSET_SOURCE_CHANGED", file);
  if (
    !profiles.length &&
    !Buffer.from(declarationBytes).equals(
      Buffer.from(canonicalBytes(await loadProfiles(root))),
    )
  )
    fail("ASSET_SOURCE_CHANGED");
  assertArchiveFiles(files, 0);
  const logicals = files.flatMap((f) =>
    f.logicalPath === null ? [] : [f.logicalPath],
  );
  if (new Set(logicals).size !== logicals.length)
    fail("ASSET_PROFILE_CONFLICT");
  assertNoPathCollisions(logicals);
  const pkg = (await readSourceJson(root, "package.json")) as {
    version?: unknown;
  } | null;
  const inventory = parseFrozenInventory({
    schemaVersion: 1,
    appVersion: releaseVersion(pkg?.version),
    runtimeSnapshotId: playerMetadata?.runtimeSnapshotId ?? null,
    profiles: selected.profiles,
    selection: selected.selection,
    files,
    vendorFiles: playerMetadata === null ? [] : await scanVendorFiles(root),
    retainedMetadata,
    playerMetadata,
  });
  await assertMigrationReady(root);
  return { inventory, diagnostics };
}
export async function scanAssets(
  root: string,
  selection: PlayerSelection,
  retainedMetadata: RetainedMetadata,
  playerMetadata: PreparedPlayerMetadata | null,
): Promise<FrozenInventory> {
  return (
    await scanAssetProfiles(root, selection, retainedMetadata, playerMetadata)
  ).inventory;
}
export async function checkAssetProfiles(root: string): Promise<ProfileScan> {
  const report = await scanAssetProfiles(
    root,
    await loadSelection(root),
    EMPTY_RETAINED_METADATA,
    null,
  );
  const missing = report.diagnostics.find((d) => d.phase === "file-missing");
  if (missing) fail("ASSET_REFERENCE_MISSING", missing.path);
  return report;
}
