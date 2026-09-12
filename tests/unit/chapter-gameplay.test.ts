import { describe, expect, it } from "vitest";
import {
  parseChapterGameplay,
  parseChapterStoryDocument,
  parseContentIndex,
  parseContentManifest,
} from "../../src/content/index.ts";
import { parseChapterGameplayAuthoring } from "../../scripts/lib/asset-delivery/chapter-gameplay.ts";
import { addUniqueGameplayEntries } from "../../scripts/lib/asset-delivery/verify-chapter-gameplay.ts";

const hash = "a".repeat(64);
const runtime = { packId: "runtime" as const, sha256: hash, bytes: 1 };
const chapterOne = {
  packId: "chapter-01" as const,
  sha256: "b".repeat(64),
  bytes: 1,
};

const story = {
  schemaVersion: 1,
  contentId: "prototype-prologue-v1",
  title: "Prototype",
  beats: [
    {
      id: "arrival",
      speaker: null,
      kind: "narration",
      text: "Arrival.",
      background: "station",
      characters: [],
    },
  ],
  choices: [
    { id: "trust-rin", label: "Trust Rin" },
    { id: "challenge-rin", label: "Challenge Rin" },
    { id: "observe-first", label: "Observe first" },
  ],
  choiceResponses: {
    "trust-rin": "Trusted.",
    "challenge-rin": "Challenged.",
    "observe-first": "Observed.",
  },
  laterAcknowledgments: {
    "trust-rin": "Trust remembered.",
    "challenge-rin": "Challenge remembered.",
    "observe-first": "Observation remembered.",
  },
  mapImage: { packId: "chapter-01", path: "story/media/map.svg" },
};

const gameplay = {
  schemaVersion: 1,
  chapterId: "chapter-01",
  cards: [
    {
      code: 1,
      record: {
        code: 1,
        alias: 0,
        setcodes: [],
        type: 17,
        level: 4,
        attribute: 1,
        race: "1",
        attack: 1000,
        defense: 1000,
        lscale: 0,
        rscale: 0,
        linkMarker: 0,
        ot: 1,
      },
      text: {
        code: 1,
        name: "Card",
        description: "Description",
        strings: Array.from({ length: 16 }, () => ""),
      },
      fullImage: { packId: "chapter-01", path: "runtime/images/1.jpg" },
      croppedImage: {
        packId: "chapter-01",
        path: "runtime/images-cropped/1.jpg",
      },
    },
  ],
  sets: [
    {
      id: "set-one",
      name: "Set One",
      releaseYear: 2002,
      image: { packId: "chapter-01", path: "runtime/sets/set-one.jpg" },
      cards: [
        {
          code: 1,
          name: "Card",
          rarity: "common",
          printingCode: "ONE-001",
          sourceRarity: "Common",
          sourceRarityCode: "(C)",
        },
      ],
    },
  ],
  decks: [
    {
      id: "starter",
      name: "Starter",
      main: Array.from({ length: 40 }, () => 1),
      extra: [],
      side: [],
    },
  ],
  opponents: [
    {
      id: "opponent",
      name: "Opponent",
      line: "Ready.",
      deckId: "starter",
      policyId: "basic",
    },
  ],
  defaults: { starterDeckId: "starter", opponentId: "opponent" },
  story: {
    contentId: "prototype-prologue-v1",
    document: {
      packId: "chapter-01",
      path: "chapters/chapter-01/story.json",
    },
  },
};

describe("chapter gameplay wire schema", () => {
  it("accepts schema2 index/manifest DAG including fixture chapter-02", () => {
    expect(
      parseContentIndex({
        schemaVersion: 2,
        releaseId: `0.1.0+${hash}`,
        runtimeSnapshotId: hash,
        runtime,
        chapters: [
          {
            id: "chapter-01",
            title: "DM",
            description: "Prototype.",
            status: "published",
            manifest: chapterOne,
          },
          {
            id: "chapter-02",
            title: "GX",
            description: "Fixture.",
            status: "unreleased",
          },
        ],
        retainedCatalogs: [],
        retainedManifests: [],
      }).kind,
    ).toBe("ok");
    expect(
      parseContentManifest({
        schemaVersion: 2,
        packId: "chapter-02",
        runtimeSnapshotId: hash,
        storyContentId: null,
        gameplayPath: "chapters/chapter-02/gameplay.json",
        dependencies: [runtime, chapterOne],
        cardCodes: [1],
        opponentIds: [],
        parts: [{ sha256: hash, bytes: 1, unpackedBytes: 1 }],
        files: [
          {
            path: "chapters/chapter-02/gameplay.json",
            bytes: 1,
            sha256: hash,
            mediaType: "application/json",
            partSha256: hash,
            entry: "chapters/chapter-02/gameplay.json",
          },
        ],
      }).kind,
    ).toBe("ok");
  });

  it("rejects schema1 index and manifest instead of relabeling old meaning", () => {
    expect(
      parseContentIndex({
        schemaVersion: 1,
        releaseId: "old",
        runtimeSnapshotId: hash,
        runtime,
        chapters: [],
        retainedCatalogs: [],
        retainedManifests: [],
      }).kind,
    ).toBe("failed");
    expect(
      parseContentManifest({
        schemaVersion: 1,
        packId: "runtime",
        runtimeSnapshotId: hash,
        storyContentId: null,
        dependencies: [],
        cardCodes: [],
        opponentIds: [],
        parts: [],
        files: [],
      }).kind,
    ).toBe("failed");
  });

  it("parses complete gameplay/story and rejects missing gameplay data", () => {
    expect(parseChapterGameplay(gameplay)).toEqual({
      kind: "ok",
      value: gameplay,
    });
    expect(parseChapterStoryDocument(story)).toEqual({
      kind: "ok",
      value: story,
    });
    const textOnlySet = {
      ...gameplay,
      sets: [{ ...gameplay.sets[0], image: null }],
    };
    expect(parseChapterGameplay(textOnlySet)).toEqual({
      kind: "ok",
      value: textOnlySet,
    });
    for (const key of [
      "cards",
      "sets",
      "decks",
      "opponents",
      "story",
    ] as const) {
      const invalid = { ...gameplay } as Record<string, unknown>;
      delete invalid[key];
      expect(parseChapterGameplay(invalid).kind, key).toBe("failed");
    }
  });

  it("rejects duplicate deck and opponent IDs at every boundary", () => {
    expect(
      parseChapterGameplay({
        ...gameplay,
        decks: [gameplay.decks[0], gameplay.decks[0]],
      }).kind,
    ).toBe("failed");
    expect(
      parseChapterGameplay({
        ...gameplay,
        opponents: [gameplay.opponents[0], gameplay.opponents[0]],
      }).kind,
    ).toBe("failed");

    const authoring = {
      schemaVersion: 1,
      description: "Chapter.",
      decks: [
        { id: "starter", name: "Starter", path: "src/decks/starter.ydk" },
      ],
      opponents: [
        {
          id: "opponent",
          name: "Opponent",
          line: "Ready.",
          deckId: "starter",
          policyId: "basic",
        },
      ],
      defaults: { starterDeckId: "starter", opponentId: "opponent" },
      story: {
        contentId: "prototype-prologue-v1",
        document: "content/authoring/chapter-one-story.json",
      },
    };
    expect(() =>
      parseChapterGameplayAuthoring({
        ...authoring,
        decks: [authoring.decks[0], authoring.decks[0]],
      }),
    ).toThrow("ASSET_CONFIG_INVALID");
    expect(() =>
      parseChapterGameplayAuthoring({
        ...authoring,
        opponents: [authoring.opponents[0], authoring.opponents[0]],
      }),
    ).toThrow("ASSET_CONFIG_INVALID");

    const seen = new Map<string, unknown>();
    addUniqueGameplayEntries(seen, [gameplay.decks[0]!]);
    expect(() => addUniqueGameplayEntries(seen, [gameplay.decks[0]!])).toThrow(
      "ASSET_INTEGRITY_FAILED",
    );
  });

  it("rejects wrong ref packs, unsorted cards, invalid deck bounds, extras", () => {
    expect(
      parseChapterGameplay({
        ...gameplay,
        cards: [
          {
            ...gameplay.cards[0]!,
            code: 2,
            record: { ...gameplay.cards[0]!.record, code: 2 },
            text: { ...gameplay.cards[0]!.text, code: 2 },
          },
          gameplay.cards[0],
        ],
      }).kind,
    ).toBe("failed");
    expect(
      parseChapterGameplay({
        ...gameplay,
        decks: [{ ...gameplay.decks[0], main: [1] }],
      }).kind,
    ).toBe("failed");
    expect(
      parseChapterGameplay({
        ...gameplay,
        cards: [
          {
            ...gameplay.cards[0],
            fullImage: { packId: "chapter-02", path: "runtime/images/1.jpg" },
          },
        ],
      }).kind,
    ).toBe("failed");
    expect(parseChapterGameplay({ ...gameplay, extra: true }).kind).toBe(
      "failed",
    );
  });
});
