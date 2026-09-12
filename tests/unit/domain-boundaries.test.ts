import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import * as battle from "../../src/battle/index.ts";
import * as content from "../../src/content/index.ts";
import * as contentActivation from "../../src/battle/content-activation.ts";
import * as deckEditor from "../../src/deck-editor/index.ts";
import * as deckSelect from "../../src/deck-select/index.ts";
import * as decks from "../../src/decks/index.ts";
import * as shell from "../../src/shell/index.ts";
import * as story from "../../src/story/index.ts";

/* ADR-022 boundaries, checked against resolved paths rather than specifier
   text. `eslint.config.js` carries the same rules for inline feedback, but a
   specifier glob reads the text a file wrote rather than the file it reaches,
   so this file is the airtight half of the pair. Both run in
   `npm run check:headless`. */

const projectRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const sourceRoot = path.join(projectRoot, "src");

type Domain =
  | "main"
  | "shell"
  | "story"
  | "deck-editor"
  | "deck-select"
  | "battle"
  | "decks"
  | "content";

const PUBLIC_ENTRY: Readonly<Record<Domain, string | null>> = Object.freeze({
  main: null,
  content: "src/content/index.ts",
  shell: "src/shell/index.ts",
  story: "src/story/index.ts",
  "deck-editor": "src/deck-editor/index.ts",
  "deck-select": "src/deck-select/index.ts",
  battle: "src/battle/index.ts",
  /* `src/decks` is the shared deck-data library the three UI domains all read,
     not a lazy UI domain. Its index is frozen below so widening it stays
     deliberate, but its modules are importable directly. */
  decks: "src/decks/index.ts",
});

/* Allowed per importing file, never per domain, and mirrored in
   `eslint.config.js`. All of these exist because the only entry that could
   legally carry them — `src/battle/index.ts` — also exports `BattleFacade`: a
   static import of it from the shell makes the duel an eager dependency and
   takes the entry chunk from 2.62 kB to 339.73 kB. Each allowance disappears
   when its module gets a legal home. */
const ALLOWANCES: Readonly<Record<string, readonly string[]>> = Object.freeze({
  // Pure install-only validation avoids loading BattleFacade.
  "src/shell/screens/InstallContentScreen.svelte": [
    "src/battle/content-activation.ts",
  ],
  // Shared pure deck rules, never UI/gameplay chunks; owner-approved T4 exception.
  "src/content/install/verify-gameplay.ts": [
    "src/decks/catalog/pinned-ruleset.ts",
    "src/decks/catalog/ocg-mask.ts",
  ],
  "src/content/storage/content-database.ts": ["idb"],
  "src/content/storage/content-reader.ts": ["idb"],
  "src/shell/admin/admin-actions.ts": [
    /* Deck-format and preset asset modules. `src/decks/index.ts` cannot carry
       them either: it is reached eagerly from `src/shell/routes.ts`, so six raw
       `.ydk` payloads would land in the entry chunk. */
    "src/battle/duel/presets/deck-parser.ts",
    "src/battle/duel/presets/deck-sources-browser.ts",
    /* The duel's snapshot database name, so the console can reset it. */
    "src/battle/storage/snapshot-store.ts",
  ],
  /* The duel's v2 UI-state key and shape, which the shell's v3 settings migrate
     from on first load. */
  "src/shell/settings/shell-settings.ts": [
    "src/battle/app/stores/persisted-ui-state.ts",
  ],
  /* The story's duel-handoff vocabulary. `src/story/index.ts` also exports
     `StoryApp`, so a static import of it from the shell would make the visual
     novel eager; this module holds pure functions and no component. */
  "src/shell/handoff/handoff-coordinator.ts": [
    "src/story/handoff/story-handoff.ts",
  ],
  /* The quarter-turn stage mapping the overlay thumb drags through. The panel
     it belongs to is shared, so the component now lives in the shell, but the
     mapping stays duel presentation: `src/battle/index.ts` exports
     `BattleFacade`, and the shell entry is eager. The allowance disappears when
     `stage-frame.ts` gets a legal home. */
  "src/shell/card-preview/OverlayScrollbar.svelte": [
    "src/battle/app/presentation/stage-frame.ts",
  ],
  "src/decks/ydk-adapter.ts": ["src/battle/duel/presets/deck-parser.ts"],
});

/* `src/acceptance-main.ts` is the build entry for the duel acceptance harness
   that lives in `src/battle/app/acceptance/`, so it belongs to battle. */
function domainOf(file: string): Domain {
  if (file === "src/main.ts") return "main";
  if (file === "src/acceptance-main.ts") return "battle";
  if (file.startsWith("src/content/")) return "content";
  if (file.startsWith("src/shell/")) return "shell";
  if (file.startsWith("src/story/")) return "story";
  if (file.startsWith("src/deck-editor/")) return "deck-editor";
  if (file.startsWith("src/deck-select/")) return "deck-select";
  if (file.startsWith("src/decks/")) return "decks";
  if (file.startsWith("src/battle/")) return "battle";
  throw new Error(
    `${file} belongs to no declared domain; classify it in tests/unit/domain-boundaries.test.ts`,
  );
}

function isLegalImport(from: string, to: string): boolean {
  if (ALLOWANCES[from]?.includes(to) === true) return true;

  const source = domainOf(from);
  if (source === "content") return to.startsWith("src/content/");
  const target = domainOf(to);
  if (source === target) return true;

  /* The entry document mounts the shell and nothing else. */
  if (source === "main") return target === "shell";
  /* Shared deck data is open to every domain. */
  if (target === "decks") return true;
  /* The visual novel types a battle handoff without mounting one. */
  if (source === "story" && to === "src/battle/battle-contracts.ts")
    return true;

  return to === PUBLIC_ENTRY[target];
}

function sourceFiles(): readonly string[] {
  const found: string[] = [];
  const walk = (directory: string): void => {
    for (const entry of readdirSync(directory).sort()) {
      const absolute = path.join(directory, entry);
      if (statSync(absolute).isDirectory()) {
        walk(absolute);
        continue;
      }
      if (entry.endsWith(".d.ts")) continue;
      if (!entry.endsWith(".ts") && !entry.endsWith(".svelte")) continue;
      found.push(
        path.relative(projectRoot, absolute).split(path.sep).join("/"),
      );
    }
  };
  walk(sourceRoot);
  return found;
}

const SPECIFIER =
  /(?:\bfrom\s*|\bimport\s*\(?\s*|\brequire\s*\(\s*)["']([^"']+)["']/g;

/** Repo-relative code targets; content also checks bare/outside-src tooling imports. */
function importsOf(
  file: string,
  text = readFileSync(path.join(projectRoot, file), "utf8"),
): readonly string[] {
  const directory = path.posix.dirname(file);
  const targets: string[] = [];
  for (const [, specifier] of text.matchAll(SPECIFIER)) {
    if (specifier === undefined) continue;
    if (!specifier.startsWith(".")) {
      if (domainOf(file) === "content") targets.push(specifier);
      continue;
    }
    const resolved = path.posix.normalize(
      path.posix.join(directory, specifier.split("?")[0] ?? specifier),
    );
    if (domainOf(file) === "content") {
      targets.push(resolved);
      continue;
    }
    if (!resolved.startsWith("src/")) continue;
    if (!resolved.endsWith(".ts") && !resolved.endsWith(".svelte")) continue;
    targets.push(resolved);
  }
  return targets;
}

/** Value and type export names declared by a public entry's own source. */
function declaredExports(entry: string): {
  readonly values: readonly string[];
  readonly types: readonly string[];
} {
  const text = readFileSync(path.join(projectRoot, entry), "utf8");
  const values: string[] = [];
  const types: string[] = [];
  for (const [, typeKeyword, body] of text.matchAll(
    /export\s+(type\s+)?\{([^}]*)\}/g,
  )) {
    for (const raw of (body ?? "").split(",")) {
      const clause = raw.trim();
      if (clause === "") continue;
      const entryIsType =
        typeKeyword !== undefined || clause.startsWith("type ");
      const name = clause
        .replace(/^type\s+/, "")
        .split(/\s+as\s+/)
        .at(-1);
      if (name === undefined) continue;
      (entryIsType ? types : values).push(name);
    }
  }
  for (const [, name] of text.matchAll(
    /export\s+(?:const|function|class)\s+([A-Za-z0-9_$]+)/g,
  ))
    if (name !== undefined) values.push(name);
  return { values: values.sort(), types: types.sort() };
}

describe("public domain APIs are frozen", () => {
  /* Widening any list below is a deliberate edit, not a silent change. */
  const expected = [
    {
      name: "content",
      entry: "src/content/index.ts",
      namespace: content,
      values: [
        "CONTENT_CACHE_NAME",
        "CONTENT_DATABASE_NAME",
        "CONTENT_DATABASE_VERSION",
        "CONTENT_FILE_MAX_BYTES",
        "CONTENT_INSTALLER_LOCK",
        "ZIP_PART_MAX_BYTES",
        "ZIP_PART_MAX_UNPACKED_BYTES",
        "contentObjectUrl",
        "createContentInstaller",
        "openContentReader",
        "parseChapterGameplay",
        "parseChapterSelections",
        "parseChapterStoryDocument",
        "parseContentIndex",
        "parseContentManifest",
        "parseCoreBootstrap",
      ],
      types: [
        "ChapterCard",
        "ChapterChoiceId",
        "ChapterContentPolicy",
        "ChapterDeck",
        "ChapterFileRef",
        "ChapterGameplay",
        "ChapterId",
        "ChapterOpponent",
        "ChapterRarity",
        "ChapterReadiness",
        "ChapterRelease",
        "ChapterSelection",
        "ChapterSelections",
        "ChapterSet",
        "ChapterStoryDocument",
        "ContentFailure",
        "ContentFailureCode",
        "ContentIndex",
        "ContentInstaller",
        "ContentManager",
        "ContentManifest",
        "ContentMediaType",
        "ContentReadPort",
        "ContentResult",
        "ContentSessionLease",
        "ContentSetRef",
        "CoreBootstrap",
        "CoreChapterId",
        "DownloadJob",
        "DownloadPhase",
        "DownloadProgress",
        "DownloadResult",
        "DownloadTarget",
        "InstallReceipt",
        "InstalledContentSet",
        "InstalledRuntimeReceipt",
        "ManifestRef",
        "PackId",
        "PackedFile",
        "PersistedDownloadJob",
        "RuntimeActivationPort",
        "RuntimeReceiptFile",
        "RuntimeSnapshotRef",
        "SavedContentRefsPort",
        "Sha256",
        "StoryContentBinding",
        "VerifiedMetadata",
        "ZipPart",
      ],
    },

    {
      name: "battle content activation",
      entry: "src/battle/content-activation.ts",
      namespace: contentActivation,
      values: ["createRuntimeActivationPort"],
      types: [],
    },
    {
      name: "battle",
      entry: "src/battle/index.ts",
      namespace: battle,
      /* T17, deliberate widening: the free-play match setup builds a
         `BattleRequest` before the duel mounts, so the shell needs the bundled
         list the picker offers, the seats a lost key falls back to, and the
         preset-only listing a library that will not open answers with. Deck
         metadata only — the `.ydk` payloads stay behind
         `deck-sources-browser.ts` — and every one of them is reached through
         `loaders.duel()`, never a static import, or the duel turns eager and
         the shell budget in `verify-browser-build.ts` rejects the build. */
      values: [
        "BattleFacade",
        "BattleRequestError",
        "DECK_CATALOG",
        "DEFAULT_OPPONENT_DECK_ID",
        "DEFAULT_PLAYER_DECK_ID",
        "findSelectableDeck",
        "listSelectableDecks",
        "parseBattleRequest",
        "presetSelectableDecks",
        "settleOnce",
      ],
      types: [
        "BattleDeckSelection",
        "BattleFacadeResult",
        "BattleOutcome",
        "BattleRequest",
        "SelectableDeck",
      ],
    },
    {
      name: "decks",
      entry: "src/decks/index.ts",
      namespace: decks,
      values: [
        "DECK_DATABASE_NAME",
        "DeckMigrationError",
        "deckId",
        "resolveDeck",
      ],
      types: [
        "DeckId",
        "DeckRecord",
        "DeckRepository",
        "DeckValidationIssue",
        "ResolveDeckResult",
        "ValidatedDeckSnapshot",
      ],
    },
    {
      name: "deck-editor",
      entry: "src/deck-editor/index.ts",
      namespace: deckEditor,
      values: ["default"],
      types: ["DeckEditorRoute"],
    },
    {
      name: "deck-select",
      entry: "src/deck-select/index.ts",
      namespace: deckSelect,
      /* T11: a new public entry. The deck-selection screen is one shared
         presentational library the shell, the visual novel and the deck editor
         all mount, so it is a domain of its own rather than a folder inside
         any one of them. It holds view models and pure functions only — hosts
         map their own records into `DeckTileModel`, so nothing here reads
         storage and nothing here can turn a host eager.

         T12, deliberate widening of one name: `DeckTile` is the one tile the
         grid, the library, the seat cards and the mobile list all render, so
         every host reaches the same component instead of copying it. It is a
         presentational component with no store and no loader, so naming it
         here makes no host eager.

         T13, deliberate widening of three names: the tile's kebab sheet and
         the rename and delete dialogs its actions open. Every host that shows
         a tile shows the same four actions, and the dialogs are the shape the
         host confirms them with, so all three are reached here rather than
         re-authored per screen. Presentational like the tile — the host owns
         the menu/dialog state and performs the operation itself.

         T14, deliberate widening of one name: `DeckSelectScreen`, the screen
         those parts compose into. It is the whole point of the library — the
         hosts mount it instead of re-assembling header, tools, grid and footer
         each time — and it owns the menu/dialog state machine the four names
         above deliberately left to a host. Still presentational: it takes view
         models and callbacks, so it reads no storage and turns no host
         eager.

         T16, deliberate widening of one name: `pinSelectedFirst`, the narrow
         layout's extra list transform. It sits beside `orderDeckTiles` because
         it is the same kind of thing — a pure ranking step over view models —
         and a host that renders its own phone list has to reach the same order
         the screen does rather than re-derive it.

         T17, deliberate widening of one name: `DecklistPanel`, the sectioned
         Main/Extra/Side list of one deck. The screen renders it twice over —
         floated beside a hovered duel-start tile, docked in the library's
         second column — so it is the same one-atom argument as `DeckTile`, and
         a host showing a decklist of its own reaches it here. Presentational
         like the rest: it takes a `DecklistView` the host resolved and reads
         nothing itself. */
      values: [
        "DeckSelectScreen",
        "DeckTile",
        "DeckTileMenu",
        "DecklistPanel",
        "DeleteDeckConfirm",
        "RenameDeckDialog",
        "orderDeckTiles",
        "pinSelectedFirst",
      ],
      types: [
        "DeckSelectMode",
        "DeckSelectScope",
        "DeckSort",
        "DeckTileModel",
        "DecklistRow",
        "DecklistView",
        "OpponentView",
      ],
    },
    {
      name: "story",
      entry: "src/story/index.ts",
      namespace: story,
      /* R3, deliberate narrowing of two names: `createStoryDeckRepository` and
         `storyCardOwnership` are gone from this entry. Neither had a consumer
         outside `src/story/` — the shell binds `openStoryDeckContext` — and
         between them they re-opened the hole T23 closed: a caller holding the
         bare constructor could assemble `{ kind: "story", createRepository,
         ownership: unlimitedCardOwnership() }` and type-check, which is a story
         save edited against every printed card. Both modules stay where they
         are and are still reached from inside the domain.

         T23, deliberate widening of one name: `openStoryDeckContext` is the
         only constructor of a story deck context. The shell binds the editor
         to it, and building one outside the story would mean exporting the
         reducer and letting a caller pair one save's decks with another save's
         ownership.

         T29, deliberate widening of three more: the collection browser. A
         collection is counts only, so the rarity every tile is grouped by is
         resolved from the shop's set data and the inference beside it — story
         internals the shell may not reach — while the screen itself is mounted
         for both worlds. All three are reached through the shell's lazy
         `import("../story/index.ts")`, never a static import, or the visual
         novel turns eager and the shell budget in `verify-browser-build.ts`
         rejects the build. `loadCollectionScreen` is a loader rather than a
         re-export of the component for the same reason one level down:
         `StoryApp` never renders that screen, and carrying it took the story
         closure from 126,110 to 132,976 bytes, inside the 143,750 budget but
         under the 10% headroom `domain-chunk-closure.test.ts` requires.

         T28, deliberate widening of one more: `encounterDeck` resolves the deck
         an encounter is fought with. A reload that lands on a duel session has
         no story mounted to resolve it and the shell has neither the save's
         ownership nor the catalog, so the resolver has to be reachable — and
         there must be exactly one of it, or the briefing and the duel could
         disagree about which decks are legal. */
      values: [
        "ENCOUNTER_LABELS",
        "STORY_SAVES_DATABASE_NAME",
        "acceptsResult",
        "createStorySaveRepository",
        "default",
        "encounterDeck",
        "loadCollectionCatalog",
        "loadCollectionScreen",
        "openStoryDeckContext",
        "restoreStoryState",
        "storyBattleResult",
        "toStoryResolution",
      ],
      types: [
        "CollectionCatalog",
        "EncounterId",
        "PendingStoryDuel",
        "StoryDuelResolution",
        "StoryEncounterIntent",
        "StoryEncounterRequest",
        "StoryHandoffOutcome",
        "StorySaveEnvelope",
        "StorySaveReadResult",
        "StorySaveRepository",
        "StorySaveSummary",
        "StorySaveWriteResult",
        "StorySlotKey",
        "StoryState",
      ],
    },
    {
      name: "shell",
      entry: "src/shell/index.ts",
      namespace: shell,
      values: [
        "CardPreviewPanel",
        "OverlayScrollbar",
        "STAGE_ASPECT_HEIGHT",
        "STAGE_ASPECT_WIDTH",
        "STAGE_BREAKPOINT_PX",
        "STAGE_CONTEXT_KEY",
        "TOAST_CONTEXT_KEY",
        "computeStageBox",
        "routeLabel",
        "selectStageMode",
      ],
      types: [
        "CardPreviewImageSource",
        "CardPreviewView",
        "StageBox",
        "StageMode",
        "ToastPublisher",
        "ToastRequest",
        "ToastTone",
      ],
    },
  ] as const;

  for (const domain of expected) {
    it(`${domain.name} public API is exact`, () => {
      expect(Object.keys(domain.namespace).sort()).toEqual([...domain.values]);
      expect(declaredExports(domain.entry).types).toEqual([...domain.types]);
    });
  }
});

describe("domain imports", () => {
  it("installer exceptions remain exact-file pure validation boundaries", () => {
    expect(
      isLegalImport(
        "src/content/install/verify-gameplay.ts",
        "src/decks/catalog/pinned-ruleset.ts",
      ),
    ).toBe(true);
    expect(
      isLegalImport(
        "src/content/probe.ts",
        "src/decks/catalog/pinned-ruleset.ts",
      ),
    ).toBe(false);
    expect(
      isLegalImport(
        "src/content/install/verify-gameplay.ts",
        "src/decks/index.ts",
      ),
    ).toBe(false);
    expect(
      isLegalImport(
        "src/shell/screens/InstallContentScreen.svelte",
        "src/battle/content-activation.ts",
      ),
    ).toBe(true);
    expect(
      isLegalImport("src/shell/probe.ts", "src/battle/content-activation.ts"),
    ).toBe(false);
  });
  it("content rejects dynamic Node and scripts imports", () => {
    for (const specifier of [
      "node:fs",
      "fs",
      "fs/promises",
      "../../scripts/content-catalog.ts",
      "../../scripts/lib/asset-delivery/bundle.ts",
    ]) {
      const targets = importsOf(
        "src/content/probe.ts",
        `import("${specifier}")`,
      );
      expect(targets).toHaveLength(1);
      expect(isLegalImport("src/content/probe.ts", targets[0]!)).toBe(false);
    }
    expect(isLegalImport("src/content/probe.ts", "src/content/index.ts")).toBe(
      true,
    );
  });
  it("no deep cross-domain imports", () => {
    const violations = sourceFiles().flatMap((file) =>
      importsOf(file)
        .filter((target) => !isLegalImport(file, target))
        .map((target) => `${file} -> ${target}`),
    );
    expect(violations).toEqual([]);
  });

  it("no worker imports outside the battle domain", () => {
    const violations = sourceFiles()
      .filter((file) => domainOf(file) !== "battle")
      .flatMap((file) =>
        importsOf(file)
          .filter((target) => target.startsWith("src/battle/worker/"))
          .map((target) => `${file} -> ${target}`),
      );
    expect(violations).toEqual([]);
  });

  it("every allowance names a file that still needs it", () => {
    for (const [file, targets] of Object.entries(ALLOWANCES))
      expect(importsOf(file)).toEqual(expect.arrayContaining([...targets]));
  });
});

it("no catch-all source folders", () => {
  const catchAll = readdirSync(sourceRoot).filter((entry) =>
    ["shared", "common", "utils", "core"].includes(entry),
  );
  expect(catchAll).toEqual([]);
});
