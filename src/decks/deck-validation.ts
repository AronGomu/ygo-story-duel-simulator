import type {
  DeckCardLists,
  DeckValidationIssue,
  DeckValidationSummary,
} from "./deck-contracts.ts";
import {
  unlimitedCardOwnership,
  type CardOwnership,
} from "./card-ownership.ts";
import type { DeckBuilderCardView } from "./catalog/ocg-card-mapper.ts";
import { OCG_TYPE, hasOcgType } from "./catalog/ocg-mask.ts";
import {
  quantityLimit,
  type PinnedDeckRuleset,
} from "./catalog/pinned-ruleset.ts";

export interface DeckValidationInput extends DeckCardLists {
  readonly importedNeedsReview?: boolean;
  readonly storedRulesetRevision?: string;
}

/** `ownership` defaults to free play's for the same reason the editor's
    controller does: a caller that says nothing about which world the deck
    belongs to is asking about the one that owns everything. A story caller
    passes the save's reader, and gets `not-owned` for the cards it no longer
    has (ADR-050). */
export function validateDeckDraft(
  deck: DeckValidationInput,
  catalog: ReadonlyMap<number, DeckBuilderCardView>,
  ruleset: PinnedDeckRuleset,
  ownership: CardOwnership = unlimitedCardOwnership(),
): DeckValidationSummary {
  const issues: DeckValidationIssue[] = [];
  if (deck.main.length < 40)
    issues.push(
      issue(
        "main-under-minimum",
        "error",
        `Main Deck needs ${40 - deck.main.length} more card(s).`,
        "main",
      ),
    );
  if (deck.main.length > 60)
    issues.push(
      issue(
        "main-over-maximum",
        "error",
        `Main Deck exceeds 60 cards by ${deck.main.length - 60}.`,
        "main",
      ),
    );
  if (deck.extra.length > 15)
    issues.push(
      issue(
        "extra-over-maximum",
        "error",
        `Extra Deck exceeds 15 cards by ${deck.extra.length - 15}.`,
        "extra",
      ),
    );
  if (deck.side.length > 15)
    issues.push(
      issue(
        "side-over-maximum",
        "error",
        `Side Deck exceeds 15 cards by ${deck.side.length - 15}.`,
        "side",
      ),
    );
  if (deck.extra.length === 0)
    issues.push(
      issue("empty-extra", "warning", "Extra Deck is empty.", "extra"),
    );

  const counts = new Map<number, number>();
  for (const code of [...deck.main, ...deck.extra, ...deck.side])
    counts.set(code, (counts.get(code) ?? 0) + 1);

  for (const [code, count] of counts) {
    const card = catalog.get(code);
    /* Two limits, not one. `copy-limit` below answers how many copies a deck
       may run; this answers how many the save has, and a deck can break both
       at once. The add affordance in `catalog-availability.ts` collapses them
       into one `min` on purpose, because it only has to decide yes or no; a
       verdict cannot, because the player has to know which limit to fix — and
       selling a card is the one that turns a deck illegal without anybody
       editing it. Read off the count map above rather than counted again, so
       the same card sleeved into Main and Side stays two copies of one card.

       Raised before the missing-card guard: a code the catalog lost and a code
       the save sold are different facts, and a deck can carry both. */
    if (!ownership.isUnlimited) {
      const owned = ownership.ownedCount(code);
      if (count > owned)
        issues.push(
          issue(
            "not-owned",
            "error",
            `This deck uses ${count} copy/copies of ${card?.name ?? `Card ${code}`}; you own ${owned}.`,
            undefined,
            code,
          ),
        );
    }
    if (card === undefined) {
      issues.push(
        issue(
          "missing-card",
          "error",
          `Card ${code} is missing from the pinned catalog.`,
          undefined,
          code,
        ),
      );
      continue;
    }
    const limit = quantityLimit(ruleset, code);
    if (limit === 0)
      issues.push(
        issue(
          "forbidden",
          "error",
          `${card.name} is forbidden by the pinned ruleset.`,
          undefined,
          code,
        ),
      );
    else if (count > limit)
      issues.push(
        issue(
          "copy-limit",
          "error",
          `${card.name} allows ${limit} copy/copies; found ${count}.`,
          undefined,
          code,
        ),
      );
    if (hasOcgType(card.rawType, OCG_TYPE.TOKEN) || (card.scope & 8) !== 0)
      issues.push(
        issue(
          "unsupported-card",
          "error",
          `${card.name} cannot be used by this ruleset.`,
          undefined,
          code,
        ),
      );
  }

  for (const code of deck.main) {
    const card = catalog.get(code);
    if (card?.canonicalZone === "extra")
      issues.push(
        issue(
          "wrong-zone",
          "error",
          `${card.name} belongs in the Extra Deck.`,
          "main",
          code,
        ),
      );
  }
  for (const code of deck.extra) {
    const card = catalog.get(code);
    if (card?.canonicalZone === "main")
      issues.push(
        issue(
          "wrong-zone",
          "error",
          `${card.name} does not belong in the Extra Deck.`,
          "extra",
          code,
        ),
      );
  }
  if (deck.importedNeedsReview)
    issues.push(
      issue(
        "import-review",
        "warning",
        "Imported deck has not been reviewed.",
        undefined,
      ),
    );
  if (
    deck.storedRulesetRevision !== undefined &&
    deck.storedRulesetRevision !== ruleset.revision
  )
    issues.push(
      issue(
        "ruleset-changed",
        "warning",
        "Pinned ruleset changed since this deck was saved.",
        undefined,
      ),
    );

  const deduped = [
    ...new Map(issues.map((value) => [value.id, value])).values(),
  ];
  return Object.freeze({
    status: deduped.some(({ severity }) => severity === "error")
      ? "errors"
      : deduped.length > 0
        ? "warnings"
        : "valid",
    issues: Object.freeze(deduped),
    rulesetRevision: ruleset.revision,
  });
}

export function validationDigest(summary: DeckValidationSummary): string {
  const serialized = JSON.stringify({
    revision: summary.rulesetRevision,
    issues: summary.issues.map(({ id, severity }) => ({ id, severity })),
  });
  let hash = 2166136261;
  for (const character of serialized) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return `fnv1a-${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

function issue(
  code: DeckValidationIssue["code"],
  severity: DeckValidationIssue["severity"],
  message: string,
  zone?: DeckValidationIssue["zone"],
  cardCode?: number,
): DeckValidationIssue {
  const suffix = `${zone ?? "deck"}-${cardCode ?? "all"}`;
  return Object.freeze({
    id: `${code}:${suffix}`,
    code,
    severity,
    message,
    ...(zone === undefined ? {} : { zone }),
    ...(cardCode === undefined ? {} : { cardCode }),
  });
}
