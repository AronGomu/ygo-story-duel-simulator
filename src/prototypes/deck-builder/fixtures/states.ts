import type { DeckBuilderState } from "../deck-builder-store.ts";
import type {
  DeckId,
  DeckValidationIssue,
} from "../../../decks/deck-contracts.ts";
import { validateDeckDraft } from "../../../decks/deck-validation.ts";
import type { DeckBuilderCardView } from "../../../decks/catalog/ocg-card-mapper.ts";
import type { PinnedDeckRuleset } from "../../../decks/catalog/pinned-ruleset.ts";
import { createBlankDeck } from "../../../decks/deck-model.ts";
import {
  emptyDeckHistory,
  pushDeckUpdate,
} from "../../../decks/deck-history.ts";

export const PROTOTYPE_REVIEW_STATE_GROUPS = [
  {
    area: "Entry",
    states: [
      ["entry-ready", "Last-opened ready"],
      ["entry-none", "No last-opened"],
      ["entry-stale", "Stale/deleted last-opened"],
    ],
  },
  {
    area: "Library",
    states: [
      ["loading", "Loading"],
      ["library-populated", "Populated"],
      ["library-empty", "Empty"],
      ["fatal-error", "Load error"],
    ],
  },
  {
    area: "Editor",
    states: [
      ["editor-empty", "Empty"],
      ["main-40", "40 cards"],
      ["main-41", "41 cards"],
      ["main-60", "60 cards"],
      ["editor-overflow", "Invalid overflow"],
    ],
  },
  {
    area: "Save",
    states: [
      ["save-saving", "Saving"],
      ["save-saved", "Saved"],
      ["save-failure", "Failed"],
      ["save-retrying", "Retrying"],
      ["revision-conflict", "Revision conflict"],
    ],
  },
  {
    area: "History",
    states: [
      ["history-empty", "Empty"],
      ["history-partial", "Partial"],
      ["history-50", "50 retained"],
      ["history-undo", "Undo"],
      ["history-redo", "Redo"],
      ["history-branched", "Branched edit"],
    ],
  },
  {
    area: "Catalog",
    states: [
      ["catalog-loading", "Loading"],
      ["catalog-results", "Results"],
      ["catalog-filtered", "Filtered"],
      ["catalog-empty", "No results"],
      ["catalog-error", "Load error"],
    ],
  },
  {
    area: "Details",
    states: [
      ["details-none", "No selection"],
      ["details-selected", "Selected"],
      ["details-long", "Long text"],
      ["details-missing-art", "Missing art/text/card"],
    ],
  },
  {
    area: "Drag",
    states: [
      ["drag-idle", "Idle"],
      ["drag-picked", "Picked up"],
      ["drag-valid", "Valid target"],
      ["drag-invalid", "Invalid target"],
      ["drag-dropped", "Dropped"],
      ["drag-cancelled", "Cancelled"],
    ],
  },
  {
    area: "Validation",
    states: [
      ["validation-valid", "Valid"],
      ["validation-warning", "Warnings"],
      ["validation-error", "Errors"],
      ["validation-stale", "Stale ruleset"],
      ["missing-card", "Missing imported card"],
    ],
  },
  {
    area: "Import",
    states: [
      ["import-idle", "Idle"],
      ["import-preview", "Preview"],
      ["import-malformed", "Malformed"],
      ["import-unknown", "Unknown cards"],
      ["import-success", "Success"],
    ],
  },
  {
    area: "Export",
    states: [
      ["export-ready", "Ready"],
      ["export-invalid", "Invalid warning"],
      ["export-success", "Success"],
      ["export-failure", "Failure"],
    ],
  },
  {
    area: "Delete",
    states: [
      ["delete-confirm", "Confirm"],
      ["delete-pending", "Pending"],
      ["delete-success", "Success"],
      ["delete-failure", "Failure"],
    ],
  },
  {
    area: "Resolver",
    states: [
      ["resolver-ready", "Ready"],
      ["resolver-missing", "Missing"],
      ["resolver-invalid", "Invalid"],
    ],
  },
] as const;

export type PrototypeReviewState =
  "live" | (typeof PROTOTYPE_REVIEW_STATE_GROUPS)[number]["states"][number][0];

export function reviewStateLabel(mode: PrototypeReviewState): string {
  if (mode === "live") return "Live data";
  for (const group of PROTOTYPE_REVIEW_STATE_GROUPS) {
    const state = group.states.find(([value]) => value === mode);
    if (state !== undefined) return `${group.area} — ${state[1]}`;
  }
  return mode;
}

export function applyPrototypeReviewState(
  state: DeckBuilderState,
  mode: PrototypeReviewState,
  catalog: ReadonlyMap<number, DeckBuilderCardView>,
  ruleset: PinnedDeckRuleset,
): DeckBuilderState {
  if (mode === "live") return state;
  if (mode === "loading") return Object.freeze({ ...state, mode: "loading" });
  if (mode === "fatal-error")
    return Object.freeze({
      ...state,
      mode: "error",
      message: "Simulated prototype storage failure.",
    });

  const current =
    state.current ??
    Object.freeze({
      deck: createBlankDeck("Review Fixture", catalog, ruleset, {
        id: "prototype-review-fixture",
        now: new Date("2026-01-01T00:00:00.000Z"),
      }),
      history: emptyDeckHistory(),
    });

  if (["entry-none", "entry-stale", "library-empty"].includes(mode))
    return Object.freeze({
      ...state,
      mode: "library",
      decks: Object.freeze([]),
      current: null,
      message:
        mode === "entry-stale" ? "Deck no longer exists." : "Review fixture",
    });
  if (mode === "library-populated")
    return Object.freeze({
      ...state,
      mode: "library",
      decks: Object.freeze([current.deck]),
      current: null,
      message: "Review fixture: Library — Populated",
    });

  const saveState = saveStateFor(mode);
  if (saveState !== null)
    return Object.freeze({
      ...state,
      mode: "editor",
      current,
      saveState,
      message: `Review fixture: ${reviewStateLabel(mode)}`,
    });

  if (mode.startsWith("history-")) {
    const history = fixtureHistory(mode, current.deck.id);
    return Object.freeze({
      ...state,
      mode: "editor",
      current: Object.freeze({ ...current, history }),
      message: `Review fixture: ${reviewStateLabel(mode)}`,
    });
  }

  const count = cardCountFor(mode);
  if (count !== null || mode === "missing-card" || mode === "import-unknown") {
    const available = [...catalog.values()]
      .filter(({ canonicalZone }) => canonicalZone === "main")
      .map(({ code }) => code);
    const main = Array.from(
      { length: count ?? 39 },
      (_, index) => available[index % available.length]!,
    );
    if (mode === "missing-card" || mode === "import-unknown")
      main.push(99999999);
    const deck = Object.freeze({
      ...current.deck,
      main: Object.freeze(main),
      validation: validateDeckDraft(
        { main, extra: current.deck.extra, side: current.deck.side },
        catalog,
        ruleset,
      ),
    });
    return Object.freeze({
      ...state,
      mode: "editor",
      current: Object.freeze({ ...current, deck }),
      message: `Review fixture: ${reviewStateLabel(mode)}`,
    });
  }

  if (mode.startsWith("validation-")) {
    const severity: "error" | "warning" =
      mode === "validation-error" ? "error" : "warning";
    const issues: readonly DeckValidationIssue[] =
      mode === "validation-valid"
        ? []
        : [
            {
              id: `review-${mode}`,
              code:
                mode === "validation-stale"
                  ? "ruleset-changed"
                  : mode === "validation-error"
                    ? "main-under-minimum"
                    : "empty-side",
              severity,
              message:
                mode === "validation-stale"
                  ? "Pinned ruleset changed since this deck was saved."
                  : mode === "validation-error"
                    ? "Main Deck needs more cards."
                    : "Side Deck is empty.",
            },
          ];
    const validation = Object.freeze({
      status:
        mode === "validation-valid"
          ? ("valid" as const)
          : severity === "error"
            ? ("errors" as const)
            : ("warnings" as const),
      issues: Object.freeze(issues),
      rulesetRevision: ruleset.revision,
    });
    return Object.freeze({
      ...state,
      mode: "editor",
      current: Object.freeze({
        ...current,
        deck: Object.freeze({ ...current.deck, validation }),
      }),
      message: `Review fixture: ${reviewStateLabel(mode)}`,
    });
  }

  return Object.freeze({
    ...state,
    mode: "editor",
    current,
    message: `Review fixture: ${reviewStateLabel(mode)}`,
  });
}

function saveStateFor(
  mode: PrototypeReviewState,
): DeckBuilderState["saveState"] | null {
  if (mode === "save-saving" || mode === "save-retrying") return "saving";
  if (mode === "save-saved") return "saved";
  if (mode === "save-failure") return "failed";
  if (mode === "revision-conflict") return "conflict";
  return null;
}

function cardCountFor(mode: PrototypeReviewState): number | null {
  if (mode === "editor-empty") return 0;
  if (mode === "main-40") return 40;
  if (mode === "main-41") return 41;
  if (mode === "main-60") return 60;
  if (mode === "editor-overflow") return 61;
  return null;
}

function fixtureHistory(mode: PrototypeReviewState, deckId: DeckId) {
  if (mode === "history-empty") return emptyDeckHistory();
  const count = mode === "history-50" ? 50 : 2;
  let history = emptyDeckHistory();
  for (let index = 0; index < count; index += 1)
    history = pushDeckUpdate(history, {
      id: `review-${index}`,
      deckId,
      before: { main: [index + 1], extra: [], side: [] },
      after: { main: [index + 2], extra: [], side: [] },
      reason: "add",
      now: new Date(index * 1000),
    });
  if (mode === "history-redo")
    return Object.freeze({
      ...history,
      undo: Object.freeze(history.undo.slice(0, -1)),
      redo: Object.freeze(history.undo.slice(-1)),
    });
  if (mode === "history-branched")
    return Object.freeze({ ...history, redo: Object.freeze([]) });
  return history;
}
