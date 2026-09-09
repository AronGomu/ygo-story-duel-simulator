import { createHash } from "node:crypto";

export type ChapterId = "chapter-01";
/** Runtime parser requires lowercase 64-character SHA-256 hex. */
export type Sha256 = string;
export interface ChapterSelection {
  readonly id: ChapterId;
  readonly title: string;
  readonly published: boolean;
  readonly setNames: readonly string[];
  readonly additionalCardCodes: readonly number[];
  readonly opponentIds: readonly string[];
  readonly storyContentId: "prototype-prologue-v1" | null;
}
export interface ChapterSelections {
  readonly schemaVersion: 1;
  readonly sourceSha256: Sha256;
  readonly chapters: readonly ChapterSelection[];
}
export interface SetupReport {
  readonly schemaVersion: 1;
  readonly codeReady: boolean;
  readonly publishReady: boolean;
  readonly blockers: readonly {
    readonly code:
      | "OWNER_MAPPING_REQUIRED"
      | "SOURCE_COVERAGE_REQUIRED"
      | "LICENSE_EVIDENCE_REQUIRED"
      | "HOST_SETUP_REQUIRED"
      | "DEVICE_ACCESS_REQUIRED";
    readonly detail: string;
  }[];
}
export interface DistributionEvidence {
  readonly schemaVersion: 1;
  readonly status: "pending" | "approved";
  readonly sourceRevision: string;
  readonly engineSource: string | null;
  readonly scriptSource: string | null;
  readonly databaseTerms: string | null;
  readonly artPermission: string | null;
  readonly storyMediaPermission: string | null;
}
export interface SetupAvailability {
  readonly runtimeVerified: boolean;
  readonly runtimeCardCodes: ReadonlySet<number>;
  readonly fullCardCodes: ReadonlySet<number>;
  readonly croppedCardCodes: ReadonlySet<number>;
  readonly setNames: ReadonlySet<string>;
  readonly prototypeMedia: boolean;
  readonly prototypeDecksCompatible: boolean;
}
interface SetupInput {
  readonly source: Uint8Array | null;
  readonly chapterPolicy: unknown;
  readonly selections: unknown;
  readonly distribution: unknown;
  readonly setup: unknown;
  readonly environment: Readonly<Record<string, string | undefined>>;
  readonly availability: SetupAvailability;
}
interface SourceSet {
  readonly name: string;
  readonly tcgReleaseDate: string | null;
  readonly cards: readonly { readonly id: number }[];
}
interface CardSetSource {
  readonly schemaVersion: 1;
  readonly generatedAt: string;
  readonly sets: readonly SourceSet[];
  readonly cardsWithoutSetMembership: readonly { readonly id: number }[];
}
const SHA256 = /^[a-f0-9]{64}$/;
const MAX_SETS = 2048;
const MAX_MEMBERSHIPS = 100_000;
const OPPONENTS = ["practice-bot", "blaze-circuit", "vault-warden"];
export const MAX_SOURCE_BYTES = 16 * 1024 * 1024;
export const MAX_SETUP_BYTES = 1024 * 1024;

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function text(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.trim().length > 0 &&
    value.length <= 512 &&
    ![...value].some((character) => character.charCodeAt(0) < 32)
  );
}
function exact(
  value: Record<string, unknown>,
  keys: readonly string[],
): boolean {
  return (
    Object.keys(value).length === keys.length &&
    keys.every((key) => Object.hasOwn(value, key))
  );
}
function strings(value: unknown, cap: number): value is string[] {
  return (
    Array.isArray(value) &&
    value.length <= cap &&
    value.every(text) &&
    new Set(value).size === value.length
  );
}
function cardCode(value: unknown): value is number {
  return (
    Number.isSafeInteger(value) &&
    Number(value) > 0 &&
    Number(value) <= 0xffffffff
  );
}
function date(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    !Number.isNaN(Date.parse(value)) &&
    new Date(value).toISOString().slice(0, 10) === value
  );
}

export function parseChapterSelections(
  value: unknown,
): ChapterSelections | null {
  if (
    !record(value) ||
    !exact(value, ["schemaVersion", "sourceSha256", "chapters"]) ||
    value.schemaVersion !== 1 ||
    typeof value.sourceSha256 !== "string" ||
    !SHA256.test(value.sourceSha256) ||
    !Array.isArray(value.chapters) ||
    value.chapters.length !== 1
  )
    return null;
  for (const chapter of value.chapters) {
    if (
      !record(chapter) ||
      !exact(chapter, [
        "id",
        "title",
        "published",
        "setNames",
        "additionalCardCodes",
        "opponentIds",
        "storyContentId",
      ]) ||
      chapter.id !== "chapter-01" ||
      !text(chapter.title) ||
      chapter.published !== true ||
      chapter.storyContentId !== "prototype-prologue-v1" ||
      !strings(chapter.setNames, MAX_SETS) ||
      !Array.isArray(chapter.additionalCardCodes) ||
      chapter.additionalCardCodes.length !== 0 ||
      !strings(chapter.opponentIds, 3)
    )
      return null;
    const opponentIds = chapter.opponentIds;
    if (
      opponentIds.length !== OPPONENTS.length ||
      !OPPONENTS.every((id) => opponentIds.includes(id))
    )
      return null;
  }
  return value as unknown as ChapterSelections;
}

export function parseCardSetSource(
  source: Uint8Array | null,
): CardSetSource | null {
  if (source === null || source.byteLength > MAX_SOURCE_BYTES) return null;
  let value: unknown;
  try {
    value = JSON.parse(
      new TextDecoder("utf-8", { fatal: true }).decode(source),
    );
  } catch (error) {
    if (error instanceof SyntaxError || error instanceof TypeError) return null;
    throw error;
  }
  if (
    !record(value) ||
    value.schemaVersion !== 1 ||
    !text(value.generatedAt) ||
    !date(value.generatedAt.slice(0, 10)) ||
    Number.isNaN(Date.parse(value.generatedAt)) ||
    !Array.isArray(value.sets) ||
    value.sets.length === 0 ||
    value.sets.length > MAX_SETS ||
    !Array.isArray(value.cardsWithoutSetMembership) ||
    value.cardsWithoutSetMembership.length > MAX_MEMBERSHIPS
  )
    return null;
  let memberships = 0;
  const names = new Set<string>();
  for (const set of value.sets) {
    if (
      !record(set) ||
      !text(set.name) ||
      names.has(set.name) ||
      !(set.tcgReleaseDate === null || date(set.tcgReleaseDate)) ||
      !Array.isArray(set.cards)
    )
      return null;
    memberships += set.cards.length;
    if (
      memberships > MAX_MEMBERSHIPS ||
      !set.cards.every((card) => record(card) && cardCode(card.id)) ||
      new Set(set.cards.map((card: { id: number }) => card.id)).size !==
        set.cards.length
    )
      return null;
    names.add(set.name);
  }
  if (
    !value.cardsWithoutSetMembership.every(
      (card) => record(card) && cardCode(card.id),
    )
  )
    return null;
  return value as unknown as CardSetSource;
}

interface ChapterDateInterval {
  readonly id: ChapterId;
  readonly startsOn: string;
  readonly endsBefore: string;
}

/** Owner-approved scope uses candidate dates; it does not attest exhaustive history. */
function parseChapterDateInterval(
  value: unknown,
  sourceSha256: string | null,
  cutoff: string,
): ChapterDateInterval | null {
  if (
    !record(value) ||
    value.schemaVersion !== 1 ||
    value.status !== "approved-chapter-one-scope" ||
    value.membershipBasis !== "original-tcg-set-release-date" ||
    value.reprints !== "include-every-printing-in-its-set-release-era" ||
    value.sameDateProducts !== "same-chapter" ||
    sourceSha256 === null ||
    value.sourceSha256 !== sourceSha256 ||
    value.snapshotCutoff !== cutoff ||
    value.boundaryEvidenceStatus !==
      "owner-approved-interval-not-exhaustive-history" ||
    !text(value.dateConvention) ||
    !Array.isArray(value.chapters) ||
    value.chapters.length !== 1
  )
    return null;
  const chapter = value.chapters[0];
  if (
    !record(chapter) ||
    chapter.id !== "chapter-01" ||
    !date(chapter.startsOn) ||
    !date(chapter.endsBefore) ||
    chapter.startsOn >= chapter.endsBefore ||
    chapter.endsBefore > cutoff ||
    !text(chapter.boundaryEvidence) ||
    !text(chapter.endBoundaryEvidence)
  )
    return null;
  return chapter as unknown as ChapterDateInterval;
}

/** Pure readiness calculation. Availability must come from local inspection, never owner booleans. */
export function verifyContentSetup(input: SetupInput): SetupReport {
  const blockers: {
    code: SetupReport["blockers"][number]["code"];
    detail: string;
  }[] = [];
  const add = (code: SetupReport["blockers"][number]["code"], detail: string) =>
    blockers.push({ code, detail });
  const selections = parseChapterSelections(input.selections);
  const source = parseCardSetSource(input.source);
  if (
    !selections ||
    selections.chapters.some((chapter) => chapter.setNames.length === 0)
  ) {
    add(
      "OWNER_MAPPING_REQUIRED",
      "Provide exactly one chapter-01 selection with all source sets in the approved interval from content/authoring/chapter-policy.json. Empty lists are incomplete scaffolding. Later chapter rows and additional cards are outside this release scope.",
    );
  }
  const sourceSha256 =
    input.source === null
      ? null
      : createHash("sha256").update(input.source).digest("hex");
  const interval = parseChapterDateInterval(
    input.chapterPolicy,
    sourceSha256,
    source?.generatedAt.slice(0, 10) ?? "",
  );
  if (!interval)
    add(
      "SOURCE_COVERAGE_REQUIRED",
      "Chapter-01 scope interval is missing or invalid. Record approved-chapter-one-scope, inclusive startsOn, exclusive endsBefore, boundaryEvidence and endBoundaryEvidence references, dateConvention and boundaryEvidenceStatus owner-approved-interval-not-exhaustive-history in content/authoring/chapter-policy.json, bound to source SHA-256 and snapshot cutoff. Scope approval is not exhaustive historical verification; do not invent dates or require later chapter boundaries.",
    );
  if (!source || !selections || selections.sourceSha256 !== sourceSha256) {
    add(
      "SOURCE_COVERAGE_REQUIRED",
      "Provide valid bounded source and selections with matching lowercase SHA-256. Preserve the approved source bytes in content/authoring/card-set-source.json.",
    );
  }
  if (source && selections) {
    const inScope = (set: SourceSet) =>
      interval !== null &&
      set.tcgReleaseDate !== null &&
      set.tcgReleaseDate >= interval.startsOn &&
      set.tcgReleaseDate < interval.endsBefore;
    const byName = new Map(source.sets.map((set) => [set.name, set]));
    const assigned = new Set(selections.chapters[0]!.setNames);
    const cards = new Set<number>();
    let unknown = 0;
    let undated = 0;
    let empty = 0;
    let outsideInterval = 0;
    let missingSets = 0;
    for (const name of assigned) {
      const set = byName.get(name);
      if (!set) {
        unknown++;
        continue;
      }
      if (set.tcgReleaseDate === null) {
        undated++;
        continue;
      }
      if (interval && !inScope(set)) {
        outsideInterval++;
        continue;
      }
      if (set.cards.length === 0) empty++;
      for (const card of set.cards) cards.add(card.id);
      if (!input.availability.setNames.has(name)) missingSets++;
    }
    const unassigned = source.sets.filter(
      (set) => inScope(set) && !assigned.has(set.name),
    ).length;
    if (unknown || undated || empty || unassigned || outsideInterval)
      add(
        "SOURCE_COVERAGE_REQUIRED",
        `Chapter-01 source gaps: ${unknown} unknown selected sets; ${undated} undated selected sets; ${empty} empty selected sets; ${unassigned} unassigned in-scope sets; ${outsideInterval} selected sets outside approved interval. Include startsOn, exclude endsBefore; retain every printing in selected sets. Unselected unknown dates and orphan memberships remain unresolved provenance, not card grants or exhaustive-coverage evidence.`,
      );
    const missing = (available: ReadonlySet<number>) =>
      [...cards].filter((code) => !available.has(code)).length;
    const unsupported = missing(input.availability.runtimeCardCodes);
    const full = missing(input.availability.fullCardCodes);
    const cropped = missing(input.availability.croppedCardCodes);
    if (unsupported || full || cropped || missingSets)
      add(
        "SOURCE_COVERAGE_REQUIRED",
        `Selected source gaps: ${unsupported} unsupported runtime cards; ${full} missing full images; ${cropped} missing cropped images; ${missingSets} missing set images. Run npm run assets:mvp; npm run assets:images:cropped; npm run assets:sets. Existing acquisition scope may not cover every selected set/card; rerun verification and remediate remaining gaps without substitutions.`,
      );
  }
  if (!input.availability.runtimeVerified)
    add(
      "SOURCE_COVERAGE_REQUIRED",
      "Local runtime snapshot is missing or invalid. Run npm run assets:mvp; npm run vendor:verify; npm run snapshot:verify. Frozen engine verification remains mandatory.",
    );
  if (!input.availability.prototypeMedia)
    add(
      "SOURCE_COVERAGE_REQUIRED",
      "Existing prototype source/media is missing. Restore src/story/content/prologue.ts, src/story/assets/city-map-placeholder.svg and src/story/assets/PROVENANCE.md; review prototype media rights separately.",
    );

  if (!input.availability.prototypeDecksCompatible)
    add(
      "SOURCE_COVERAGE_REQUIRED",
      "Chapter-01 prototype deck compatibility is missing or invalid. Current exposed presets, referenced free-play/story defaults and shared starter must parse with nonempty main decks and contain only selected source cards in main/extra/side. Restore missing required deck sources or explicitly supply/restrict to tested compatible presets downstream. Unused legacy deck files need not be ported; never drop cards, substitute IDs or classify unknown codes as later/non-TCG to pass this gate.",
    );

  const evidence = input.distribution;
  const rightsKeys = [
    "engineSource",
    "scriptSource",
    "databaseTerms",
    "artPermission",
    "storyMediaPermission",
  ];
  if (
    !record(evidence) ||
    !exact(evidence, [
      "schemaVersion",
      "status",
      "sourceRevision",
      ...rightsKeys,
    ]) ||
    evidence.schemaVersion !== 1 ||
    evidence.status !== "approved" ||
    sourceSha256 === null ||
    evidence.sourceRevision !== sourceSha256 ||
    !rightsKeys.every((key) => text(evidence[key]))
  ) {
    add(
      "LICENSE_EVIDENCE_REQUIRED",
      "Human review required: record approved engine/script source obligations, database terms, artwork and story-media permission references in content/distribution-evidence.json, bound to source SHA-256. Public URLs are not approval; automation validates attestations, not legal truth.",
    );
  }
  const setup =
    record(input.setup) &&
    exact(input.setup, ["schemaVersion", "cloudflare", "github", "devices"]) &&
    input.setup.schemaVersion === 1
      ? input.setup
      : null;
  const cloudflare = setup?.cloudflare;
  const github = setup?.github;
  const project = input.environment.CLOUDFLARE_PAGES_PROJECT;
  const present = (name: string) =>
    typeof input.environment[name] === "string" &&
    input.environment[name]!.trim().length > 0;
  if (
    !record(cloudflare) ||
    !exact(cloudflare, ["plan", "project", "staticOnly"]) ||
    cloudflare.plan !== "free" ||
    cloudflare.staticOnly !== true ||
    typeof project !== "string" ||
    !/^[a-z0-9][a-z0-9-]{0,57}[a-z0-9]$/.test(project) ||
    cloudflare.project !== project ||
    !record(github) ||
    !exact(github, ["environment", "protectionEvidence"]) ||
    github.environment !== "production" ||
    !text(github.protectionEvidence) ||
    !present("CLOUDFLARE_API_TOKEN") ||
    !present("CLOUDFLARE_ACCOUNT_ID")
  ) {
    add(
      "HOST_SETUP_REQUIRED",
      "Human setup required: Cloudflare Pages Free static-only project, protected GitHub production environment, CLOUDFLARE_PAGES_PROJECT variable, CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID secrets. Record nonsecret attestations in content/setup-evidence.json. Presence checks do not verify credentials or remote protection; no account/deploy action is performed.",
    );
  }
  const devices = setup?.devices;
  if (
    !record(devices) ||
    !exact(devices, ["android", "iphone", "ipad"]) ||
    !["android", "iphone", "ipad"].every((key) => text(devices[key]))
  )
    add(
      "DEVICE_ACCESS_REQUIRED",
      "Human device access required: record native Android, iPhone and iPad tester/device evidence in content/setup-evidence.json. Emulation is not native install/quota/reopen evidence; T1 records access only.",
    );
  const codeReady = !blockers.some(
    ({ code }) =>
      code === "OWNER_MAPPING_REQUIRED" || code === "SOURCE_COVERAGE_REQUIRED",
  );
  return {
    schemaVersion: 1,
    codeReady,
    publishReady: codeReady && blockers.length === 0,
    blockers,
  };
}
