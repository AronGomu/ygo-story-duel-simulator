import { createHash } from "node:crypto";
import type { ChapterSourceSet } from "./chapter-source-policy.ts";
import { compareCodePoints } from "./asset-delivery/canonical-json.ts";

export interface ExistingSetIdentity {
  readonly id: string;
  readonly name: string;
}

export interface ChapterSetIdentity extends ExistingSetIdentity {
  readonly sourceSetCode: string;
  readonly releaseYear: number;
}

export function chapterSetIdentities(
  sets: readonly ChapterSourceSet[],
  existing: readonly ExistingSetIdentity[],
): readonly ChapterSetIdentity[] {
  const byName = new Map<string, string>();
  const used = new Map<string, string>();
  for (const set of existing) {
    if (
      !set.id ||
      !set.name ||
      byName.has(set.name) ||
      (used.has(set.id) && used.get(set.id) !== set.name)
    )
      throw new Error("CONTENT_SET_ID_CONFLICT");
    byName.set(set.name, set.id);
    used.set(set.id, set.name);
  }
  const result = sets.map((set) => {
    const id =
      byName.get(set.name) ??
      `set-${createHash("sha256").update(set.name, "utf8").digest("hex").slice(0, 16)}`;
    const collision = used.get(id);
    if (collision !== undefined && collision !== set.name)
      throw new Error("CONTENT_SET_ID_CONFLICT");
    used.set(id, set.name);
    return {
      id,
      name: set.name,
      sourceSetCode: set.code,
      releaseYear: Number(set.tcgReleaseDate.slice(0, 4)),
    };
  });
  return result.sort((left, right) => compareCodePoints(left.name, right.name));
}
