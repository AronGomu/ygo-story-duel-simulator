import type { DeckBuilderCardView } from "./ocg-card-mapper.ts";

export interface PinnedDeckRuleset {
  readonly id: string;
  readonly revision: string;
  readonly quantityByCode: ReadonlyMap<number, 0 | 1 | 2 | 3>;
}

export const PROTOTYPE_RULESET: PinnedDeckRuleset = Object.freeze({
  id: "prototype-single-ruleset",
  revision: "prototype-2026-01",
  quantityByCode: new Map<number, 0 | 1 | 2 | 3>([
    [10000000, 0],
    [12580477, 1],
    [44095762, 2],
  ]),
});

export function quantityLimit(
  ruleset: PinnedDeckRuleset,
  cardCode: number,
): 0 | 1 | 2 | 3 {
  return ruleset.quantityByCode.get(cardCode) ?? 3;
}

export function catalogByCode(
  cards: readonly DeckBuilderCardView[],
): ReadonlyMap<number, DeckBuilderCardView> {
  return new Map(cards.map((card) => [card.code, card]));
}
