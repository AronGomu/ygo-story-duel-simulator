import type { DeckBuilderCardView } from "./ocg-card-mapper.ts";

export type NameMatch = "contains" | "exact" | "starts-with" | "exclude";
export type NumericOperator = "range" | "eq" | "lt" | "lte" | "gt" | "gte";
export type NumericCriterion =
  | Readonly<{ op: "range"; min: number | null; max: number | null }>
  | Readonly<{ op: Exclude<NumericOperator, "range">; value: number }>;
export type LinkMarkerRule = "any" | "all" | "exact";
export type SummonFrame =
  | "Normal"
  | "Effect"
  | "Ritual"
  | "Fusion"
  | "Synchro"
  | "Xyz"
  | "Pendulum"
  | "Link";
export type CardTrait =
  "Tuner" | "Flip" | "Gemini" | "Spirit" | "Toon" | "Union";
export type SpellProperty =
  "Normal" | "Continuous" | "Equip" | "Field" | "Quick-Play" | "Ritual";
export type TrapProperty = "Normal" | "Continuous" | "Counter";

export interface AdvancedDeckCatalogFilters {
  readonly nameMatch: NameMatch;
  readonly text: string;
  readonly code: string;
  readonly family: "monster" | "spell" | "trap" | null;
  readonly attribute: string | null;
  readonly race: string | null;
  readonly summonFrame: SummonFrame | null;
  readonly traits: readonly CardTrait[];
  readonly attack: NumericCriterion | null;
  readonly defense: NumericCriterion | null;
  readonly levelRank: NumericCriterion | null;
  readonly linkRating: NumericCriterion | null;
  readonly pendulumScale: NumericCriterion | null;
  readonly includeUnknownAttackDefense: boolean;
  readonly spellProperty: SpellProperty | null;
  readonly trapProperty: TrapProperty | null;
  readonly linkMarkerRule: LinkMarkerRule;
  readonly linkMarkers: readonly string[];
  readonly restriction: 0 | 1 | 2 | 3 | null;
}

export interface AdvancedDeckCatalogOptions {
  readonly families: readonly ("monster" | "spell" | "trap")[];
  readonly attributes: readonly string[];
  readonly races: readonly string[];
  readonly summonFrames: readonly SummonFrame[];
  readonly traits: readonly CardTrait[];
  readonly spellProperties: readonly SpellProperty[];
  readonly trapProperties: readonly TrapProperty[];
  readonly linkMarkers: readonly string[];
}

const EMPTY_STRINGS: readonly string[] = Object.freeze([]);
const EMPTY_TRAITS: readonly CardTrait[] = Object.freeze([]);

export const EMPTY_ADVANCED_DECK_CATALOG_FILTERS: AdvancedDeckCatalogFilters =
  Object.freeze({
    nameMatch: "contains",
    text: "",
    code: "",
    family: null,
    attribute: null,
    race: null,
    summonFrame: null,
    traits: EMPTY_TRAITS,
    attack: null,
    defense: null,
    levelRank: null,
    linkRating: null,
    pendulumScale: null,
    includeUnknownAttackDefense: false,
    spellProperty: null,
    trapProperty: null,
    linkMarkerRule: "any",
    linkMarkers: EMPTY_STRINGS,
    restriction: null,
  });

const SUMMON_FRAMES: readonly SummonFrame[] = [
  "Normal",
  "Effect",
  "Ritual",
  "Fusion",
  "Synchro",
  "Xyz",
  "Pendulum",
  "Link",
];
const TRAITS: readonly CardTrait[] = [
  "Tuner",
  "Flip",
  "Gemini",
  "Spirit",
  "Toon",
  "Union",
];
const SPELL_PROPERTIES: readonly SpellProperty[] = [
  "Normal",
  "Continuous",
  "Equip",
  "Field",
  "Quick-Play",
  "Ritual",
];
const TRAP_PROPERTIES: readonly TrapProperty[] = [
  "Normal",
  "Continuous",
  "Counter",
];
const SPECIAL_SPELL_PROPERTIES = SPELL_PROPERTIES.filter(
  (value) => value !== "Normal",
);
const SPECIAL_TRAP_PROPERTIES = TRAP_PROPERTIES.filter(
  (value) => value !== "Normal",
);

function sortedValues<T extends string>(values: Iterable<T>): readonly T[] {
  return Object.freeze(
    [...new Set(values)].sort((a, b) => a.localeCompare(b, "en")),
  );
}

export function advancedDeckCatalogOptions(
  cards: readonly DeckBuilderCardView[],
): AdvancedDeckCatalogOptions {
  const families = new Set<DeckBuilderCardView["family"]>();
  const attributes = new Set<string>();
  const races = new Set<string>();
  const frames = new Set<SummonFrame>();
  const traits = new Set<CardTrait>();
  const spellProperties = new Set<SpellProperty>();
  const trapProperties = new Set<TrapProperty>();
  const linkMarkers = new Set<string>();

  for (const card of cards) {
    families.add(card.family);
    if (card.attribute !== null) attributes.add(card.attribute);
    if (card.race !== null) races.add(card.race);
    for (const frame of SUMMON_FRAMES)
      if (card.subtypes.includes(frame)) frames.add(frame);
    for (const trait of TRAITS)
      if (card.subtypes.includes(trait)) traits.add(trait);
    if (card.family === "spell") spellProperties.add(spellProperty(card));
    if (card.family === "trap") trapProperties.add(trapProperty(card));
    for (const marker of card.linkMarkers) linkMarkers.add(marker);
  }

  return Object.freeze({
    families: Object.freeze(
      (["monster", "spell", "trap"] as const).filter((value) =>
        families.has(value),
      ),
    ),
    attributes: sortedValues(attributes),
    races: sortedValues(races),
    summonFrames: Object.freeze(
      SUMMON_FRAMES.filter((value) => frames.has(value)),
    ),
    traits: Object.freeze(TRAITS.filter((value) => traits.has(value))),
    spellProperties: Object.freeze(
      SPELL_PROPERTIES.filter((value) => spellProperties.has(value)),
    ),
    trapProperties: Object.freeze(
      TRAP_PROPERTIES.filter((value) => trapProperties.has(value)),
    ),
    linkMarkers: sortedValues(linkMarkers),
  });
}

export function cardNameMatches(
  name: string,
  query: string,
  mode: NameMatch,
): boolean {
  const needle = query.trim().toLocaleLowerCase();
  if (needle.length === 0) return true;
  const value = name.toLocaleLowerCase();
  switch (mode) {
    case "contains":
      return value.includes(needle);
    case "exact":
      return value === needle;
    case "starts-with":
      return value.startsWith(needle);
    case "exclude":
      return !value.includes(needle);
  }
}

interface TextTerm {
  readonly exclude: boolean;
  readonly value: string;
}

function textTerms(query: string): readonly TextTerm[] {
  const terms: TextTerm[] = [];
  let cursor = 0;
  while (cursor < query.length) {
    while (/\s/u.test(query[cursor] ?? "")) cursor++;
    if (cursor >= query.length) break;
    const exclude = query[cursor] === "-";
    if (exclude) cursor++;
    if (query[cursor] === '"') {
      cursor++;
      const closing = query.indexOf('"', cursor);
      const end = closing === -1 ? query.length : closing;
      const value = query.slice(cursor, end).trim().toLocaleLowerCase();
      if (value.length > 0) terms.push({ exclude, value });
      cursor = closing === -1 ? query.length : closing + 1;
      continue;
    }
    const start = cursor;
    while (cursor < query.length && !/\s/u.test(query[cursor] ?? "")) cursor++;
    const value = query.slice(start, cursor).trim().toLocaleLowerCase();
    if (value.length > 0) terms.push({ exclude, value });
  }
  return terms;
}

export function cardTextMatches(description: string, query: string): boolean {
  const haystack = description.toLocaleLowerCase();
  return textTerms(query).every(({ exclude, value }) =>
    exclude ? !haystack.includes(value) : haystack.includes(value),
  );
}

export function numericCriterionError(
  criterion: NumericCriterion | null,
): "Enter a valid value." | "Minimum must not exceed maximum." | null {
  if (criterion === null) return null;
  if (criterion.op === "range") {
    if (
      (criterion.min !== null && !Number.isFinite(criterion.min)) ||
      (criterion.max !== null && !Number.isFinite(criterion.max)) ||
      (criterion.min === null && criterion.max === null)
    )
      return "Enter a valid value.";
    if (
      criterion.min !== null &&
      criterion.max !== null &&
      criterion.min > criterion.max
    )
      return "Minimum must not exceed maximum.";
    return null;
  }
  return Number.isFinite(criterion.value) ? null : "Enter a valid value.";
}

export function matchesNumericCriterion(
  value: number,
  criterion: NumericCriterion | null,
): boolean {
  if (criterion === null) return true;
  if (numericCriterionError(criterion) !== null) return false;
  switch (criterion.op) {
    case "range":
      return (
        (criterion.min === null || value >= criterion.min) &&
        (criterion.max === null || value <= criterion.max)
      );
    case "eq":
      return value === criterion.value;
    case "lt":
      return value < criterion.value;
    case "lte":
      return value <= criterion.value;
    case "gt":
      return value > criterion.value;
    case "gte":
      return value >= criterion.value;
  }
}

function spellProperty(card: DeckBuilderCardView): SpellProperty {
  return (
    SPECIAL_SPELL_PROPERTIES.find((value) => card.subtypes.includes(value)) ??
    "Normal"
  );
}

function trapProperty(card: DeckBuilderCardView): TrapProperty {
  return (
    SPECIAL_TRAP_PROPERTIES.find((value) => card.subtypes.includes(value)) ??
    "Normal"
  );
}

function markerRuleMatches(
  cardMarkers: readonly string[],
  selected: readonly string[],
  rule: LinkMarkerRule,
): boolean {
  if (selected.length === 0) return true;
  const actual = new Set(cardMarkers);
  switch (rule) {
    case "any":
      return selected.some((marker) => actual.has(marker));
    case "all":
      return selected.every((marker) => actual.has(marker));
    case "exact":
      return (
        actual.size === selected.length &&
        selected.every((marker) => actual.has(marker))
      );
  }
}

export function cardMatchesAdvancedFilters(
  card: DeckBuilderCardView,
  filters: AdvancedDeckCatalogFilters,
): boolean {
  const code = filters.code.trim();
  if (/^\d{8}$/u.test(code) && card.code !== Number(code)) return false;
  if (!cardTextMatches(card.description, filters.text)) return false;
  if (filters.family !== null && card.family !== filters.family) return false;
  if (filters.attribute !== null && card.attribute !== filters.attribute)
    return false;
  if (filters.race !== null && card.race !== filters.race) return false;
  if (
    filters.summonFrame !== null &&
    !card.subtypes.includes(filters.summonFrame)
  )
    return false;
  if (!filters.traits.every((trait) => card.subtypes.includes(trait)))
    return false;
  if (
    filters.attack !== null &&
    (card.attack === null ||
      (card.attack < 0 && !filters.includeUnknownAttackDefense) ||
      !matchesNumericCriterion(card.attack, filters.attack))
  )
    return false;
  if (
    filters.defense !== null &&
    (card.defense === null ||
      (card.defense < 0 && !filters.includeUnknownAttackDefense) ||
      !matchesNumericCriterion(card.defense, filters.defense))
  )
    return false;
  if (
    filters.levelRank !== null &&
    (card.levelRankLink === null ||
      (card.ratingLabel !== "Level" && card.ratingLabel !== "Rank") ||
      !matchesNumericCriterion(card.levelRankLink, filters.levelRank))
  )
    return false;
  if (
    filters.linkRating !== null &&
    (card.ratingLabel !== "Link" ||
      card.levelRankLink === null ||
      !matchesNumericCriterion(card.levelRankLink, filters.linkRating))
  )
    return false;
  if (
    filters.pendulumScale !== null &&
    (card.pendulumScales === null ||
      !card.pendulumScales.some((value) =>
        matchesNumericCriterion(value, filters.pendulumScale),
      ))
  )
    return false;
  if (
    filters.spellProperty !== null &&
    (card.family !== "spell" || spellProperty(card) !== filters.spellProperty)
  )
    return false;
  if (
    filters.trapProperty !== null &&
    (card.family !== "trap" || trapProperty(card) !== filters.trapProperty)
  )
    return false;
  if (
    filters.linkMarkers.length > 0 &&
    (card.ratingLabel !== "Link" ||
      !markerRuleMatches(
        card.linkMarkers,
        filters.linkMarkers,
        filters.linkMarkerRule,
      ))
  )
    return false;
  return true;
}

const ENGLISH_NAME_COLLATOR = new Intl.Collator("en", { sensitivity: "base" });

export function compareDeckCatalogCards(
  left: DeckBuilderCardView,
  right: DeckBuilderCardView,
): number {
  return (
    ENGLISH_NAME_COLLATOR.compare(left.name, right.name) ||
    left.code - right.code
  );
}
