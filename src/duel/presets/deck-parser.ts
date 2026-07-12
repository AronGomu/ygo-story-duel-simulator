import { cardCode, type CardCode } from "../contracts/ids.ts";

export interface ParsedDeck {
  readonly main: readonly CardCode[];
  readonly extra: readonly CardCode[];
  readonly side: readonly CardCode[];
}

export interface DeckConstraints {
  readonly minimumMain: number;
  readonly maximumMain: number;
  readonly maximumExtra: number;
  readonly allowSide: boolean;
}

export const MVP_DECK_CONSTRAINTS: DeckConstraints = {
  minimumMain: 40,
  maximumMain: 60,
  maximumExtra: 15,
  allowSide: false,
};

export function parseYdk(source: string): ParsedDeck {
  const sections: Record<"main" | "extra" | "side", CardCode[]> = {
    main: [],
    extra: [],
    side: [],
  };
  let section: keyof typeof sections | null = null;

  for (const [index, untrimmed] of source
    .replaceAll("\r\n", "\n")
    .split("\n")
    .entries()) {
    const line = untrimmed.trim();
    if (
      line.length === 0 ||
      (line.startsWith("#") && line !== "#main" && line !== "#extra")
    ) {
      continue;
    }
    if (line === "#main") {
      section = "main";
      continue;
    }
    if (line === "#extra") {
      section = "extra";
      continue;
    }
    if (line === "!side") {
      section = "side";
      continue;
    }
    if (section === null)
      throw new Error(`Deck line ${index + 1} appears before #main`);
    if (!/^\d+$/.test(line))
      throw new Error(`Invalid card code at deck line ${index + 1}: ${line}`);
    const numeric = Number(line);
    sections[section].push(cardCode(numeric));
  }

  return Object.freeze({
    main: Object.freeze(sections.main),
    extra: Object.freeze(sections.extra),
    side: Object.freeze(sections.side),
  });
}

export function validateDeck(
  deck: ParsedDeck,
  catalogCodes: ReadonlySet<number>,
  constraints: DeckConstraints = MVP_DECK_CONSTRAINTS,
): void {
  if (
    deck.main.length < constraints.minimumMain ||
    deck.main.length > constraints.maximumMain
  ) {
    throw new Error(
      `Main Deck must contain ${constraints.minimumMain}-${constraints.maximumMain} cards; found ${deck.main.length}`,
    );
  }
  if (deck.extra.length > constraints.maximumExtra) {
    throw new Error(`Extra Deck exceeds ${constraints.maximumExtra} cards`);
  }
  if (!constraints.allowSide && deck.side.length > 0)
    throw new Error("Side Deck is not supported");

  const missing = [...deck.main, ...deck.extra, ...deck.side].filter(
    (code) => !catalogCodes.has(code),
  );
  if (missing.length > 0) {
    throw new Error(
      `Deck references missing card code(s): ${[...new Set(missing)].join(", ")}`,
    );
  }
}

export function uniqueDeckCodes(
  ...decks: readonly ParsedDeck[]
): ReadonlySet<CardCode> {
  return new Set(decks.flatMap((deck) => [...deck.main, ...deck.extra]));
}
