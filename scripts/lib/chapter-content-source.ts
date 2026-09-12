import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { parseChapterSelections } from "../../src/content/index.ts";
import { parseCardSetSource } from "./content-setup.ts";
import {
  normalizeChapterSource,
  parseChapterSourceCorrections,
  type ChapterSourceSet,
  type NormalizedChapterSource,
} from "./chapter-source-policy.ts";
import {
  chapterSetIdentities,
  type ChapterSetIdentity,
  type ExistingSetIdentity,
} from "./chapter-set-id.ts";
import {
  CHAPTER_ONE_SET_MEDIA_EVIDENCE_PATH,
  parseChapterSetMediaEvidence,
  verifiedUnavailableSetImageIds,
} from "./chapter-set-media.ts";

export async function loadChapterOneContentSource(root: string): Promise<{
  readonly normalized: NormalizedChapterSource;
  readonly sets: readonly ChapterSetIdentity[];
  readonly shopSets: readonly ExistingSetIdentity[];
  readonly unavailableSetImageIds: ReadonlySet<string>;
}> {
  const sourceBytes = await readFile(
    path.join(root, "content/authoring/card-set-source.json"),
  );
  const source = parseCardSetSource(sourceBytes);
  const selections = parseChapterSelections(
    JSON.parse(
      await readFile(
        path.join(root, "content/chapter-selections.json"),
        "utf8",
      ),
    ) as unknown,
  );
  const corrections = parseChapterSourceCorrections(
    JSON.parse(
      await readFile(
        path.join(root, "content/authoring/chapter-one-corrections.json"),
        "utf8",
      ),
    ) as unknown,
  );
  if (
    !source ||
    selections.kind !== "ok" ||
    selections.value.sourceSha256 !==
      createHash("sha256").update(sourceBytes).digest("hex")
  )
    throw new Error("CONTENT_SOURCE_POLICY_INVALID");
  const selectedNames = new Set(selections.value.chapters[0]!.setNames);
  const normalized = normalizeChapterSource(
    source.sets.filter(
      (set): set is ChapterSourceSet =>
        set.tcgReleaseDate !== null && selectedNames.has(set.name),
    ),
    corrections,
  );
  const shop = JSON.parse(
    await readFile(path.join(root, "public/story/shop-sets.v1.json"), "utf8"),
  ) as { readonly sets?: readonly ExistingSetIdentity[] };
  if (
    !Array.isArray(shop.sets) ||
    shop.sets.some(
      (set) =>
        typeof set.id !== "string" ||
        set.id.length === 0 ||
        typeof set.name !== "string" ||
        set.name.length === 0,
    )
  )
    throw new Error("CONTENT_SOURCE_POLICY_INVALID");
  const sets = chapterSetIdentities(normalized.sets, shop.sets);
  const evidence = parseChapterSetMediaEvidence(
    JSON.parse(
      await readFile(
        path.join(root, CHAPTER_ONE_SET_MEDIA_EVIDENCE_PATH),
        "utf8",
      ),
    ) as unknown,
  );
  const providerBytes = await readFile(path.join(root, evidence.source.path));
  return {
    normalized,
    sets,
    shopSets: shop.sets,
    unavailableSetImageIds: verifiedUnavailableSetImageIds({
      evidence,
      identities: sets,
      sets: normalized.sets,
      providerBytes,
    }),
  };
}
