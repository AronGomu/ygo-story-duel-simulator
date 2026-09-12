import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  parseChapterSetMediaEvidence,
  verifiedUnavailableSetImageIds,
} from "../../scripts/lib/chapter-set-media.ts";

const providerBytes = new TextEncoder().encode(
  JSON.stringify([
    { set_name: "Missing Art", set_image: null },
    {
      set_name: "Available Art",
      set_image: "https://images.ygoprodeck.com/images/sets/AVL.jpg",
    },
  ]),
);
const source = {
  path: "content/authoring/ygoprodeck-cardsets-2026-09-12.json" as const,
  bytes: providerBytes.byteLength,
  sha256: createHash("sha256").update(providerBytes).digest("hex"),
};
const evidenceValue = {
  schemaVersion: 1,
  provider: "YGOPRODeck",
  query: "https://db.ygoprodeck.com/api/v7/cardsets.php",
  source,
  setsWithoutImage: [
    {
      id: "set-a",
      name: "Missing Art",
      sourceSetCode: "MIS",
      providerRecords: 1,
      providerRecordsWithImage: 0,
    },
  ],
};
const identities = [
  {
    id: "set-a",
    name: "Missing Art",
    sourceSetCode: "MIS",
    releaseYear: 2002,
  },
  {
    id: "set-b",
    name: "Available Art",
    sourceSetCode: "AVL",
    releaseYear: 2002,
  },
];
const sets = [
  { name: "Missing Art", code: "MIS", tcgReleaseDate: "2002-01-01", cards: [] },
  {
    name: "Available Art",
    code: "AVL",
    tcgReleaseDate: "2002-01-02",
    cards: [],
  },
];

describe("Chapter 1 set media evidence", () => {
  it("accepts only exact null-image records from pinned provider bytes", () => {
    const evidence = parseChapterSetMediaEvidence(evidenceValue);
    expect([
      ...verifiedUnavailableSetImageIds({
        evidence,
        identities,
        sets,
        providerBytes,
      }),
    ]).toEqual(["set-a"]);
  });

  it("rejects stale hashes, arbitrary null entries and omitted null records", () => {
    const stale = parseChapterSetMediaEvidence({
      ...evidenceValue,
      source: { ...source, sha256: "a".repeat(64) },
    });
    expect(() =>
      verifiedUnavailableSetImageIds({
        evidence: stale,
        identities,
        sets,
        providerBytes,
      }),
    ).toThrow("ASSET_INTEGRITY_FAILED");
    const imageClaim = new TextEncoder().encode(
      JSON.stringify([
        {
          set_name: "Missing Art",
          set_image: "https://images.ygoprodeck.com/images/sets/MIS.jpg",
        },
        JSON.parse(new TextDecoder().decode(providerBytes))[1],
      ]),
    );
    expect(() =>
      verifiedUnavailableSetImageIds({
        evidence: {
          ...parseChapterSetMediaEvidence(evidenceValue),
          source: {
            ...source,
            bytes: imageClaim.byteLength,
            sha256: createHash("sha256").update(imageClaim).digest("hex"),
          },
        },
        identities,
        sets,
        providerBytes: imageClaim,
      }),
    ).toThrow("ASSET_CONFIG_INVALID");
    expect(() =>
      verifiedUnavailableSetImageIds({
        evidence: parseChapterSetMediaEvidence({
          ...evidenceValue,
          setsWithoutImage: [],
        }),
        identities,
        sets,
        providerBytes,
      }),
    ).toThrow("ASSET_CONFIG_INVALID");
  });
});
