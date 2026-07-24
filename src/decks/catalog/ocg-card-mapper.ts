import type {
  OcgCardData,
  OcgScope,
} from "../../../vendor/ocgcore-wasm/0.1.2/dist/index.js";
import { OCG_ATTRIBUTE, OCG_RACE, OCG_TYPE, hasOcgType } from "./ocg-mask.ts";

export interface DeckCatalogText {
  readonly code: number;
  readonly name: string;
  readonly description: string;
  readonly strings: readonly string[];
}

export interface DeckCatalogRecord {
  readonly card: Readonly<OcgCardData>;
  readonly text: DeckCatalogText;
  readonly scope: OcgScope | (number & {});
  readonly imageUrl: string | null;
}

export interface AssetDeckCardRecord {
  readonly code: number;
  readonly alias: number;
  readonly setcodes: number[];
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
}

export interface DeckBuilderCardView {
  readonly code: number;
  readonly name: string;
  readonly description: string;
  readonly family: "monster" | "spell" | "trap";
  readonly subtypes: readonly string[];
  readonly attribute: string | null;
  readonly race: string | null;
  readonly levelRankLink: number | null;
  readonly ratingLabel: "Level" | "Rank" | "Link" | null;
  readonly attack: number | null;
  readonly defense: number | null;
  readonly pendulumScales: readonly [number, number] | null;
  readonly linkMarkers: readonly string[];
  readonly canonicalZone: "main" | "extra";
  readonly imageUrl: string | null;
  readonly scope: number;
  readonly rawType: number;
}

const TYPE_LABELS: readonly [number, string][] = [
  [OCG_TYPE.NORMAL, "Normal"],
  [OCG_TYPE.EFFECT, "Effect"],
  [OCG_TYPE.FUSION, "Fusion"],
  [OCG_TYPE.RITUAL, "Ritual"],
  [OCG_TYPE.SYNCHRO, "Synchro"],
  [OCG_TYPE.XYZ, "Xyz"],
  [OCG_TYPE.PENDULUM, "Pendulum"],
  [OCG_TYPE.LINK, "Link"],
  [OCG_TYPE.TUNER, "Tuner"],
  [OCG_TYPE.QUICKPLAY, "Quick-Play"],
  [OCG_TYPE.CONTINUOUS, "Continuous"],
  [OCG_TYPE.EQUIP, "Equip"],
  [OCG_TYPE.FIELD, "Field"],
  [OCG_TYPE.COUNTER, "Counter"],
  [OCG_TYPE.FLIP, "Flip"],
  [OCG_TYPE.SPIRIT, "Spirit"],
  [OCG_TYPE.UNION, "Union"],
  [OCG_TYPE.GEMINI, "Gemini"],
  [OCG_TYPE.TOON, "Toon"],
];

const ATTRIBUTE_LABELS = new Map<number, string>([
  [OCG_ATTRIBUTE.EARTH, "EARTH"],
  [OCG_ATTRIBUTE.WATER, "WATER"],
  [OCG_ATTRIBUTE.FIRE, "FIRE"],
  [OCG_ATTRIBUTE.WIND, "WIND"],
  [OCG_ATTRIBUTE.LIGHT, "LIGHT"],
  [OCG_ATTRIBUTE.DARK, "DARK"],
  [OCG_ATTRIBUTE.DIVINE, "DIVINE"],
]);

const RACE_LABELS = new Map<bigint, string>(
  Object.entries(OCG_RACE).map(([key, value]) => [
    value,
    key
      .toLowerCase()
      .split("_")
      .map((part) => part[0]?.toUpperCase() + part.slice(1))
      .join(" "),
  ]),
);

export function adaptAssetDeckCard(
  card: AssetDeckCardRecord,
  text: DeckCatalogText,
  imageUrl: string | null = null,
): DeckCatalogRecord {
  assertMatchingCodes(card.code, text.code);
  return Object.freeze({
    card: Object.freeze({
      code: card.code,
      alias: card.alias,
      setcodes: [...card.setcodes],
      type: card.type,
      level: card.level,
      attribute: card.attribute,
      race: BigInt(card.race),
      attack: card.attack,
      defense: card.defense,
      lscale: card.lscale,
      rscale: card.rscale,
      link_marker: card.linkMarker,
    }),
    text: Object.freeze({ ...text, strings: Object.freeze([...text.strings]) }),
    scope: card.ot,
    imageUrl,
  });
}

export function mapDeckBuilderCard(
  record: DeckCatalogRecord,
): DeckBuilderCardView {
  const { card, text } = record;
  assertMatchingCodes(card.code, text.code);
  const family = cardFamily(card.type);
  const isLink = hasOcgType(card.type, OCG_TYPE.LINK);
  const isXyz = hasOcgType(card.type, OCG_TYPE.XYZ);
  const isPendulum = hasOcgType(card.type, OCG_TYPE.PENDULUM);
  return Object.freeze({
    code: card.code,
    name: text.name,
    description: text.description,
    family,
    subtypes: Object.freeze(
      TYPE_LABELS.filter(([mask]) => hasOcgType(card.type, mask)).map(
        ([, label]) => label,
      ),
    ),
    attribute:
      family === "monster"
        ? (ATTRIBUTE_LABELS.get(card.attribute) ??
          `Attribute ${card.attribute}`)
        : null,
    race:
      family === "monster"
        ? (RACE_LABELS.get(card.race) ?? `Race ${card.race}`)
        : null,
    levelRankLink: family === "monster" ? card.level : null,
    ratingLabel:
      family !== "monster" ? null : isLink ? "Link" : isXyz ? "Rank" : "Level",
    attack: family === "monster" ? card.attack : null,
    defense: family === "monster" && !isLink ? card.defense : null,
    pendulumScales: isPendulum
      ? Object.freeze([card.lscale, card.rscale] as const)
      : null,
    linkMarkers: Object.freeze(linkMarkerLabels(card.link_marker)),
    canonicalZone: isExtraDeckType(card.type) ? "extra" : "main",
    imageUrl: record.imageUrl,
    scope: Number(record.scope),
    rawType: card.type,
  });
}

function assertMatchingCodes(cardCode: number, textCode: number): void {
  if (cardCode !== textCode)
    throw new Error(
      `Card/text code mismatch: card ${cardCode}, text ${textCode}`,
    );
}

export function cardFamily(type: number): "monster" | "spell" | "trap" {
  if (hasOcgType(type, OCG_TYPE.MONSTER)) return "monster";
  if (hasOcgType(type, OCG_TYPE.SPELL)) return "spell";
  return "trap";
}

export function isExtraDeckType(type: number): boolean {
  return [OCG_TYPE.FUSION, OCG_TYPE.SYNCHRO, OCG_TYPE.XYZ, OCG_TYPE.LINK].some(
    (mask) => hasOcgType(type, mask),
  );
}

function linkMarkerLabels(marker: number): string[] {
  const values: readonly [number, string][] = [
    [1, "Bottom-left"],
    [2, "Bottom"],
    [4, "Bottom-right"],
    [8, "Left"],
    [32, "Right"],
    [64, "Top-left"],
    [128, "Top"],
    [256, "Top-right"],
  ];
  return values
    .filter(([mask]) => (marker & mask) !== 0)
    .map(([, label]) => label);
}
