import { createHash } from "node:crypto";

export const contentDigest = (value: string | Uint8Array) =>
  createHash("sha256").update(value).digest("hex");
export const chapterIds = ["chapter-01"];

/** Lawful synthetic data. These dates are not historical era evidence. */
export function contentSetupFixture() {
  const dates = ["2001-03-08", "2002-03-08", "2003-03-08"];
  const source: Buffer = Buffer.from(
    JSON.stringify({
      schemaVersion: 1,
      generatedAt: "2026-09-07T00:00:00Z",
      sets: dates.map((_, i) => ({
        name: `chapter-0${i + 1}`,
        code: `C0${i + 1}`,
        tcgReleaseDate: dates[i],
        cards: [
          {
            id: i + 1,
            name: `Synthetic card ${i + 1}`,
            printings: [
              {
                code: `C0${i + 1}-001`,
                rarity: "Common",
                rarityCode: "(C)",
              },
            ],
          },
        ],
      })),
      cardsWithoutSetMembership: [],
    }),
  );
  return {
    source,
    corrections: {
      schemaVersion: 1,
      aliases: [{ sourceCode: 81480461, runtimeCode: 81480460 }],
      excludedCardCodes: [501000000, 501000001],
      excludedSetNames: [
        "Yu-Gi-Oh! Power of Chaos: Yugi the Destiny Limited Collector's Edition",
      ],
    },
    chapterPolicy: {
      schemaVersion: 1,
      status: "approved-chapter-one-scope",
      membershipBasis: "original-tcg-set-release-date",
      reprints: "include-every-printing-in-its-set-release-era",
      sameDateProducts: "same-chapter",
      sourceSha256: contentDigest(source),
      snapshotCutoff: "2026-09-07",
      boundaryEvidenceStatus: "owner-approved-interval-not-exhaustive-history",
      dateConvention: "fixture:synthetic-dates-not-historical",
      chapters: chapterIds.map((id, i) => ({
        id,
        startsOn: dates[0]!,
        endsBefore: dates[1]!,
        boundaryEvidence: `fixture:boundary-${i + 1}`,
        endBoundaryEvidence: "fixture:exclusive-end",
      })),
    },
    selections: {
      schemaVersion: 1,
      sourceSha256: contentDigest(source),
      chapters: chapterIds.map((id, i) => ({
        id,
        title: id,
        published: i === 0,
        setNames: [id],
        additionalCardCodes: [],
        opponentIds:
          i === 0 ? ["practice-bot", "blaze-circuit", "vault-warden"] : [],
        storyContentId: i === 0 ? "prototype-prologue-v1" : null,
      })),
    },
    distribution: {
      schemaVersion: 1,
      status: "pending",
      sourceRevision: contentDigest(source),
      engineSource: "https://example.invalid/public-source",
      scriptSource: null,
      databaseTerms: null,
      artPermission: null,
      storyMediaPermission: null,
    },
    setup: null as unknown,
    environment: {} as Record<string, string | undefined>,
    availability: {
      runtimeVerified: true,
      runtimeCardCodes: new Set([1, 2, 3, 4, 5, 6]),
      fullCardCodes: new Set([1, 2, 3, 4, 5, 6]),
      croppedCardCodes: new Set([1, 2, 3, 4, 5, 6]),
      setNames: new Set(chapterIds),
      prototypeMedia: true,
      prototypeDecksCompatible: true,
    },
  };
}

export function bindContentSource(
  input: ReturnType<typeof contentSetupFixture>,
  source: Buffer,
): void {
  input.source = source;
  input.selections.sourceSha256 = contentDigest(source);
  input.chapterPolicy.sourceSha256 = contentDigest(source);
  input.distribution.sourceRevision = contentDigest(source);
}
