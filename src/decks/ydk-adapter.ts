import type { DeckCardLists } from "./deck-contracts.ts";
import { cloneCardLists } from "./deck-contracts.ts";
import { parseYdk } from "../duel/presets/deck-parser.ts";

export const MAXIMUM_YDK_SOURCE_LENGTH = 1_000_000;
export const MAXIMUM_YDK_CARDS = 1_000;

export type YdkImportResult =
  | Readonly<{ type: "ready"; cards: DeckCardLists }>
  | Readonly<{
      type: "invalid";
      message: string;
      line: number | null;
    }>;

export function importYdk(source: string): YdkImportResult {
  try {
    if (source.length > MAXIMUM_YDK_SOURCE_LENGTH)
      throw new Error(
        `YDK source exceeds ${MAXIMUM_YDK_SOURCE_LENGTH.toLocaleString()} characters`,
      );
    const cards = cloneCardLists(parseYdk(source));
    if (
      cards.main.length + cards.extra.length + cards.side.length >
      MAXIMUM_YDK_CARDS
    )
      throw new Error(`YDK source exceeds ${MAXIMUM_YDK_CARDS} cards`);
    return Object.freeze({
      type: "ready",
      cards,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "YDK import failed";
    const match = /line (\d+)/i.exec(message);
    return Object.freeze({
      type: "invalid",
      message,
      line: match === null ? null : Number(match[1]),
    });
  }
}

export function exportYdk(deck: DeckCardLists): string {
  return [
    "#created by YGO Story Duel Simulator",
    "#main",
    ...deck.main.map(String),
    "#extra",
    ...deck.extra.map(String),
    "!side",
    ...deck.side.map(String),
    "",
  ].join("\n");
}

export function ydkFilename(name: string): string {
  const normalized = name
    .normalize("NFKD")
    .replaceAll(/[^a-zA-Z0-9_-]+/g, "-")
    .replaceAll(/^-+|-+$/g, "")
    .slice(0, 80);
  return `${normalized.length === 0 ? "deck" : normalized}.ydk`;
}
