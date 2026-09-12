import { compareCodePoints } from "./asset-delivery/canonical-json.ts";

export interface ChapterSourceCorrections {
  readonly schemaVersion: 1;
  readonly aliases: readonly {
    readonly sourceCode: number;
    readonly runtimeCode: number;
  }[];
  readonly excludedCardCodes: readonly number[];
  readonly excludedSetNames: readonly string[];
}
export interface SourcePrinting {
  readonly code: string;
  readonly rarity: string;
  readonly rarityCode: string;
}
export interface ChapterSourceSet {
  readonly name: string;
  readonly code: string;
  readonly tcgReleaseDate: string;
  readonly cards: readonly {
    readonly id: number;
    readonly name: string;
    readonly printings: readonly SourcePrinting[];
  }[];
}
export interface NormalizedChapterSource {
  readonly sets: readonly ChapterSourceSet[];
  readonly cardCodes: readonly number[];
}

const APPROVED_ALIAS = { sourceCode: 81480461, runtimeCode: 81480460 };
const APPROVED_EXCLUDED_CARD_CODES = [501000000, 501000001] as const;
const APPROVED_EXCLUDED_SET_NAME =
  "Yu-Gi-Oh! Power of Chaos: Yugi the Destiny Limited Collector's Edition";
const MAX_SETS = 2048;
const MAX_MEMBERSHIPS = 100_000;

function invalid(): never {
  throw new Error("CONTENT_SOURCE_POLICY_INVALID");
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function exact(value: Record<string, unknown>, keys: readonly string[]) {
  return (
    Object.keys(value).length === keys.length &&
    keys.every((key) => Object.hasOwn(value, key))
  );
}

function text(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= 512 &&
    ![...value].some((character) => character.charCodeAt(0) < 32)
  );
}

function cardCode(value: unknown): value is number {
  return (
    Number.isSafeInteger(value) &&
    Number(value) > 0 &&
    Number(value) <= 0xffffffff
  );
}

function date(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    !Number.isNaN(Date.parse(value)) &&
    new Date(value).toISOString().slice(0, 10) === value
  );
}

export function parseChapterSourceCorrections(
  value: unknown,
): ChapterSourceCorrections {
  if (
    !record(value) ||
    !exact(value, [
      "schemaVersion",
      "aliases",
      "excludedCardCodes",
      "excludedSetNames",
    ]) ||
    value.schemaVersion !== 1 ||
    !Array.isArray(value.aliases) ||
    value.aliases.length !== 1 ||
    !Array.isArray(value.excludedCardCodes) ||
    value.excludedCardCodes.length !== 2 ||
    !Array.isArray(value.excludedSetNames) ||
    value.excludedSetNames.length !== 1
  )
    invalid();
  const alias = value.aliases[0];
  if (
    !record(alias) ||
    !exact(alias, ["sourceCode", "runtimeCode"]) ||
    !cardCode(alias.sourceCode) ||
    !cardCode(alias.runtimeCode) ||
    alias.sourceCode !== APPROVED_ALIAS.sourceCode ||
    alias.runtimeCode !== APPROVED_ALIAS.runtimeCode ||
    value.excludedCardCodes[0] !== APPROVED_EXCLUDED_CARD_CODES[0] ||
    value.excludedCardCodes[1] !== APPROVED_EXCLUDED_CARD_CODES[1] ||
    value.excludedSetNames[0] !== APPROVED_EXCLUDED_SET_NAME
  )
    invalid();
  return {
    schemaVersion: 1,
    aliases: [
      {
        sourceCode: alias.sourceCode,
        runtimeCode: alias.runtimeCode,
      },
    ],
    excludedCardCodes: [...APPROVED_EXCLUDED_CARD_CODES],
    excludedSetNames: [APPROVED_EXCLUDED_SET_NAME],
  };
}

function validatePrinting(value: unknown): asserts value is SourcePrinting {
  if (
    !record(value) ||
    !exact(value, ["code", "rarity", "rarityCode"]) ||
    !text(value.code) ||
    !text(value.rarity) ||
    !text(value.rarityCode)
  )
    invalid();
}

function validateSet(value: unknown): asserts value is ChapterSourceSet {
  if (
    !record(value) ||
    !text(value.name) ||
    !text(value.code) ||
    !date(value.tcgReleaseDate) ||
    !Array.isArray(value.cards)
  )
    invalid();
  const sourceIds = new Set<number>();
  for (const card of value.cards) {
    if (
      !record(card) ||
      !cardCode(card.id) ||
      sourceIds.has(card.id) ||
      !text(card.name) ||
      !Array.isArray(card.printings) ||
      card.printings.length === 0
    )
      invalid();
    sourceIds.add(card.id);
    for (const printing of card.printings) validatePrinting(printing);
  }
}

const printingKey = (printing: SourcePrinting) =>
  `${printing.code}\u0000${printing.rarity}\u0000${printing.rarityCode}`;

const comparePrintings = (left: SourcePrinting, right: SourcePrinting) =>
  compareCodePoints(left.code, right.code) ||
  compareCodePoints(left.rarity, right.rarity) ||
  compareCodePoints(left.rarityCode, right.rarityCode);

export function normalizeChapterSource(
  selectedSets: readonly ChapterSourceSet[],
  corrections: ChapterSourceCorrections,
): NormalizedChapterSource {
  const approved = parseChapterSourceCorrections(corrections);
  if (!Array.isArray(selectedSets) || selectedSets.length > MAX_SETS) invalid();
  const setNames = new Set<string>();
  let memberships = 0;
  for (const set of selectedSets) {
    validateSet(set);
    if (setNames.has(set.name)) invalid();
    setNames.add(set.name);
    memberships += set.cards.length;
    if (memberships > MAX_MEMBERSHIPS) invalid();
  }

  const excludedSets = new Set(approved.excludedSetNames);
  const excludedCards = new Set(approved.excludedCardCodes);
  const aliases = new Map(
    approved.aliases.map(({ sourceCode, runtimeCode }) => [
      sourceCode,
      runtimeCode,
    ]),
  );
  const cardCodes = new Set<number>();
  const sets = selectedSets
    .filter(({ name }) => !excludedSets.has(name))
    .map((set) => {
      const cards = new Map<
        number,
        { id: number; name: string; printings: Map<string, SourcePrinting> }
      >();
      for (const sourceCard of set.cards) {
        if (excludedCards.has(sourceCard.id)) continue;
        const id = aliases.get(sourceCard.id) ?? sourceCard.id;
        const existing = cards.get(id);
        if (existing && existing.name !== sourceCard.name) invalid();
        const card =
          existing ??
          ({
            id,
            name: sourceCard.name,
            printings: new Map<string, SourcePrinting>(),
          } as const);
        for (const printing of sourceCard.printings)
          card.printings.set(printingKey(printing), { ...printing });
        cards.set(id, card);
        cardCodes.add(id);
      }
      return {
        name: set.name,
        code: set.code,
        tcgReleaseDate: set.tcgReleaseDate,
        cards: [...cards.values()]
          .sort((left, right) => left.id - right.id)
          .map(({ id, name, printings }) => ({
            id,
            name,
            printings: [...printings.values()].sort(comparePrintings),
          })),
      };
    })
    .sort((left, right) => compareCodePoints(left.name, right.name));
  return {
    sets,
    cardCodes: [...cardCodes].sort((left, right) => left - right),
  };
}
