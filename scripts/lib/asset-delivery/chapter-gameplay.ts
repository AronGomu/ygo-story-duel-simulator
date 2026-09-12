import type {
  ChapterCard,
  ChapterGameplay,
  ChapterOpponent,
  ChapterStoryDocument,
} from "../../../src/content/index.ts";
import {
  parseChapterGameplay,
  parseChapterStoryDocument,
} from "../../../src/content/index.ts";
import { parseYdk } from "../../../src/battle/duel/presets/deck-parser.ts";
import type {
  ChapterSourceSet,
  NormalizedChapterSource,
} from "../chapter-source-policy.ts";
import {
  chapterSetIdentities,
  type ExistingSetIdentity,
} from "../chapter-set-id.ts";
import { mapRarity } from "../shop-set-fold.ts";
import { compareCodePoints } from "./canonical-json.ts";
import { contentValue } from "./content-closure.ts";
import { fail } from "./failure.ts";

export interface RuntimeCardRecord {
  readonly code: number;
  readonly alias: number;
  readonly setcodes: readonly number[];
  readonly type: number;
  readonly level: number;
  readonly attribute: number;
  readonly race: string;
  readonly attack: number;
  readonly defense: number;
  readonly lscale: number;
  readonly rscale: number;
  readonly linkMarker: number;
  readonly ot: number;
  readonly category: number;
}

export interface RuntimeCardText {
  readonly code: number;
  readonly name: string;
  readonly description: string;
  readonly strings: readonly string[];
}

interface ChapterGameplayAuthoring {
  readonly schemaVersion: 1;
  readonly description: string;
  readonly decks: readonly {
    readonly id: string;
    readonly name: string;
    readonly path: string;
  }[];
  readonly opponents: readonly ChapterOpponent[];
  readonly defaults: {
    readonly starterDeckId: string;
    readonly opponentId: string;
  };
  readonly story: {
    readonly contentId: "prototype-prologue-v1";
    readonly document: string;
  };
}

function exactRecord(
  value: unknown,
  keys: readonly string[],
): Record<string, unknown> {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.keys(value).length !== keys.length ||
    keys.some((key) => !Object.hasOwn(value, key))
  )
    fail("ASSET_CONFIG_INVALID");
  return value as Record<string, unknown>;
}

function nonempty(value: unknown): string {
  if (typeof value !== "string" || !value.trim() || value.length > 512)
    fail("ASSET_CONFIG_INVALID");
  return value;
}

export function parseChapterGameplayAuthoring(
  value: unknown,
): ChapterGameplayAuthoring {
  const authoring = exactRecord(value, [
    "schemaVersion",
    "description",
    "decks",
    "opponents",
    "defaults",
    "story",
  ]);
  if (
    authoring.schemaVersion !== 1 ||
    !Array.isArray(authoring.decks) ||
    !Array.isArray(authoring.opponents)
  )
    fail("ASSET_CONFIG_INVALID");
  const decks = authoring.decks.map((value) => {
    const deck = exactRecord(value, ["id", "name", "path"]);
    const sourcePath = nonempty(deck.path);
    if (
      !/^src\/(?:battle\/duel\/presets\/decks|decks)\/[a-z0-9-]+\.ydk$/.test(
        sourcePath,
      )
    )
      fail("ASSET_CONFIG_INVALID");
    return {
      id: nonempty(deck.id),
      name: nonempty(deck.name),
      path: sourcePath,
    };
  });
  const opponents = authoring.opponents.map((value) => {
    const opponent = exactRecord(value, [
      "id",
      "name",
      "line",
      "deckId",
      "policyId",
    ]);
    if (opponent.policyId !== "basic") fail("ASSET_CONFIG_INVALID");
    return {
      id: nonempty(opponent.id),
      name: nonempty(opponent.name),
      line: nonempty(opponent.line),
      deckId: nonempty(opponent.deckId),
      policyId: "basic" as const,
    };
  });
  if (
    new Set(decks.map(({ id }) => id)).size !== decks.length ||
    new Set(opponents.map(({ id }) => id)).size !== opponents.length
  )
    fail("ASSET_CONFIG_INVALID");
  const defaults = exactRecord(authoring.defaults, [
    "starterDeckId",
    "opponentId",
  ]);
  const story = exactRecord(authoring.story, ["contentId", "document"]);
  if (story.contentId !== "prototype-prologue-v1") fail("ASSET_CONFIG_INVALID");
  return {
    schemaVersion: 1,
    description: nonempty(authoring.description),
    decks: decks.sort((a, b) => compareCodePoints(a.id, b.id)),
    opponents: opponents.sort((a, b) => compareCodePoints(a.id, b.id)),
    defaults: {
      starterDeckId: nonempty(defaults.starterDeckId),
      opponentId: nonempty(defaults.opponentId),
    },
    story: {
      contentId: "prototype-prologue-v1",
      document: nonempty(story.document),
    },
  };
}

function chapterCard(
  code: number,
  records: ReadonlyMap<number, RuntimeCardRecord>,
  texts: ReadonlyMap<number, RuntimeCardText>,
): ChapterCard {
  const source = records.get(code);
  const text = texts.get(code);
  if (!source || !text) fail("ASSET_REFERENCE_MISSING", String(code));
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
    text,
    fullImage: { packId: "chapter-01", path: `runtime/images/${code}.jpg` },
    croppedImage: {
      packId: "chapter-01",
      path: `runtime/images-cropped/${code}.jpg`,
    },
  };
}

export function buildChapterGameplay(input: {
  readonly normalized: NormalizedChapterSource;
  readonly existingSets: readonly ExistingSetIdentity[];
  readonly records: ReadonlyMap<number, RuntimeCardRecord>;
  readonly texts: ReadonlyMap<number, RuntimeCardText>;
  readonly authoring: ChapterGameplayAuthoring;
  readonly story: unknown;
  readonly deckSources: ReadonlyMap<string, string>;
  readonly selectedOpponentIds: readonly string[];
  readonly unavailableSetImageIds: ReadonlySet<string>;
}): {
  readonly description: string;
  readonly gameplay: ChapterGameplay;
  readonly story: ChapterStoryDocument;
  readonly setIds: readonly string[];
} {
  const story = contentValue(parseChapterStoryDocument(input.story));
  if (
    story.contentId !== input.authoring.story.contentId ||
    input.authoring.story.document !==
      "content/authoring/chapter-one-story.json"
  )
    fail("ASSET_CONFIG_INVALID");
  const identities = chapterSetIdentities(
    input.normalized.sets,
    input.existingSets,
  );
  const identityByName = new Map(identities.map((set) => [set.name, set]));
  const gameplay = contentValue(
    parseChapterGameplay({
      schemaVersion: 1,
      chapterId: "chapter-01",
      cards: input.normalized.cardCodes.map((code) =>
        chapterCard(code, input.records, input.texts),
      ),
      sets: input.normalized.sets.map((set: ChapterSourceSet) => {
        const identity = identityByName.get(set.name)!;
        return {
          id: identity.id,
          name: identity.name,
          releaseYear: identity.releaseYear,
          image: input.unavailableSetImageIds.has(identity.id)
            ? null
            : {
                packId: "chapter-01" as const,
                path: `runtime/sets/${identity.id}.jpg`,
              },
          cards: set.cards.flatMap((card) =>
            card.printings.map((printing) => ({
              code: card.id,
              name: card.name,
              rarity: mapRarity(printing.rarity),
              printingCode: printing.code,
              sourceRarity: printing.rarity,
              sourceRarityCode: printing.rarityCode,
            })),
          ),
        };
      }),
      decks: input.authoring.decks.map(({ id, name, path }) => {
        const source = input.deckSources.get(path);
        if (source === undefined) fail("ASSET_REFERENCE_MISSING", path);
        return { id, name, ...parseYdk(source) };
      }),
      opponents: input.authoring.opponents,
      defaults: input.authoring.defaults,
      story: {
        contentId: input.authoring.story.contentId,
        document: {
          packId: "chapter-01",
          path: "chapters/chapter-01/story.json",
        },
      },
    }),
  );
  if (
    input.selectedOpponentIds.length !== gameplay.opponents.length ||
    input.selectedOpponentIds.some(
      (id, index) => id !== gameplay.opponents[index]!.id,
    )
  )
    fail("ASSET_CONFIG_INVALID");
  return {
    description: input.authoring.description,
    gameplay,
    story,
    setIds: identities.map(({ id }) => id).sort(compareCodePoints),
  };
}
