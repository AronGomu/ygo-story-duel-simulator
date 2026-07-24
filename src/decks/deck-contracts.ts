export type DeckId = string & { readonly __deckId: unique symbol };

export function deckId(value: string): DeckId {
  const normalized = value.trim();
  if (
    normalized.length === 0 ||
    normalized.length > 128 ||
    normalized.includes("\0")
  )
    throw new Error("Deck ID is invalid");
  return normalized as DeckId;
}

export type DeckZone = "main" | "extra" | "side";
export type DeckIssueSeverity = "warning" | "error";

export interface DeckValidationIssue {
  readonly id: string;
  readonly severity: DeckIssueSeverity;
  readonly code:
    | "main-under-minimum"
    | "main-over-maximum"
    | "extra-over-maximum"
    | "side-over-maximum"
    | "copy-limit"
    | "forbidden"
    | "wrong-zone"
    | "missing-card"
    | "unsupported-card"
    | "empty-extra"
    | "empty-side"
    | "missing-art"
    | "ruleset-changed"
    | "import-review";
  readonly message: string;
  readonly zone?: DeckZone;
  readonly cardCode?: number;
}

export interface DeckValidationSummary {
  readonly status: "valid" | "warnings" | "errors";
  readonly issues: readonly DeckValidationIssue[];
  readonly rulesetRevision: string;
}

export interface DeckCardLists {
  readonly main: readonly number[];
  readonly extra: readonly number[];
  readonly side: readonly number[];
}

export interface DeckRecord extends DeckCardLists {
  readonly schemaVersion: 1;
  readonly id: DeckId;
  readonly revision: number;
  readonly name: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly validation: DeckValidationSummary;
  readonly importedNeedsReview: boolean;
}

export interface ValidatedDeckSnapshot extends DeckCardLists {
  readonly ref: Readonly<{ type: "local"; deckId: DeckId; revision: number }>;
  readonly name: string;
  readonly validationDigest: string;
}

export type ResolveDeckResult =
  | Readonly<{ type: "ready"; deck: ValidatedDeckSnapshot }>
  | Readonly<{ type: "missing"; deckId: DeckId }>
  | Readonly<{
      type: "invalid";
      deckId: DeckId;
      issues: readonly DeckValidationIssue[];
    }>;

export interface DeckCardUpdate {
  readonly id: string;
  readonly deckId: DeckId;
  readonly sequence: number;
  readonly createdAt: string;
  readonly before: DeckCardLists;
  readonly after: DeckCardLists;
  readonly beforeImportedNeedsReview: boolean;
  readonly afterImportedNeedsReview: boolean;
  readonly reason: "add" | "remove" | "move" | "import";
}

export interface DeckHistory {
  readonly undo: readonly DeckCardUpdate[];
  readonly redo: readonly DeckCardUpdate[];
  readonly nextSequence: number;
}

export interface StoredDeck {
  readonly deck: DeckRecord;
  readonly history: DeckHistory;
}

export function cloneCardLists(value: DeckCardLists): DeckCardLists {
  return Object.freeze({
    main: Object.freeze([...value.main]),
    extra: Object.freeze([...value.extra]),
    side: Object.freeze([...value.side]),
  });
}
