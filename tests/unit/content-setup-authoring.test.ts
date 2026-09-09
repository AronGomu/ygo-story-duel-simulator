import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { readBounded } from "../../scripts/lib/content-setup-io.ts";
import { inspectContentSetup } from "../../scripts/lib/content-setup-files.ts";
import {
  parseChapterSelections,
  type ChapterSelections,
} from "../../scripts/lib/content-setup.ts";

const sourceSha256 =
  "b3ac778e5f1b9927554ef8e66185a596c0c35d71ab642b448c952c6c9050496d";
const startsOn = "2001-01-01";
const endsBefore = "2005-05-28";
const emptySetName =
  "Yu-Gi-Oh! Power of Chaos: Yugi the Destiny Limited Collector's Edition";
interface SourceCard {
  id: number;
  printings: { code: string }[];
}
interface SourceSet {
  name: string;
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
const byName = new Map(source.sets.map((set) => [set.name, set]));
const assignedNames = selections.chapters.flatMap(
  (chapter) => chapter.setNames,
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
  it("materializes only chapter-01 with 76 sets in source-date then exact-name order", () => {
    expect(parseChapterSelections(selections)).not.toBeNull();
    expect(selections.chapters.map(({ id }) => id)).toEqual(["chapter-01"]);
    expect(assignedNames).toHaveLength(76);
    expect(new Set(assignedNames).size).toBe(76);
    expect(assignedNames).toEqual(expectedNames());
  });
  it("retains 1629 unique cards and every selected printing, excluding later-only records", () => {
    const cards = assignedNames.flatMap((name) => byName.get(name)!.cards);
    expect(new Set(cards.map((card) => card.id)).size).toBe(1629);
    expect(cards).toHaveLength(2749);
    expect(cards.reduce((sum, card) => sum + card.printings.length, 0)).toBe(
      4516,
    );
    const expectedCodes = new Set(
      expectedNames().flatMap((name) =>
        byName.get(name)!.cards.map(({ id }) => id),
      ),
    );
    expect(new Set(cards.map(({ id }) => id))).toEqual(expectedCodes);
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
  it("keeps PCY collector and promo identities separate without filling unknown collector contents", () => {
    const promo =
      "Yu-Gi-Oh! Power of Chaos: Yugi the Destiny promotional cards";
    expect(assignedNames).toContain(emptySetName);
    expect(assignedNames).toContain(promo);
    expect(byName.get(emptySetName)!.cards).toEqual([]);
    expect(byName.get(promo)!.cards).toHaveLength(5);
    expect(selections.chapters[0]!.additionalCardCodes).toEqual([]);
  });
  it("keeps the selected empty collector edition explicit without blanket exclusion", () => {
    const empty = assignedNames
      .map((name) => byName.get(name)!)
      .filter((set) => set.cards.length === 0);
    expect(
      empty.map(({ name, tcgReleaseDate }) => ({ name, tcgReleaseDate })),
    ).toEqual([{ name: emptySetName, tcgReleaseDate: "2003-11-18" }]);
  });
  it("real readiness stays blocked on selected gaps, not all later chronology or unknown orphans", async () => {
    const report = await inspectContentSetup(process.cwd(), {});
    expect(report).toMatchObject({ codeReady: false, publishReady: false });
    expect(
      report.blockers.some(({ code }) => code === "OWNER_MAPPING_REQUIRED"),
    ).toBe(false);
    expect(
      report.blockers.some(({ detail }) =>
        detail.includes("1 empty selected sets"),
      ),
    ).toBe(true);
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
