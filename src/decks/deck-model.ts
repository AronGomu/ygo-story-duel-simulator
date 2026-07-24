import type { DeckCardLists, DeckRecord, DeckZone } from "./deck-contracts.ts";
import { cloneCardLists, deckId } from "./deck-contracts.ts";
import type { DeckBuilderCardView } from "./catalog/ocg-card-mapper.ts";
import {
  quantityLimit,
  type PinnedDeckRuleset,
} from "./catalog/pinned-ruleset.ts";
import { validateDeckDraft } from "./deck-validation.ts";

export type DeckCommand =
  | Readonly<{ type: "add"; cardCode: number }>
  | Readonly<{ type: "remove"; cardCode: number; zone: DeckZone }>
  | Readonly<{
      type: "move";
      cardCode: number;
      from: DeckZone;
      to: DeckZone;
    }>
  | Readonly<{ type: "import"; cards: DeckCardLists }>;

export type DeckMutationResult =
  | Readonly<{
      type: "accepted";
      cards: DeckCardLists;
      reason: DeckCommand["type"];
    }>
  | Readonly<{ type: "rejected"; reason: string }>;

export const MAXIMUM_DECK_NAME_LENGTH = 120;

export function normalizeDeckName(name: string): string {
  const trimmed = name.trim();
  if (trimmed.length === 0) throw new Error("Deck name is required");
  if (trimmed.length > MAXIMUM_DECK_NAME_LENGTH)
    throw new Error(
      `Deck name must be ${MAXIMUM_DECK_NAME_LENGTH} characters or fewer`,
    );
  return trimmed;
}

export function derivedDeckName(name: string, suffix: string): string {
  const room = MAXIMUM_DECK_NAME_LENGTH - suffix.length;
  return `${name.trim().slice(0, Math.max(0, room)).trimEnd()}${suffix}`;
}

export interface DeckGridPlan {
  readonly columns: number;
  readonly rows: number;
  readonly slots: number;
  readonly compact: boolean;
}

export function createBlankDeck(
  name: string,
  catalog: ReadonlyMap<number, DeckBuilderCardView>,
  ruleset: PinnedDeckRuleset,
  options: {
    readonly id?: string;
    readonly now?: Date;
  } = {},
): DeckRecord {
  const trimmed = normalizeDeckName(name);
  const now = (options.now ?? new Date()).toISOString();
  const cards = cloneCardLists({ main: [], extra: [], side: [] });
  return Object.freeze({
    schemaVersion: 1,
    id: deckId(options.id ?? crypto.randomUUID()),
    revision: 0,
    name: trimmed,
    ...cards,
    createdAt: now,
    updatedAt: now,
    validation: validateDeckDraft(cards, catalog, ruleset),
    importedNeedsReview: false,
  });
}

export function applyDeckCommand(
  deck: DeckCardLists,
  command: DeckCommand,
  catalog: ReadonlyMap<number, DeckBuilderCardView>,
  ruleset: PinnedDeckRuleset,
): DeckMutationResult {
  if (command.type === "import")
    return Object.freeze({
      type: "accepted",
      cards: sortDeckCards(cloneCardLists(command.cards), catalog),
      reason: "import",
    });

  const next = {
    main: [...deck.main],
    extra: [...deck.extra],
    side: [...deck.side],
  } satisfies Record<DeckZone, number[]>;

  if (command.type === "remove") {
    if (!removeFirst(next[command.zone], command.cardCode))
      return Object.freeze({
        type: "rejected",
        reason: "Card is not in that zone.",
      });
    return Object.freeze({
      type: "accepted",
      cards: sortDeckCards(next, catalog),
      reason: "remove",
    });
  }

  const card = catalog.get(command.cardCode);
  if (card === undefined)
    return Object.freeze({
      type: "rejected",
      reason: "Card is missing from catalog.",
    });

  if (command.type === "add") {
    const count = [...next.main, ...next.extra, ...next.side].filter(
      (code) => code === command.cardCode,
    ).length;
    const limit = quantityLimit(ruleset, command.cardCode);
    if (limit === 0)
      return Object.freeze({ type: "rejected", reason: "Card is forbidden." });
    if (count >= limit)
      return Object.freeze({
        type: "rejected",
        reason: `Copy limit ${limit} reached.`,
      });
    next[card.canonicalZone].push(command.cardCode);
  } else {
    if (command.from === command.to)
      return Object.freeze({
        type: "rejected",
        reason: "Card is already in that zone.",
      });
    const legalTarget =
      command.to === "side" ||
      (command.from === "side" && command.to === card.canonicalZone);
    if (!legalTarget)
      return Object.freeze({
        type: "rejected",
        reason: "Card cannot move to that zone.",
      });
    if (!removeFirst(next[command.from], command.cardCode))
      return Object.freeze({
        type: "rejected",
        reason: "Card is not in that zone.",
      });
    next[command.to].push(command.cardCode);
  }

  return Object.freeze({
    type: "accepted",
    cards: sortDeckCards(next, catalog),
    reason: command.type,
  });
}

export function sortDeckCards(
  cards: DeckCardLists,
  catalog: ReadonlyMap<number, DeckBuilderCardView>,
): DeckCardLists {
  const compare =
    (zone: DeckZone) =>
    (left: number, right: number): number => {
      const a = catalog.get(left);
      const b = catalog.get(right);
      if (a === undefined || b === undefined) return left - right;
      const group = (card: DeckBuilderCardView): number => {
        const extraOrder = ["Fusion", "Synchro", "Xyz", "Link"];
        if (
          zone === "extra" ||
          (zone === "side" && card.canonicalZone === "extra")
        ) {
          const subtype = Math.min(
            ...card.subtypes.map((type) => {
              const index = extraOrder.indexOf(type);
              return index < 0 ? extraOrder.length : index;
            }),
          );
          return (zone === "side" ? 3 : 0) + subtype;
        }
        return card.family === "monster" ? 0 : card.family === "spell" ? 1 : 2;
      };
      return (
        group(a) - group(b) || a.name.localeCompare(b.name) || a.code - b.code
      );
    };
  return Object.freeze({
    main: Object.freeze([...cards.main].sort(compare("main"))),
    extra: Object.freeze([...cards.extra].sort(compare("extra"))),
    side: Object.freeze([...cards.side].sort(compare("side"))),
  });
}

export function mainDeckGridPlan(count: number): DeckGridPlan {
  return count <= 40
    ? Object.freeze({ columns: 10, rows: 4, slots: 40, compact: false })
    : Object.freeze({ columns: 12, rows: 5, slots: 60, compact: true });
}

export const FIFTEEN_CARD_GRID: DeckGridPlan = Object.freeze({
  columns: 5,
  rows: 3,
  slots: 15,
  compact: false,
});

function removeFirst(values: number[], code: number): boolean {
  const index = values.indexOf(code);
  if (index < 0) return false;
  values.splice(index, 1);
  return true;
}
