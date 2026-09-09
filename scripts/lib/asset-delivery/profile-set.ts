import path from "node:path";
import {
  parseAssetProfile,
  parsePlayerSelection,
  type AssetProfile,
  type AssetRule,
  type PlayerSelection,
} from "./asset-profile.ts";
import type { ProfileId } from "./identity.ts";
import { compareCodePoints } from "./canonical-json.ts";
import { sourceFiles, readSourceJson } from "./source-files.ts";
import { fail } from "./failure.ts";

export function compareRules(a: AssetRule, b: AssetRule): number {
  return (
    compareCodePoints(a.root, b.root) ||
    compareCodePoints(a.path, b.path) ||
    compareCodePoints(a.kind, b.kind) ||
    compareCodePoints(a.logicalPath, b.logicalPath)
  );
}
export function ruleSource(rule: AssetRule): string {
  return `assets/${rule.root}${rule.path ? `/${rule.path}` : ""}`;
}
function assertDisjointRules(paths: string[]): void {
  const seen = new Set<string>();
  for (const entry of paths.sort(compareCodePoints)) {
    const segments = entry.split("/");
    for (let i = 1; i <= segments.length; i++)
      if (seen.has(segments.slice(0, i).join("/")))
        fail("ASSET_PROFILE_CONFLICT");
    seen.add(entry);
  }
}
export function profileOwner(
  profiles: readonly AssetProfile[],
): (file: string) => { profile: ProfileId; rule: AssetRule } | undefined {
  const exact = new Map<string, { profile: ProfileId; rule: AssetRule }>();
  const trees = new Map<string, { profile: ProfileId; rule: AssetRule }>();
  for (const profile of profiles)
    for (const rule of profile.rules)
      (rule.kind === "file" ? exact : trees).set(ruleSource(rule), {
        profile: profile.id,
        rule,
      });
  return (file) => {
    const match = exact.get(file);
    if (match) return match;
    const segments = file.split("/");
    for (let i = segments.length - 1; i >= 2; i--) {
      const tree = trees.get(segments.slice(0, i).join("/"));
      if (tree) return tree;
    }
    return undefined;
  };
}
export async function loadProfiles(root: string): Promise<AssetProfile[]> {
  const profiles: AssetProfile[] = [];
  for (const file of await sourceFiles(root, "asset-profiles")) {
    if (file === "asset-profiles/nightly.json" || !file.endsWith(".json"))
      continue;
    const profile = parseAssetProfile(await readSourceJson(root, file, true));
    if (
      file !== `asset-profiles/${profile.id}.json` ||
      path.basename(file) === "nightly.json"
    )
      fail("ASSET_CONFIG_INVALID", file);
    profiles.push(profile);
  }
  return profiles.sort((a, b) => compareCodePoints(a.id, b.id));
}
export async function loadSelection(root: string): Promise<PlayerSelection> {
  return parsePlayerSelection(
    await readSourceJson(root, "asset-profiles/nightly.json"),
  );
}

export function selectProfiles(
  profiles: readonly AssetProfile[],
  value: PlayerSelection,
): { profiles: AssetProfile[]; selection: PlayerSelection } {
  const selection = parsePlayerSelection(value);
  const byId = new Map(profiles.map((p) => [p.id, p]));
  for (const profile of profiles) {
    for (const id of profile.dependsOn)
      if (!byId.has(id))
        fail("ASSET_REFERENCE_MISSING", `asset-profiles/${id}.json`);
    if (
      (profile.id === "core" || profile.id === "runtime") &&
      profile.dependsOn.some((id) => id.startsWith("chapter-"))
    )
      fail("ASSET_PROFILE_CONFLICT", `asset-profiles/${profile.id}.json`);
    if (profile.id === "chapter-01" && !profile.dependsOn.includes("runtime"))
      fail("ASSET_PROFILE_CONFLICT", "asset-profiles/chapter-01.json");
  }
  const visited = new Set<ProfileId>();
  const active = new Set<ProfileId>();
  const visit = (start: ProfileId): void => {
    const stack = [{ id: start, closing: false }];
    while (stack.length) {
      const { id, closing } = stack.pop()!;
      if (closing) {
        active.delete(id);
        visited.add(id);
        continue;
      }
      if (active.has(id))
        fail("ASSET_PROFILE_CONFLICT", `asset-profiles/${id}.json`);
      if (visited.has(id)) continue;
      const profile = byId.get(id);
      if (!profile)
        fail("ASSET_REFERENCE_MISSING", `asset-profiles/${id}.json`);
      active.add(id);
      stack.push({ id, closing: true });
      for (const dependency of profile.dependsOn)
        stack.push({ id: dependency, closing: false });
    }
  };
  for (const profile of profiles) visit(profile.id);
  visited.clear();
  for (const id of selection.profiles) visit(id);
  const selected = [...visited].sort(compareCodePoints);
  const rules = profiles.flatMap((profile) =>
    profile.rules.map((rule) => ({ profile: profile.id, rule })),
  );
  for (const { profile, rule } of rules)
    if (
      rule.root === "shared" &&
      (rule.path === "fonts" || rule.path.startsWith("fonts/")) &&
      profile !== "core"
    )
      fail("ASSET_PROFILE_CONFLICT");
  assertDisjointRules(rules.map(({ rule }) => ruleSource(rule)));
  assertDisjointRules(rules.map(({ rule }) => rule.logicalPath));
  return {
    profiles: selected.map((id) => byId.get(id)!),
    selection: { schemaVersion: 1, profiles: selected },
  };
}
