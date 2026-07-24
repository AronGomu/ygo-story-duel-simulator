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

// Exact reviewed card pool for the bundled preset-only MVP. Changing this
// list requires intentional deck/transcript/compatibility review.
export const MVP_SUPPORTED_CARD_CODES: ReadonlySet<number> = new Set([
  4031928, 4206964, 5053103, 5758500, 12580477, 13039848, 15025844, 17814387,
  30113682, 32274490, 32452818, 40640057, 41762634, 44095762, 70781052,
  75356564, 76103675, 83764718, 84257639, 89631139, 91152256, 97590747,
]);

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
    if (!Number.isSafeInteger(numeric) || numeric <= 0)
      throw new Error(`Invalid card code at deck line ${index + 1}: ${line}`);
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
  cardData?: ReadonlyMap<number, { readonly type: number }>,
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

  if (cardData !== undefined) {
    const unsupported = [...new Set([...deck.main, ...deck.extra])].filter(
      (code) =>
        cardData.get(code) === undefined || !MVP_SUPPORTED_CARD_CODES.has(code),
    );
    if (unsupported.length > 0) {
      throw new Error(
        `Deck uses card(s) outside the reviewed MVP pool: ${unsupported.join(", ")}`,
      );
    }
  }
}

export function uniqueDeckCodes(
  ...decks: readonly ParsedDeck[]
): ReadonlySet<CardCode> {
  return new Set(decks.flatMap((deck) => [...deck.main, ...deck.extra]));
}
