const sha = "a".repeat(64);
const ref = (prefix: string, ext = "json") => ({
  key: `${prefix}/${sha}.${ext}`,
  bytes: 1,
  sha256: sha,
});
const file = { path: "assets/story/test.svg", bytes: 1, sha256: sha };
const profile = { schemaVersion: 1, id: "core", dependsOn: [], rules: [] };
const selection = { schemaVersion: 1, profiles: ["core"] };
const retained = { schemaVersion: 1, catalogs: [], manifests: [] };
const preparedStory = {
  schemaVersion: 1,
  contentId: "prototype-prologue-v1",
  title: "Story",
  beats: [
    {
      id: "beat",
      speaker: null,
      kind: "narration",
      text: "Text",
      background: "station",
      characters: [],
    },
  ],
  choices: [
    { id: "trust-rin", label: "Trust" },
    { id: "challenge-rin", label: "Challenge" },
    { id: "observe-first", label: "Observe" },
  ],
  choiceResponses: {
    "trust-rin": "Trust",
    "challenge-rin": "Challenge",
    "observe-first": "Observe",
  },
  laterAcknowledgments: {
    "trust-rin": "Trust",
    "challenge-rin": "Challenge",
    "observe-first": "Observe",
  },
  mapImage: { packId: "chapter-01", path: "story/map.svg" },
};
const preparedGameplay = {
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
        description: "Text",
        strings: [],
      },
      fullImage: { packId: "chapter-01", path: "cards/1.jpg" },
      croppedImage: { packId: "chapter-01", path: "cards/cropped/1.jpg" },
    },
  ],
  sets: [
    {
      id: "first",
      name: "First",
      releaseYear: 2002,
      image: { packId: "chapter-01", path: "sets/first.jpg" },
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
      id: "deck",
      name: "Deck",
      main: Array.from({ length: 40 }, () => 1),
      extra: [],
      side: [],
    },
  ],
  opponents: [
    {
      id: "opponent",
      name: "Opponent",
      line: "Line",
      deckId: "deck",
      policyId: "basic",
    },
  ],
  defaults: { starterDeckId: "deck", opponentId: "opponent" },
  story: {
    contentId: "prototype-prologue-v1",
    document: { packId: "chapter-01", path: "chapters/chapter-01/story.json" },
  },
};
const prepared = {
  schemaVersion: 2,
  sourceInputs: [{ ...file, path: "content/chapter-selections.json" }],
  runtimeSnapshotId: sha,
  runtimeCardCodes: [1],
  chapters: [
    {
      id: "chapter-01",
      title: "One",
      description: "First chapter",
      storyContentId: "prototype-prologue-v1",
      setIds: ["first"],
      unavailableSetImageIds: [],
      cardCodes: [1],
      opponentIds: ["opponent"],
      gameplay: preparedGameplay,
      story: preparedStory,
    },
  ],
};
const selected = {
  ...file,
  root: "story",
  sourcePath: "test.svg",
  profile: "dev-only",
  logicalPath: null,
};
const receipt = {
  schemaVersion: 1,
  layoutVersion: 1,
  snapshotSha256: sha,
  files: [file],
  retired: [],
};
const state = {
  schemaVersion: 1,
  nightly: null,
  releases: [],
  retiredNightlies: [],
};
const prune = {
  schemaVersion: 1,
  scope: "local",
  basisSha256: sha,
  candidates: [file],
};

export const schemaFixtures = {
  identity: { kind: "release", version: "0.1.0" },
  "asset-profile": profile,
  "file-digest": file,
  "selected-asset": selected,
  "retained-metadata": retained,
  "prepared-player-metadata": prepared,
  "frozen-inventory": {
    schemaVersion: 1,
    appVersion: "0.1.0",
    runtimeSnapshotId: null,
    profiles: [profile],
    selection,
    files: [selected],
    vendorFiles: [],
    retainedMetadata: retained,
    playerMetadata: null,
  },
  "object-ref": ref("inventories"),
  "dev-manifest": {
    schemaVersion: 1,
    appVersion: "0.1.0",
    layoutVersion: 1,
    inventory: ref("inventories"),
    archive: ref("dev/archives", "zip"),
    files: [file],
  },
  "core-manifest": {
    schemaVersion: 1,
    appVersion: "0.1.0",
    inventory: ref("inventories"),
    archive: ref("core/archives", "zip"),
    files: [{ ...file, logicalPath: "story/test.svg" }],
  },
  "core-copy-plan": {
    schemaVersion: 1,
    snapshot: ref("snapshots"),
    prodInventory: ref("inventories"),
    coreManifest: ref("core/manifests"),
    files: [
      {
        stagedPath: `generated/asset-delivery/core/${sha}/files/${file.path}`,
        logicalPath: "fonts/test.woff2",
        bytes: 1,
        sha256: sha,
      },
    ],
  },
  "bundle-snapshot": {
    schemaVersion: 1,
    appVersion: "0.1.0",
    inventory: ref("inventories"),
    dev: ref("dev/manifests"),
    prod: null,
    objects: [
      ref("dev/archives", "zip"),
      ref("dev/manifests"),
      ref("inventories"),
    ],
  },
  "release-pointer": {
    schemaVersion: 1,
    version: "0.1.0",
    snapshot: ref("snapshots"),
  },
  "install-receipt": receipt,
  "install-journal": {
    schemaVersion: 1,
    snapshotSha256: sha,
    phase: "prepared",
    previousReceipt: null,
    nextReceipt: receipt,
    changes: [{ path: file.path, before: null, after: file }],
  },
  "prune-plan": prune,
  "publication-inventory": state,
  "prune-journal": {
    schemaVersion: 1,
    plan: prune,
    phase: "prepared",
    intentPaths: [],
    completedPaths: [],
    nextState: null,
    nextReceipt: { ...receipt, files: [] },
  },
  "migration-plan": {
    schemaVersion: 1,
    files: [
      {
        from: "src/story/assets/test.svg",
        to: file.path,
        bytes: 1,
        sha256: sha,
      },
    ],
  },
  "asset-result": { status: "ok", operation: "setup", snapshotSha256: null },
};

export const parserNames: Record<keyof typeof schemaFixtures, string> = {
  identity: "parseChannel",
  "asset-profile": "parseAssetProfile",
  "file-digest": "parseFileDigest",
  "selected-asset": "parseSelectedAsset",
  "retained-metadata": "parseRetainedMetadata",
  "prepared-player-metadata": "parsePreparedPlayerMetadata",
  "frozen-inventory": "parseFrozenInventory",
  "object-ref": "parseObjectRef",
  "dev-manifest": "parseDevManifest",
  "core-manifest": "parseCoreManifest",
  "core-copy-plan": "parseCoreCopyPlan",
  "bundle-snapshot": "parseBundleSnapshot",
  "release-pointer": "parseReleasePointer",
  "install-receipt": "parseInstallReceipt",
  "install-journal": "parseInstallJournal",
  "prune-plan": "parsePrunePlan",
  "publication-inventory": "parsePublicationInventory",
  "prune-journal": "parsePruneJournal",
  "migration-plan": "parseMigrationPlan",
  "asset-result": "parseAssetResult",
};
