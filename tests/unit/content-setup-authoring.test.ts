import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { readBounded } from "../../scripts/lib/content-setup-io.ts";
import { inspectContentSetup } from "../../scripts/lib/content-setup-files.ts";
import {
  parseChapterSelections,
  type ChapterSelections,
} from "../../scripts/lib/content-setup.ts";
import {
  normalizeChapterSource,
  type ChapterSourceCorrections,
} from "../../scripts/lib/chapter-source-policy.ts";

const sourceSha256 =
  "b3ac778e5f1b9927554ef8e66185a596c0c35d71ab642b448c952c6c9050496d";
const startsOn = "2001-01-01";
const endsBefore = "2005-05-28";
const emptySetName =
  "Yu-Gi-Oh! Power of Chaos: Yugi the Destiny Limited Collector's Edition";
interface SourceCard {
  id: number;
  name: string;
  printings: { code: string; rarity: string; rarityCode: string }[];
}
interface SourceSet {
  name: string;
  code: string;
  tcgReleaseDate: string | null;
  cards: SourceCard[];
}
interface Source {
  sets: SourceSet[];
  cardsWithoutSetMembership: SourceCard[];
}
async function bytes(relative: string) {
  const value = await readBounded(
    process.cwd(),
    relative,
    relative.endsWith("card-set-source.json") ? 16 * 1024 * 1024 : 1024 * 1024,
  );
  if (value === null)
    throw new Error("Missing or oversized authoring fixture.");
  return value;
}
async function json<T>(relative: string): Promise<T> {
  return JSON.parse((await bytes(relative)).toString("utf8")) as T;
}
const source = await json<Source>("content/authoring/card-set-source.json");
const selections = await json<ChapterSelections>(
  "content/chapter-selections.json",
);
const corrections = await json<ChapterSourceCorrections>(
  "content/authoring/chapter-one-corrections.json",
);
const byName = new Map(source.sets.map((set) => [set.name, set]));
const assignedNames = selections.chapters.flatMap(
  (chapter) => chapter.setNames,
);
const normalized = normalizeChapterSource(
  assignedNames
    .map((name) => byName.get(name)!)
    .filter(
      (set): set is SourceSet & { tcgReleaseDate: string } =>
        set.tcgReleaseDate !== null,
    ),
  corrections,
);
// Unicode code-point order, not machine locale collation. All source names are BMP.
const compare = (left: string, right: string) =>
  left < right ? -1 : left > right ? 1 : 0;

function expectedNames() {
  return source.sets
    .filter(
      (set) =>
        set.tcgReleaseDate !== null &&
        set.tcgReleaseDate >= startsOn &&
        set.tcgReleaseDate < endsBefore,
    )
    .sort(
      (left, right) =>
        compare(left.tcgReleaseDate!, right.tcgReleaseDate!) ||
        compare(left.name, right.name),
    )
    .map((set) => set.name);
}

describe("Chapter 1 authoring scope", () => {
  it("materializes only chapter-01 with 75 approved sets in source-date then exact-name order", () => {
    expect(parseChapterSelections(selections)).not.toBeNull();
    expect(selections.chapters.map(({ id }) => id)).toEqual(["chapter-01"]);
    expect(assignedNames).toHaveLength(75);
    expect(new Set(assignedNames).size).toBe(75);
    expect(assignedNames).toEqual(
      expectedNames().filter((name) => name !== emptySetName),
    );
  });
  it("retains 1627 unique playable cards and every approved printing, excluding later-only records", () => {
    const cards = normalized.sets.flatMap(({ cards }) => cards);
    expect(normalized.cardCodes).toHaveLength(1627);
    expect(cards).toHaveLength(2747);
    expect(cards.reduce((sum, card) => sum + card.printings.length, 0)).toBe(
      4514,
    );
    expect(new Set(cards.map(({ id }) => id))).toEqual(
      new Set(normalized.cardCodes),
    );
    expect(assignedNames).not.toContain(
      "The Lost Millennium Sneak Peek Participation Card",
    );
    expect(assignedNames).not.toContain("Crocs collaboration card");
    expect(assignedNames).toContain("Summoned Skull Sample promotional card");
  });
  it("records owner-approved bounded scope without claiming globally verified chronology", async () => {
    const policy = await json<{ chapters: unknown[] }>(
      "content/authoring/chapter-policy.json",
    );
    expect(policy).toMatchObject({
      status: "approved-chapter-one-scope",
      boundaryEvidenceStatus: "owner-approved-interval-not-exhaustive-history",
      sourceSha256,
      snapshotCutoff: "2026-09-07",
      chapters: [
        {
          id: "chapter-01",
          startsOn,
          endsBefore,
          boundaryEvidence:
            "content/authoring/release-date-evidence.json#/boundaryCandidates/0",
          endBoundaryEvidence:
            "content/authoring/release-date-evidence.json#/boundaryCandidates/1",
        },
      ],
    });
    expect(policy.chapters).toHaveLength(1);
    expect((await bytes("content/README.md")).toString("utf8")).toContain(
      "## Assumptions",
    );
  });
  it("preserves full immutable source and unresolved provenance without granting orphans", async () => {
    expect(
      createHash("sha256")
        .update(await bytes("content/authoring/card-set-source.json"))
        .digest("hex"),
    ).toBe(sourceSha256);
    expect(selections.sourceSha256).toBe(sourceSha256);
    expect(source.sets).toHaveLength(1036);
    expect(
      source.sets.filter((set) => set.tcgReleaseDate === null),
    ).toHaveLength(5);
    expect(source.sets.filter((set) => set.cards.length === 0)).toHaveLength(5);
    expect(source.cardsWithoutSetMembership).toHaveLength(509);
    expect(selections.chapters[0]!.additionalCardCodes).toEqual([]);
    expect(selections.chapters[0]!.opponentIds).toEqual([
      "practice-bot",
      "blaze-circuit",
      "vault-warden",
    ]);
    expect(selections.chapters[0]!.storyContentId).toBe(
      "prototype-prologue-v1",
    );
  });
  it("preserves superseded six-era mapping and raw scout observations as history, not release input", async () => {
    const history = await json<{
      status: string;
      selections: ChapterSelections;
    }>("content/authoring/superseded-six-era-mapping.json");
    expect(history.status).toBe("superseded-by-chapter-one-only-scope");
    expect(history.selections.chapters).toHaveLength(6);
    expect(
      history.selections.chapters.flatMap(({ setNames }) => setNames),
    ).toHaveLength(1033);
    const evidence = await json<{
      status: string;
      productFamilies: Record<string, { locales: unknown[] }>;
    }>("content/authoring/release-date-evidence.json");
    expect(evidence.status).toBe(
      "superseded-six-era-authoring-evidence-not-release-approval",
    );
    expect(
      Object.values(evidence.productFamilies).flatMap(({ locales }) => locales),
    ).toHaveLength(34);
    expect(evidence).toMatchObject({
      sourceSha256,
      rawSourceOverridesApplied: false,
      verifierOverridesApplied: false,
    });
  });
  it("excludes only PCY collector metadata while retaining the separate promo identity", () => {
    const promo =
      "Yu-Gi-Oh! Power of Chaos: Yugi the Destiny promotional cards";
    expect(assignedNames).not.toContain(emptySetName);
    expect(assignedNames).toContain(promo);
    expect(byName.get(emptySetName)!.cards).toEqual([]);
    expect(byName.get(promo)!.cards).toHaveLength(5);
    expect(selections.chapters[0]!.additionalCardCodes).toEqual([]);
    expect(corrections.excludedSetNames).toEqual([emptySetName]);
    expect(corrections.excludedCardCodes).toEqual([501000000, 501000001]);
    expect(corrections.aliases).toEqual([
      { sourceCode: 81480461, runtimeCode: 81480460 },
    ]);
  });
  it("records approved exclusion instead of loosening empty-set validation", () => {
    const selectedEmptySets = assignedNames
      .map((name) => byName.get(name)!)
      .filter((set) => set.cards.length === 0);
    expect(selectedEmptySets).toEqual([]);
    expect(
      source.sets
        .filter((set) => set.cards.length === 0)
        .map(({ name }) => name),
    ).toContain(emptySetName);
  });
  it("real readiness stays blocked on selected gaps, not all later chronology or unknown orphans", async () => {
    const report = await inspectContentSetup(process.cwd(), {});
    expect(report).toMatchObject({ codeReady: false, publishReady: false });
    expect(
      report.blockers.some(({ code }) => code === "OWNER_MAPPING_REQUIRED"),
    ).toBe(false);
    expect(
      report.blockers.some(({ detail }) =>
        detail.includes("empty selected sets"),
      ),
    ).toBe(false);
    for (const obsolete of [
      "5 undated sets",
      "509 orphan cards",
      "1 unassigned in-scope",
      "six ordered",
      "Era-date evidence",
    ])
      expect(
        report.blockers.some(({ detail }) => detail.includes(obsolete)),
      ).toBe(false);
  });
});
