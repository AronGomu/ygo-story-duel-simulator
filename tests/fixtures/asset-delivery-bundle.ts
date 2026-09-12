import { createHash } from "node:crypto";
import { cp, mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { after } from "node:test";
import { canonicalBytes } from "../../scripts/lib/asset-delivery/canonical-json.ts";

export const sha = (bytes: Uint8Array) =>
  createHash("sha256").update(bytes).digest("hex");
const fixtureBase = path.resolve(".tmp/ship-t3-20260909/fixtures");
const ownedFixtures: string[] = [];
after(async () => {
  const { rm } = await import("node:fs/promises");
  for (const root of ownedFixtures) await rm(root, { recursive: true });
});
export async function put(
  root: string,
  file: string,
  value: string | Uint8Array,
) {
  await mkdir(path.dirname(path.join(root, file)), { recursive: true });
  await writeFile(path.join(root, file), value);
}
export async function fixture(reverse = false) {
  await mkdir(fixtureBase, { recursive: true });
  const root = await mkdtemp(path.join(fixtureBase, "bundle-"));
  ownedFixtures.push(root);
  await put(root, "package.json", '{"version":"0.1.0"}');
  const profiles = [
    {
      id: "core",
      dependsOn: [],
      rules: [
        { root: "shared", path: "fonts", kind: "tree", logicalPath: "fonts" },
      ],
    },
    {
      id: "runtime",
      dependsOn: [],
      rules: [
        {
          root: "shared",
          path: "data/current/catalog",
          kind: "tree",
          logicalPath: "runtime/assets/current/catalog",
        },
        {
          root: "shared",
          path: "runtime",
          kind: "tree",
          logicalPath: "runtime/current",
        },
      ],
    },
    {
      id: "chapter-01",
      dependsOn: ["runtime"],
      rules: [
        {
          root: "story",
          path: "map.png",
          kind: "file",
          logicalPath: "story/media/map.png",
        },
        {
          root: "story",
          path: "missing.jpg",
          kind: "file",
          logicalPath: "story/media/missing.jpg",
        },
      ],
    },
  ];
  for (const profile of profiles)
    await put(
      root,
      `asset-profiles/${profile.id}.json`,
      canonicalBytes({ schemaVersion: 1, ...profile }),
    );
  await put(
    root,
    "asset-profiles/nightly.json",
    canonicalBytes({
      schemaVersion: 1,
      profiles: ["core", "runtime", "chapter-01"],
    }),
  );
  const files: [string, string][] = [
    ["assets/shared/fonts/test.woff2", "font"],
    [
      "assets/shared/runtime/manifest.json",
      '{"schemaVersion":1,"snapshotId":"' + "a".repeat(64) + '"}',
    ],
    ["assets/story/map.png", "deliberately-not-decodable-image"],
    ["assets/battle/original.blend", "original"],
    ["assets/deck-editor/unused.kra", "unreleased"],
  ];
  for (const [file, bytes] of reverse ? files.reverse() : files)
    await put(root, file, bytes);
  await put(
    root,
    "assets/shared/data/current/catalog/cards/00.json",
    canonicalBytes(fixtureCodes.map(fixtureCardRecord)),
  );
  await put(
    root,
    "assets/shared/data/current/catalog/texts/en/00.json",
    canonicalBytes(fixtureCodes.map(fixtureCardText)),
  );
  await cp(
    "vendor/ocgcore-wasm/0.1.2",
    path.join(root, "vendor/ocgcore-wasm/0.1.2"),
    { recursive: true },
  );
  return root;
}
const fixtureCodes = Array.from({ length: 14 }, (_, index) => index + 1);
const fixtureCardRecord = (code: number) => ({
  code,
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
  category: 0,
});
const fixtureCardText = (code: number) => ({
  code,
  name: `Card ${code}`,
  description: "Description",
  strings: Array.from({ length: 16 }, () => ""),
});

const fixtureStory = {
  schemaVersion: 1 as const,
  contentId: "prototype-prologue-v1" as const,
  title: "Fixture story",
  beats: [
    {
      id: "arrival",
      speaker: null,
      kind: "narration" as const,
      text: "Arrival.",
      background: "station" as const,
      characters: [],
    },
  ],
  choices: [
    { id: "trust-rin" as const, label: "Trust" },
    { id: "challenge-rin" as const, label: "Challenge" },
    { id: "observe-first" as const, label: "Observe" },
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
  mapImage: { packId: "chapter-01" as const, path: "story/media/map.png" },
};

const fixtureGameplay = {
  schemaVersion: 1 as const,
  chapterId: "chapter-01" as const,
  cards: fixtureCodes.map((code) => {
    const source = fixtureCardRecord(code);
    return {
      code,
      record: {
        code: source.code,
        alias: source.alias,
        setcodes: source.setcodes,
        type: source.type,
        level: source.level,
        attribute: source.attribute,
        race: source.race,
        attack: source.attack,
        defense: source.defense,
        lscale: source.lscale,
        rscale: source.rscale,
        linkMarker: source.linkMarker,
        ot: source.ot,
      },
      text: fixtureCardText(code),
      fullImage: { packId: "chapter-01" as const, path: "story/media/map.png" },
      croppedImage: {
        packId: "chapter-01" as const,
        path: "story/media/map.png",
      },
    };
  }),
  sets: [
    {
      id: "original-set",
      name: "Original Set",
      releaseYear: 2002,
      image: { packId: "chapter-01" as const, path: "story/media/map.png" },
      cards: [
        {
          code: 1,
          name: "Card",
          rarity: "common" as const,
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
      main: [
        ...fixtureCodes.flatMap((code) => [code, code, code]).slice(0, 39),
        14,
      ],
      extra: [],
      side: [],
    },
  ],
  opponents: [
    {
      id: "practice-bot",
      name: "Practice Bot",
      line: "Practice.",
      deckId: "starter",
      policyId: "basic" as const,
    },
  ],
  defaults: { starterDeckId: "starter", opponentId: "practice-bot" },
  story: {
    contentId: "prototype-prologue-v1" as const,
    document: {
      packId: "chapter-01" as const,
      path: "chapters/chapter-01/story.json",
    },
  },
};

export const prepared = {
  schemaVersion: 2 as const,
  sourceInputs: [],
  runtimeSnapshotId: "a".repeat(64),
  runtimeCardCodes: fixtureCodes,
  chapters: [
    {
      id: "chapter-01" as const,
      title: "DM",
      description: "Fixture chapter.",
      storyContentId: "prototype-prologue-v1" as const,
      setIds: ["original-set"],
      unavailableSetImageIds: [],
      cardCodes: fixtureCodes,
      opponentIds: ["practice-bot"],
      gameplay: fixtureGameplay,
      story: fixtureStory,
    },
  ],
};
export async function current(root: string) {
  return JSON.parse(
    await readFile(
      path.join(root, "generated/asset-delivery/current.json"),
      "utf8",
    ),
  ) as {
    run: string;
    snapshot: { key: string; sha256: string; bytes: number };
  };
}
