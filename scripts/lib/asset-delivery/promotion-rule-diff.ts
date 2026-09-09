import type { AssetRule } from "./asset-profile.ts";
import { compareRules } from "./profile-set.ts";

/** Both lists are sorted by the profile parser; merge in linear comparisons. */
export function addedRules(
  before: readonly AssetRule[],
  after: readonly AssetRule[],
): AssetRule[] {
  const added: AssetRule[] = [];
  let old = 0;
  for (const rule of after) {
    while (old < before.length && compareRules(before[old]!, rule) < 0) old++;
    if (old === before.length || compareRules(before[old]!, rule) !== 0)
      added.push(rule);
  }
  return added;
}
