import type {
  DeckId,
  ResolveDeckResult,
  ValidatedDeckSnapshot,
} from "./deck-contracts.ts";
import type { DeckRepository } from "./deck-repository.ts";
import type { DeckBuilderCardView } from "./catalog/ocg-card-mapper.ts";
import type { PinnedDeckRuleset } from "./catalog/pinned-ruleset.ts";
import { validateDeckDraft, validationDigest } from "./deck-validation.ts";

export async function resolveDeck(
  deckId: DeckId,
  repository: Pick<DeckRepository, "load">,
  catalog: ReadonlyMap<number, DeckBuilderCardView>,
  ruleset: PinnedDeckRuleset,
): Promise<ResolveDeckResult> {
  const stored = await repository.load(deckId);
  if (stored === null) return Object.freeze({ type: "missing", deckId });
  const validation = validateDeckDraft(
    {
      ...stored.deck,
      storedRulesetRevision: stored.deck.validation.rulesetRevision,
    },
    catalog,
    ruleset,
  );
  const errors = validation.issues.filter(
    ({ severity }) => severity === "error",
  );
  if (errors.length > 0)
    return Object.freeze({
      type: "invalid",
      deckId,
      issues: Object.freeze(errors),
    });
  const snapshot: ValidatedDeckSnapshot = Object.freeze({
    ref: Object.freeze({
      type: "local",
      deckId,
      revision: stored.deck.revision,
    }),
    name: stored.deck.name,
    main: Object.freeze([...stored.deck.main]),
    extra: Object.freeze([...stored.deck.extra]),
    side: Object.freeze([...stored.deck.side]),
    validationDigest: validationDigest(validation),
  });
  return Object.freeze({ type: "ready", deck: snapshot });
}
