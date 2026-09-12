import { createHash } from "node:crypto";
import { fail } from "./asset-delivery/failure.ts";
import {
  array,
  assertSorted,
  hash,
  integer,
  literal,
  object,
  text,
} from "./asset-delivery/schema.ts";
import { compareCodePoints } from "./asset-delivery/canonical-json.ts";

export const CHAPTER_ONE_SET_MEDIA_EVIDENCE_PATH =
  "content/authoring/chapter-one-set-media.json";
export const CHAPTER_ONE_SET_MEDIA_SOURCE_PATH =
  "content/authoring/ygoprodeck-cardsets-2026-09-12.json";
export const CHAPTER_SET_INDEX_MAX_BYTES = 1024 * 1024;

function parseUnavailableSet(value: unknown) {
  return object(value, {
    id: text,
    name: text,
    providerRecords: integer,
    providerRecordsWithImage: integer,
    sourceSetCode: text,
  });
}

export function parseChapterSetMediaEvidence(value: unknown) {
  const parsed = object(value, {
    provider: literal("YGOPRODeck"),
    query: literal("https://db.ygoprodeck.com/api/v7/cardsets.php"),
    schemaVersion: literal(1),
    setsWithoutImage: (input) =>
      array(parseUnavailableSet, (entry) => entry.id, 100)(input),
    source: (input) =>
      object(input, {
        bytes: integer,
        path: literal(CHAPTER_ONE_SET_MEDIA_SOURCE_PATH),
        sha256: hash,
      }),
  });
  assertSorted(parsed.setsWithoutImage, (left, right) =>
    compareCodePoints(left.id, right.id),
  );
  return parsed;
}

export type ChapterSetMediaEvidence = ReturnType<
  typeof parseChapterSetMediaEvidence
>;

interface ChapterSetIdentity {
  readonly id: string;
  readonly name: string;
  readonly sourceSetCode: string;
}
interface ChapterSourceSet {
  readonly name: string;
  readonly code: string;
}
interface ProviderSetRecord {
  readonly set_name: string;
  readonly set_image: string | null;
}

function parseProviderSetRecords(
  bytes: Uint8Array,
): readonly ProviderSetRecord[] {
  if (bytes.byteLength > CHAPTER_SET_INDEX_MAX_BYTES)
    fail("ASSET_LIMIT_EXCEEDED", CHAPTER_ONE_SET_MEDIA_SOURCE_PATH);
  let value: unknown;
  try {
    value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    fail("ASSET_CONFIG_INVALID", CHAPTER_ONE_SET_MEDIA_SOURCE_PATH);
  }
  if (!Array.isArray(value) || value.length > 10_000)
    fail("ASSET_CONFIG_INVALID", CHAPTER_ONE_SET_MEDIA_SOURCE_PATH);
  return value.map((entry) => {
    if (typeof entry !== "object" || entry === null || Array.isArray(entry))
      fail("ASSET_CONFIG_INVALID", CHAPTER_ONE_SET_MEDIA_SOURCE_PATH);
    const name = (entry as Record<string, unknown>).set_name;
    const image = (entry as Record<string, unknown>).set_image;
    if (
      typeof name !== "string" ||
      name.length === 0 ||
      (image !== undefined && image !== null && typeof image !== "string")
    )
      fail("ASSET_CONFIG_INVALID", CHAPTER_ONE_SET_MEDIA_SOURCE_PATH);
    return { set_name: name, set_image: image ?? null };
  });
}

export function verifiedUnavailableSetImageIds(input: {
  readonly evidence: ChapterSetMediaEvidence;
  readonly identities: readonly ChapterSetIdentity[];
  readonly sets: readonly ChapterSourceSet[];
  readonly providerBytes: Uint8Array;
}): ReadonlySet<string> {
  if (
    input.evidence.source.bytes !== input.providerBytes.byteLength ||
    input.evidence.source.sha256 !==
      createHash("sha256").update(input.providerBytes).digest("hex")
  )
    fail("ASSET_INTEGRITY_FAILED", CHAPTER_ONE_SET_MEDIA_SOURCE_PATH);

  const providerRecords = parseProviderSetRecords(input.providerBytes);
  const evidenceById = new Map(
    input.evidence.setsWithoutImage.map((entry) => [entry.id, entry]),
  );
  const identitiesByName = new Map(
    input.identities.map((identity) => [identity.name, identity]),
  );
  const unavailableIds: string[] = [];

  for (const sourceSet of input.sets) {
    const identity = identitiesByName.get(sourceSet.name);
    if (!identity || identity.sourceSetCode !== sourceSet.code)
      fail("ASSET_CONFIG_INVALID", CHAPTER_ONE_SET_MEDIA_EVIDENCE_PATH);
    const matches = providerRecords.filter(
      (record) => record.set_name === sourceSet.name,
    );
    if (matches.length === 0)
      fail("ASSET_CONFIG_INVALID", CHAPTER_ONE_SET_MEDIA_SOURCE_PATH);
    const withImage = matches.filter(
      (record) =>
        typeof record.set_image === "string" && record.set_image.length > 0,
    ).length;
    if (withImage > 0) continue;
    const evidence = evidenceById.get(identity.id);
    if (
      !evidence ||
      evidence.name !== identity.name ||
      evidence.sourceSetCode !== identity.sourceSetCode ||
      evidence.providerRecords !== matches.length ||
      evidence.providerRecordsWithImage !== withImage
    )
      fail("ASSET_CONFIG_INVALID", CHAPTER_ONE_SET_MEDIA_EVIDENCE_PATH);
    unavailableIds.push(identity.id);
  }

  unavailableIds.sort(compareCodePoints);
  if (
    unavailableIds.length !== input.evidence.setsWithoutImage.length ||
    unavailableIds.some(
      (id, index) => id !== input.evidence.setsWithoutImage[index]!.id,
    )
  )
    fail("ASSET_CONFIG_INVALID", CHAPTER_ONE_SET_MEDIA_EVIDENCE_PATH);
  return new Set(unavailableIds);
}

export function unavailableChapterSetImageIds(input: {
  readonly evidence: ChapterSetMediaEvidence;
  readonly identities: readonly ChapterSetIdentity[];
  readonly sets: readonly ChapterSourceSet[];
  readonly providerBytes: Uint8Array;
}): ReadonlySet<string> {
  return verifiedUnavailableSetImageIds(input);
}
