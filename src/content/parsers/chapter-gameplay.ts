import type { ChapterCard } from "../contracts/chapter-card.ts";
import type { ChapterDeck } from "../contracts/chapter-deck.ts";
import type { ChapterFileRef } from "../contracts/chapter-file-ref.ts";
import type { ChapterGameplay } from "../contracts/chapter-gameplay.ts";
import type { ChapterId } from "../contracts/chapter-id.ts";
import type { ChapterOpponent } from "../contracts/chapter-opponent.ts";
import type { ChapterSet } from "../contracts/chapter-set.ts";
import type { ContentResult } from "../contracts/content-result.ts";
import {
  array,
  chapterId,
  compare,
  integer,
  invalid,
  literal,
  packId,
  record,
  result,
  safePath,
  sorted,
  text,
  unique,
} from "./schema.ts";

const rarities = [
  "common",
  "rare",
  "super-rare",
  "ultra-rare",
  "secret-rare",
  "ultimate-rare",
  "ghost-rare",
] as const;

function boundedText(value: unknown, max: number, empty = false): string {
  if (
    typeof value !== "string" ||
    value.length > max ||
    (!empty && !value.trim()) ||
    /[\uD800-\uDFFF]/u.test(value) ||
    [...value].some((character) => {
      const code = character.charCodeAt(0);
      return (
        (code < 32 && code !== 9 && code !== 10 && code !== 13) || code === 127
      );
    })
  )
    invalid();
  return value;
}

function signedInteger(value: unknown): number {
  if (
    typeof value !== "number" ||
    !Number.isSafeInteger(value) ||
    value < -0x80000000 ||
    value > 0x7fffffff
  )
    invalid();
  return value;
}

function fileRef(value: unknown): ChapterFileRef {
  const ref = record(value, ["packId", "path"]);
  return { packId: packId(ref.packId), path: safePath(ref.path) };
}

function chapterNumber(id: ChapterId): number {
  return Number(id.slice("chapter-".length));
}

function assertReachableRef(ref: ChapterFileRef, owner: ChapterId): void {
  if (
    ref.packId !== "runtime" &&
    chapterNumber(ref.packId) > chapterNumber(owner)
  )
    invalid();
}

function parseCard(value: unknown, owner: ChapterId): ChapterCard {
  const card = record(value, [
    "code",
    "record",
    "text",
    "fullImage",
    "croppedImage",
  ]);
  const code = integer(card.code, 0xffffffff, 1);
  const rawRecord = record(card.record, [
    "code",
    "alias",
    "setcodes",
    "type",
    "level",
    "attribute",
    "race",
    "attack",
    "defense",
    "lscale",
    "rscale",
    "linkMarker",
    "ot",
  ]);
  const setcodes = array(rawRecord.setcodes, (entry) => integer(entry, 0xffff));
  const rawText = record(card.text, ["code", "name", "description", "strings"]);
  const fullImage = fileRef(card.fullImage);
  const croppedImage = fileRef(card.croppedImage);
  assertReachableRef(fullImage, owner);
  assertReachableRef(croppedImage, owner);
  const parsed: ChapterCard = {
    code,
    record: {
      code: integer(rawRecord.code, 0xffffffff, 1),
      alias: integer(rawRecord.alias, 0xffffffff),
      setcodes,
      type: integer(rawRecord.type, 0xffffffff),
      level: integer(rawRecord.level, 0xffffffff),
      attribute: integer(rawRecord.attribute, 0xffffffff),
      race: boundedText(rawRecord.race, 20),
      attack: signedInteger(rawRecord.attack),
      defense: signedInteger(rawRecord.defense),
      lscale: integer(rawRecord.lscale, 0xffffffff),
      rscale: integer(rawRecord.rscale, 0xffffffff),
      linkMarker: integer(rawRecord.linkMarker, 0xffffffff),
      ot: integer(rawRecord.ot, 0xffffffff),
    },
    text: {
      code: integer(rawText.code, 0xffffffff, 1),
      name: text(rawText.name),
      description: boundedText(rawText.description, 4096, true),
      strings: array(
        rawText.strings,
        (entry) => boundedText(entry, 4096, true),
        64,
      ),
    },
    fullImage,
    croppedImage,
  };
  if (parsed.record.code !== code || parsed.text.code !== code) invalid();
  return parsed;
}

function parseSet(value: unknown, owner: ChapterId): ChapterSet {
  const set = record(value, ["id", "name", "releaseYear", "image", "cards"]);
  const image = set.image === null ? null : fileRef(set.image);
  if (image !== null) assertReachableRef(image, owner);
  const cards = array(set.cards, (value) => {
    const card = record(value, [
      "code",
      "name",
      "rarity",
      "printingCode",
      "sourceRarity",
      "sourceRarityCode",
    ]);
    return {
      code: integer(card.code, 0xffffffff, 1),
      name: text(card.name),
      rarity: literal(card.rarity, ...rarities),
      printingCode: text(card.printingCode),
      sourceRarity: text(card.sourceRarity),
      sourceRarityCode: boundedText(card.sourceRarityCode, 64, true),
    };
  });
  if (cards.length === 0) invalid();
  sorted(
    cards,
    (left, right) =>
      left.code - right.code ||
      compare(left.printingCode, right.printingCode) ||
      compare(left.sourceRarity, right.sourceRarity) ||
      compare(left.sourceRarityCode, right.sourceRarityCode),
  );
  return {
    id: text(set.id),
    name: text(set.name),
    releaseYear: integer(set.releaseYear, 9999, 1),
    image,
    cards,
  };
}

function parseDeck(value: unknown): ChapterDeck {
  const deck = record(value, ["id", "name", "main", "extra", "side"]);
  const codes = (value: unknown, max: number) =>
    array(value, (code) => integer(code, 0xffffffff, 1), max);
  const parsed: ChapterDeck = {
    id: text(deck.id),
    name: text(deck.name),
    main: codes(deck.main, 60),
    extra: codes(deck.extra, 15),
    side: codes(deck.side, 15),
  };
  if (parsed.main.length < 40) invalid();
  return parsed;
}

function parseOpponent(value: unknown): ChapterOpponent {
  const opponent = record(value, ["id", "name", "line", "deckId", "policyId"]);
  return {
    id: text(opponent.id),
    name: text(opponent.name),
    line: text(opponent.line),
    deckId: text(opponent.deckId),
    policyId: literal(opponent.policyId, "basic"),
  };
}

export function parseChapterGameplay(
  value: unknown,
): ContentResult<ChapterGameplay> {
  return result(value, 4194304, (value) => {
    const gameplay = record(value, [
      "schemaVersion",
      "chapterId",
      "cards",
      "sets",
      "decks",
      "opponents",
      "defaults",
      "story",
    ]);
    const owner = chapterId(gameplay.chapterId);
    const cards = array(gameplay.cards, (card) => parseCard(card, owner));
    const sets = array(gameplay.sets, (set) => parseSet(set, owner), 2048);
    const decks = array(gameplay.decks, parseDeck, 2048);
    const opponents = array(gameplay.opponents, parseOpponent, 2048);
    const defaults = record(gameplay.defaults, ["starterDeckId", "opponentId"]);
    const story =
      gameplay.story === null
        ? null
        : (() => {
            const binding = record(gameplay.story, ["contentId", "document"]);
            const document = fileRef(binding.document);
            assertReachableRef(document, owner);
            return {
              contentId: literal(binding.contentId, "prototype-prologue-v1"),
              document,
            };
          })();
    if (cards.length === 0 || sets.length === 0 || decks.length === 0)
      invalid();
    sorted(cards, (left, right) => left.code - right.code);
    unique(sets, (set) => set.id);
    unique(sets, (set) => set.name);
    unique(decks, (deck) => deck.id);
    unique(opponents, (opponent) => opponent.id);
    sorted(decks, (left, right) => compare(left.id, right.id));
    sorted(opponents, (left, right) => compare(left.id, right.id));
    const starterDeckId = text(defaults.starterDeckId);
    const opponentId = text(defaults.opponentId);
    if (
      !decks.some(({ id }) => id === starterDeckId) ||
      !opponents.some(({ id }) => id === opponentId) ||
      opponents.some(({ deckId }) => !decks.some(({ id }) => id === deckId))
    )
      invalid();
    return {
      schemaVersion: literal(gameplay.schemaVersion, 1),
      chapterId: owner,
      cards,
      sets,
      decks,
      opponents,
      defaults: { starterDeckId, opponentId },
      story,
    };
  });
}
