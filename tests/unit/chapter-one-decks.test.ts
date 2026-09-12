import { ASSET_SOURCES } from "../../scripts/lib/asset-roots.ts";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { DECK_CATALOG } from "../../src/battle/duel/presets/deck-catalog.ts";
import { parseBattleRequest } from "../../src/battle/battle-contracts.ts";
import { parseDuelDeckSelection } from "../../src/battle/duel/contracts/duel-deck-selection.ts";
import {
  parseYdk,
  uniqueDeckCodes,
} from "../../src/battle/duel/presets/deck-parser.ts";
import { DECK_SOURCES } from "../../src/battle/duel/presets/deck-sources-browser.ts";
import { loadDeckSources } from "../../src/battle/duel/presets/deck-sources-node.ts";
import { reviewedCardPool } from "../../src/battle/duel/presets/reviewed-card-pool.ts";
import { loadActiveDuelDependenciesNode } from "../../src/battle/worker/assets/active-duel-dependencies-node.ts";
import { packagedCatalog } from "../../src/decks/catalog/packaged-catalog.ts";
import type { AssetDeckCardRecord } from "../../src/decks/catalog/ocg-card-mapper.ts";
import {
  catalogByCode,
  PROTOTYPE_RULESET,
} from "../../src/decks/catalog/pinned-ruleset.ts";
import { validateDeckDraft } from "../../src/decks/deck-validation.ts";
import { STARTER_DECK_LIST } from "../../src/decks/starter-deck.ts";
import { reduceStory } from "../../src/story/model/story-reducer.ts";
import { createInitialStoryState } from "../../src/story/model/story-state.ts";
import { migrateStorySaveState } from "../../src/story/saves/story-save-contracts.ts";
import {
  DEFAULT_FREE_PLAY_OPPONENT_ID,
  FREE_PLAY_OPPONENTS,
} from "../../src/shell/screens/free-play-opponents.ts";
import { buildAdminTestDeck } from "../../src/shell/admin/admin-actions.ts";
import {
  normalizeChapterSource,
  type ChapterSourceCorrections,
  type ChapterSourceSet,
} from "../../scripts/lib/chapter-source-policy.ts";

const base = [
  97590747, 5053103, 15025844, 50930991, 13039848, 23771716, 66788016, 5318639,
  4206964, 17814387, 12607053,
].flatMap((code) => [code, code, code]);
const main = (ace: number) =>
  [...base, 70781052, 70781052, ace, ace, 51482758, 51482758, 12580477].sort(
    (a, b) => a - b,
  );
const legacyIds = [
  "mvp-player",
  "mvp-opponent",
  "burning-abyss",
  "nekroz",
  "shaddoll",
  "spellbook",
];

describe("Chapter 1 bundled prerequisites", () => {
  it("browser and Node adapters expose only two new decks, never legacy IDs or their exclusive reviewed codes", async () => {
    const sources = await loadDeckSources();
    expect([...sources.keys()]).toEqual([
      "chapter-one-starter",
      "chapter-one-practice",
    ]);
    expect(DECK_SOURCES).toEqual(sources);
    for (const id of legacyIds)
      expect((sources as ReadonlyMap<string, string>).has(id)).toBe(false);
    expect(reviewedCardPool(sources)).toEqual(
      new Set([...main(46986414), ...main(89631139)]),
    );
  });

  it.each(legacyIds)(
    "production request adapters reject legacy preset %s",
    (deckId) => {
      expect(() =>
        parseDuelDeckSelection({ kind: "preset", deckId }),
      ).toThrow();
      expect(() =>
        parseBattleRequest({
          player: { kind: "preset", deckId },
          opponent: { kind: "preset", deckId: "chapter-one-practice" },
        }),
      ).toThrow("player.deckId is not a bundled deck");
    },
  );

  it("each active deck is exact 40/0/0, source-selected, buildable and runtime-supported under current quantities", async () => {
    const bytes = await readFile("content/authoring/card-set-source.json");
    expect(createHash("sha256").update(bytes).digest("hex")).toBe(
      "b3ac778e5f1b9927554ef8e66185a596c0c35d71ab642b448c952c6c9050496d",
    );
    const source = JSON.parse(bytes.toString("utf8")) as {
      sets: ChapterSourceSet[];
    };
    const selections = JSON.parse(
      await readFile("content/chapter-selections.json", "utf8"),
    ) as { chapters: { setNames: string[] }[] };
    const corrections = JSON.parse(
      await readFile("content/authoring/chapter-one-corrections.json", "utf8"),
    ) as ChapterSourceCorrections;
    const names = new Set(selections.chapters[0]!.setNames);
    const selected = new Set(
      normalizeChapterSource(
        source.sets.filter(({ name }) => names.has(name)),
        corrections,
      ).cardCodes,
    );
    const sources = await loadDeckSources();
    for (const { id } of DECK_CATALOG) {
      const deck = parseYdk(sources.get(id)!);
      expect([...deck.main].sort((a, b) => a - b)).toEqual(
        main(id === "chapter-one-starter" ? 46986414 : 89631139),
      );
      expect(deck.extra).toEqual([]);
      expect(deck.side).toEqual([]);
      const codes = uniqueDeckCodes(deck);
      expect([...codes].filter((code) => !selected.has(code))).toEqual([]);
      const dependencies = await loadActiveDuelDependenciesNode(
        ASSET_SOURCES.data.source,
        codes,
      );
      const shards = [
        ...new Set(
          [...codes].map((code) => (code % 64).toString(16).padStart(2, "0")),
        ),
      ];
      const records = (
        await Promise.all(
          shards.map(
            async (shard) =>
              JSON.parse(
                await readFile(
                  `${ASSET_SOURCES.data.source}/catalog/cards/${shard}.json`,
                  "utf8",
                ),
              ) as AssetDeckCardRecord[],
          ),
        )
      ).flat();
      const requested: ReadonlySet<number> = codes;
      const catalog = catalogByCode(
        packagedCatalog(
          records.filter(({ code }) => requested.has(code)),
          [...dependencies.texts.values()],
        ),
      );
      expect(
        validateDeckDraft(deck, catalog, PROTOTYPE_RULESET).issues.filter(
          ({ severity }) => severity === "error",
        ),
      ).toEqual([]);
      for (const code of codes) {
        const card = dependencies.cards.get(code)!;
        expect(card, String(code)).toBeDefined();
        // Normal monsters are implemented by the core, without per-card Lua.
        if (card.type !== 17)
          expect(
            dependencies.scripts.get(`c${code}.lua`),
            String(code),
          ).toBeTruthy();
      }
    }
  });

  it("new-game, new-library and admin starter agree; all three personas explicitly use DM practice", () => {
    expect(STARTER_DECK_LIST).toBe(DECK_SOURCES.get("chapter-one-starter"));
    const starter = parseYdk(STARTER_DECK_LIST);
    expect([...starter.main].sort((a, b) => a - b)).toEqual(main(46986414));
    const state = reduceStory(createInitialStoryState(), { type: "new-game" });
    expect(state.decks).toHaveLength(1);
    expect(state.decks[0]).toMatchObject({
      name: "Chapter 1 Starter",
      ...starter,
    });
    expect(state.collection).toEqual(
      Object.fromEntries(
        [...new Set(starter.main)].map((code) => [
          code,
          starter.main.filter((value) => value === code).length,
        ]),
      ),
    );
    expect(state.dp).toBe(1000);
    expect(buildAdminTestDeck()).toEqual(starter);
    expect(FREE_PLAY_OPPONENTS.map(({ id, deckKey }) => [id, deckKey])).toEqual(
      [
        ["practice-bot", "preset:chapter-one-practice"],
        ["blaze-circuit", "preset:chapter-one-practice"],
        ["vault-warden", "preset:chapter-one-practice"],
      ],
    );
    expect(DEFAULT_FREE_PLAY_OPPONENT_ID).toBe("practice-bot");
  });

  it("v1/v2 migration keeps the legacy grant; v3/v4 libraries, inventory and checkpoints remain unchanged", async () => {
    const legacySource = await readFile("src/decks/starter-deck.ydk", "utf8");
    expect(createHash("sha256").update(legacySource).digest("hex")).toBe(
      "f95eb17972e87365b665bdc72596380448092612b9a9ac357f610236162f3bef",
    );
    const legacy = parseYdk(legacySource);
    const raw: Record<string, unknown> = { ...createInitialStoryState() };
    delete raw.decks;
    delete raw.defaultDeckId;
    for (const version of [1, 2]) {
      const input = {
        ...raw,
        dp: 150,
        collection: { 89631139: 9 },
        pendingHandoffId: "saved-checkpoint",
      };
      const before = structuredClone(input);
      const migrated = migrateStorySaveState(input, version)!;
      expect(migrated.decks[0]).toMatchObject({
        name: "Starter Deck",
        id: "story-starter-deck",
        createdAt: "2026-08-20T00:00:00.000Z",
        ...legacy,
      });
      expect(migrated.collection).toEqual({
        ...Object.fromEntries(
          [...new Set(legacy.main)].map((code) => [
            code,
            legacy.main.filter((value) => value === code).length,
          ]),
        ),
        89631139: 9,
      });
      expect(migrated.collection[89631139]).toBe(9);
      expect(migrated.collection[46986414]).toBeUndefined();
      expect(migrated.collection[91152256]).toBe(3);
      expect(migrated.dp).toBe(150);
      expect(migrated.pendingHandoffId).toBe("saved-checkpoint");
      expect(migrateStorySaveState(input, version)).toEqual(migrated);
      expect(input).toEqual(before);
      for (const current of [3, 4])
        expect(migrateStorySaveState(migrated, current)).toEqual(migrated);
    }
  });
});
