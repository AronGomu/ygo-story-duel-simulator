/* The shape of everything the story writes to disk, in one place, so the
   repository and any test fixture can never create two different versions of
   the same record. A save is the only story artefact a player cannot
   reconstruct by replaying, so every read is a parse that can fail loudly
   rather than a cast that fails silently three screens later. */

import { PROLOGUE } from "../content/prologue.ts";
import { buildLegacyStarterGrant } from "../decks/starter-grant.ts";
import {
  createInitialStoryState,
  STORY_SCREENS,
  type StoryScreen,
  type StoryState,
} from "../model/story-state.ts";

export const STORY_SAVES_DATABASE_NAME = "ygo-story-saves";
export const STORY_SAVES_DATABASE_VERSION = 1;
export const STORY_SAVES_STORE_NAME = "saves";
export const STORY_SAVE_SCHEMA_VERSION = 4;

/** The oldest schema this build can still read. Version 1 predates the shop:
    it carries no economy, and `migrateStorySaveState` completes it. */
const OLDEST_READABLE_SCHEMA_VERSION = 1;

export type StorySlotKey =
  `manual:${1 | 2 | 3}` | "autosave" | "checkpoint:pre-duel";

/** Every slot the store recognises. A key outside this list is never written,
    so a forged or future key reads as empty instead of resurrecting a record
    the current build cannot interpret. */
export const STORY_SLOT_KEYS: readonly StorySlotKey[] = Object.freeze([
  "manual:1",
  "manual:2",
  "manual:3",
  "autosave",
  "checkpoint:pre-duel",
] as const);

export function isStorySlotKey(value: unknown): value is StorySlotKey {
  return (
    typeof value === "string" &&
    (STORY_SLOT_KEYS as readonly string[]).includes(value)
  );
}

export interface StorySaveEnvelope {
  readonly schemaVersion: 4;
  readonly slot: StorySlotKey;
  readonly revision: number;
  readonly savedAt: number;
  readonly state: StoryState;
}

export interface StorySaveSummary {
  readonly slot: StorySlotKey;
  readonly revision: number;
  readonly savedAt: number;
  readonly chapterLabel: string;
}

export type StorySaveReadResult =
  | { readonly kind: "empty"; readonly slot: StorySlotKey }
  | { readonly kind: "ready"; readonly envelope: StorySaveEnvelope }
  | {
      readonly kind: "incompatible";
      readonly slot: StorySlotKey;
      readonly found: number;
    }
  | {
      readonly kind: "corrupt";
      readonly slot: StorySlotKey;
      readonly reason: string;
    };

export type StorySaveWriteResult =
  | { readonly kind: "written"; readonly revision: number }
  | { readonly kind: "stale"; readonly currentRevision: number }
  | {
      readonly kind: "failed";
      readonly reason: "quota" | "unavailable" | "unknown";
    };

/** The schema, in one place. One store keyed by slot, so a repeated save
    overwrites its slot rather than growing an append-only log.

    The key is out-of-line rather than a `keyPath` on the envelope: an in-line
    key would make a record without a readable `slot` field unstorable, and a
    store that cannot physically hold a corrupt record is a store whose read
    path can never be shown to survive one. The envelope keeps its own `slot`
    field, which `parseStorySaveEnvelope` checks against the key it was filed
    under. */
export function createStorySaveStores(database: IDBDatabase): void {
  database.createObjectStore(STORY_SAVES_STORE_NAME);
}

const ENVELOPE_KEYS = [
  "revision",
  "savedAt",
  "schemaVersion",
  "slot",
  "state",
] as const;

/**
 * Turns whatever came back from the store into a result the story can act on.
 *
 * The states a player can arrive in, and what each resolves to:
 *
 * - nothing stored under the slot — a fresh player, or a cleared slot: `empty`.
 * - a record whose `schemaVersion` this build does not know — `incompatible`,
 *   carrying the version found, so a downgrade reports the truth instead of
 *   silently discarding a newer save.
 * - a record that is not an envelope, is keyed under a different slot, or
 *   carries a story state that no longer parses — `corrupt`. The caller shows
 *   the reason and continues from memory; it never resumes from a half-record.
 * - anything else — `ready`.
 */
export function parseStorySaveEnvelope(
  slot: StorySlotKey,
  value: unknown,
): StorySaveReadResult {
  if (value === undefined || value === null) return { kind: "empty", slot };
  if (typeof value !== "object" || Array.isArray(value))
    return corrupt(slot, "Save record is not an object");

  const record = value as Record<string, unknown>;
  /* The version gate comes before the shape gate on purpose: a newer build is
     free to have changed the shape, and reporting that as corruption would
     invite the player to delete a save this build simply cannot read. */
  const schemaVersion = record.schemaVersion;
  if (!isCount(schemaVersion) || schemaVersion < OLDEST_READABLE_SCHEMA_VERSION)
    return corrupt(slot, "Save record has no usable schema version");
  if (schemaVersion > STORY_SAVE_SCHEMA_VERSION)
    return { kind: "incompatible", slot, found: schemaVersion };

  if (!hasExactKeys(record, ENVELOPE_KEYS))
    return corrupt(slot, "Save record does not have the expected fields");
  if (record.slot !== slot)
    return corrupt(slot, `Save record belongs to another slot`);
  if (!isCount(record.revision) || record.revision < 1)
    return corrupt(slot, "Save record has no usable revision");
  if (!isCount(record.savedAt))
    return corrupt(slot, "Save record has no usable timestamp");
  const state = migrateStorySaveState(record.state, schemaVersion);
  if (state === null) return corrupt(slot, "Saved story state is invalid");

  /* Rebuilt rather than cast, so a `ready` envelope always describes itself as
     the version this build actually returns: an older record reaches the story
     already migrated, and nothing downstream has to ask which version it came
     from. */
  return {
    kind: "ready",
    envelope: {
      schemaVersion: STORY_SAVE_SCHEMA_VERSION,
      slot,
      revision: record.revision,
      savedAt: record.savedAt,
      state,
    },
  };
}

/** What a save written before the shop existed is missing. Every field is a
    fresh player's: a returning save resumes funded, owning nothing, with no
    shop visit half-open.

    Built per call rather than shared, so two migrated saves never end up
    pointing at one inventory object. */
function economyDefaults(): Record<string, unknown> {
  return {
    dp: 1000,
    boosters: {},
    collection: {},
    shopReturnScreen: null,
    shopSetId: null,
    openedCards: null,
    openingMode: null,
  };
}

/** What a save written before the decks moved into the story is missing: a
    deck to duel with, and the cards behind it.

    The starter grant rather than an empty list, because an empty one locks the
    save out of the whole game: the pre-battle gate refuses a save with no
    decks, `encounterDeck` resolves none, and the deck editor deliberately
    grants a story save nothing (ADR-050) — so the player would have to build
    forty legal cards out of a collection they do not own. This historical
    grant stays pinned to the legacy list; changing the new-game starter must
    never change what an old-schema read grants.

    Per code, the higher of the stored and granted counts — never the sum: the
    record on disk stays at its own version, so every read migrates it again,
    and an adding merge would double what the first read handed out. A maximum
    lands on the same counts however many times it runs, which makes this the
    one place a grant can live without becoming a fountain — it runs per record
    read, not per button press.

    Built per call for the same reason as the economy defaults: two migrated
    saves must not come back sharing one deck list. */
function withStarterDecks(
  state: Record<string, unknown>,
): Record<string, unknown> {
  /* No version before 3 ever wrote either field, so a record that declares one
     of those versions and carries one anyway is not a save this build can
     explain. It is completed with nothing rather than granted a deck on top of
     whatever it does hold. A save that deleted its last deck on purpose is a
     different case and never arrives here: it is version 3, and version 3 is
     not migrated. */
  if (state.decks !== undefined || state.defaultDeckId !== undefined)
    return state;
  const { deck, collection } = buildLegacyStarterGrant();
  const owned = state.collection;
  return {
    ...state,
    decks: [deck],
    defaultDeckId: deck.id,
    /* The deck and the cards behind it are one grant: a deck built from cards
       the save does not own is refused at the first duel, which is the whole
       point of granting the two together.

       Merged per card code, and only over a collection that is already a
       record: a collection this build cannot read stays unreadable rather than
       being laundered into a valid save by the grant. */
    collection:
      typeof owned === "object" && owned !== null && !Array.isArray(owned)
        ? topUpToGrant(owned as Record<string, unknown>, collection)
        : owned,
  };
}

/** The stored collection with every granted code raised to the count the
    granted deck actually runs, and nothing lowered.

    A stored count that already meets or beats the grant is the player's and is
    kept; one below it is topped up, because the grant is a deck *and* the cards
    behind it, and half a playset makes the granted deck as illegal as no deck
    at all — the same lockout the grant was added to close, only now with a deck
    the player cannot field. Only the granted deck's own copies are ever handed
    out, so a second migration of the same record changes nothing.

    A stored value that is not a count is left exactly as it is: it makes the
    record fail validation, and repairing it here would resume a save from a
    number this build invented. */
function topUpToGrant(
  stored: Record<string, unknown>,
  granted: Readonly<Record<number, number>>,
): Record<string, unknown> {
  const merged: Record<string, unknown> = { ...stored };
  for (const [code, copies] of Object.entries(granted)) {
    const held = merged[code];
    if (held === undefined) merged[code] = copies;
    else if (isCount(held)) merged[code] = Math.max(held, copies);
  }
  return merged;
}

/**
 * Brings a stored story state up to the shape this build runs on, or answers
 * `null` when it cannot be read at all.
 *
 * Older versions have what they are missing spread in *under* the stored
 * fields, one version step at a time, so a value the record already carries
 * always wins over the default and a version 1 record picks up the economy and
 * the deck list on its way forward. Legacy favourites are dropped at every
 * version because they were added without a schema bump.
 *
 * The completed state is then validated exactly like a current-version one — a v1
 * record with a broken beat index stays corrupt rather than being laundered by
 * the migration. Any other version answers `null`; the caller has already
 * separated "too new" from "unreadable".
 */
export function migrateStorySaveState(
  raw: unknown,
  schemaVersion: number,
): StoryState | null {
  if (
    schemaVersion !== 1 &&
    schemaVersion !== 2 &&
    schemaVersion !== 3 &&
    schemaVersion !== 4
  )
    return null;
  if (typeof raw !== "object" || raw === null || Array.isArray(raw))
    return null;
  let candidate = raw as Record<string, unknown>;
  if (schemaVersion < 2)
    candidate = withCardShop({ ...economyDefaults(), ...candidate });
  if (schemaVersion < 3) candidate = withStarterDecks(candidate);
  candidate = withNormalizedPreviousScreen(withoutLegacyFavourites(candidate));
  return isStoryState(candidate) ? candidate : null;
}

/** Adds the v4 navigation pointer without sacrificing otherwise-valid saves.
    Unknown screen names cannot be followed safely, so they normalize to the
    same null fallback as a legacy record that never stored the field. */
function withNormalizedPreviousScreen(
  state: Record<string, unknown>,
): Record<string, unknown> {
  const previousScreen = state.previousScreen;
  return {
    ...state,
    previousScreen:
      typeof previousScreen === "string" &&
      (STORY_SCREENS as readonly string[]).includes(previousScreen)
        ? previousScreen
        : null,
  };
}

/** Favourites entered v3 without a schema bump. Drop any payload shape before
    validation, so valid legacy progress loads without restoring the feature. */
function withoutLegacyFavourites(
  state: Record<string, unknown>,
): Record<string, unknown> {
  if (!("favouriteDeckIds" in state)) return state;
  const current = { ...state };
  delete current.favouriteDeckIds;
  return current;
}

/** The map a save written before the shop existed carries, plus the node it
    could not have known about. Appended rather than rebuilt, so every node the
    player already opened keeps the state they left it in — and a record that
    somehow already has the shop is left exactly as it is. */
function withCardShop(state: Record<string, unknown>): Record<string, unknown> {
  const locations = state["locations"];
  if (!Array.isArray(locations)) return state;
  const hasCardShop = locations.some(
    (location) =>
      typeof location === "object" &&
      location !== null &&
      (location as Record<string, unknown>)["id"] === "card-shop",
  );
  if (hasCardShop) return state;
  const cardShop = createInitialStoryState().locations.find(
    ({ id }) => id === "card-shop",
  );
  return cardShop === undefined
    ? state
    : { ...state, locations: [...locations, cardShop] };
}

export function summarizeStorySave(
  envelope: StorySaveEnvelope,
): StorySaveSummary {
  return Object.freeze({
    slot: envelope.slot,
    revision: envelope.revision,
    savedAt: envelope.savedAt,
    chapterLabel: storyChapterLabel(envelope.state),
  });
}

const SCREEN_LABELS: Readonly<Record<StoryScreen, string>> = Object.freeze({
  title: "Title",
  load: "Load",
  narrative: "Prologue",
  map: "City map",
  "pre-battle": "Old Arena",
  "battle-mock": "Duel",
  outcome: "Outcome",
  reward: "Reward",
  end: "End of the prologue",
  "shop-greeting": "Card shop",
  "shop-browse": "Card shop",
  "shop-cards": "Card shop",
  "shop-sell": "Card shop",
  "shop-opening": "Card shop",
  "shop-results": "Card shop",
});

/** Where a save resumes from, in the player's words. Derived rather than
    stored, so a chapter rename never has to migrate existing records. */
export function storyChapterLabel(state: StoryState): string {
  return `${PROLOGUE.title} · ${SCREEN_LABELS[state.savedScreen]}`;
}

function corrupt(slot: StorySlotKey, reason: string): StorySaveReadResult {
  return { kind: "corrupt", slot, reason };
}

function isCount(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

/* The wallet, what the player owns, and the shop visit in progress. A stored
   balance that is not a whole non-negative number, or an inventory holding
   something other than counts, is a record this build must not resume from:
   the economy is the one part of the state a player could otherwise forge. */
function isEconomy(state: Record<string, unknown>): boolean {
  const screens = new Set<string>(STORY_SCREENS);
  const rarities = new Set<string>([
    "common",
    "rare",
    "super-rare",
    "ultra-rare",
    "secret-rare",
    "ultimate-rare",
    "ghost-rare",
  ]);
  return (
    isCount(state.dp) &&
    isCountRecord(state.boosters, isSetIdKey) &&
    isCountRecord(state.collection, isCardCodeKey) &&
    (state.shopReturnScreen === null ||
      (typeof state.shopReturnScreen === "string" &&
        screens.has(state.shopReturnScreen))) &&
    (state.shopSetId === null || typeof state.shopSetId === "string") &&
    (state.openedCards === null ||
      (Array.isArray(state.openedCards) &&
        state.openedCards.every((card) => {
          if (typeof card !== "object" || card === null) return false;
          const opened = card as Record<string, unknown>;
          return (
            isCount(opened.code) &&
            typeof opened.rarity === "string" &&
            rarities.has(opened.rarity)
          );
        }))) &&
    (state.openingMode === null ||
      state.openingMode === "sequential" ||
      state.openingMode === "all")
  );
}

/* The decks this save owns, and which one it duels with. A deck the editor
   cannot open is a deck the player built and then lost, so each record is
   checked field by field like the economy — and two decks under one id are
   refused outright, because every command that edits or deletes a deck
   addresses it by id and one of the pair would be unreachable.

   `defaultDeckId` is checked as an id, not as a pointer: a default naming a
   deck this save no longer has costs one pick screens ignore, while calling
   that record corrupt costs the player the save. */
function isDeckLibrary(state: Record<string, unknown>): boolean {
  const decks = state.decks;
  if (!Array.isArray(decks) || !decks.every(isStoryDeck)) return false;
  if (new Set(decks.map((deck) => deck.id)).size !== decks.length) return false;
  return (
    state.defaultDeckId === null || typeof state.defaultDeckId === "string"
  );
}

/** Exported so the deck repository can refuse a record before it is written:
    a deck this predicate rejects makes the whole save unreadable, and the
    editor's own validator is stricter in ways the save does not care about. */
export function isStoryDeck(value: unknown): boolean {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    return false;
  const deck = value as Record<string, unknown>;
  return (
    deck.schemaVersion === 1 &&
    typeof deck.id === "string" &&
    deck.id.length > 0 &&
    isCount(deck.revision) &&
    typeof deck.name === "string" &&
    typeof deck.createdAt === "string" &&
    typeof deck.updatedAt === "string" &&
    typeof deck.importedNeedsReview === "boolean" &&
    (deck.illustrationCardCode === undefined ||
      deck.illustrationCardCode === null ||
      isCount(deck.illustrationCardCode)) &&
    isCardCodeList(deck.main) &&
    isCardCodeList(deck.extra) &&
    isCardCodeList(deck.side) &&
    isDeckValidation(deck.validation)
  );
}

function isCardCodeList(value: unknown): boolean {
  return Array.isArray(value) && value.every(isCount);
}

/* The stored verdict is a cache rather than an authority — the editor
   recomputes it against the pinned ruleset — so only its shape is checked
   here. A verdict this build would now compute differently costs a
   revalidation, not a save. */
function isDeckValidation(value: unknown): boolean {
  if (typeof value !== "object" || value === null) return false;
  const summary = value as Record<string, unknown>;
  return (
    (summary.status === "valid" ||
      summary.status === "warnings" ||
      summary.status === "errors") &&
    Array.isArray(summary.issues) &&
    typeof summary.rulesetRevision === "string"
  );
}

/* Keys as well as values: an inventory is a record, and a key outside its
   own vocabulary is a record the screens cannot render. `Number("a")` is
   `NaN`, and two such keys collide into one `NaN` row, which takes the sell
   screen down mid-visit rather than at the door. */
function isCountRecord(
  value: unknown,
  isKey: (key: string) => boolean,
): boolean {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    Object.entries(value).every(([key, count]) => isKey(key) && isCount(count))
  );
}

/** A card code, written the one way `Object.keys` gives it back. */
function isCardCodeKey(key: string): boolean {
  const code = Number(key);
  return Number.isSafeInteger(code) && code >= 0 && String(code) === key;
}

/** A shop set id. Unknown ids are refused when a pack is opened rather than
    here: a data file that drops a set must not cost a player their save. */
function isSetIdKey(key: string): boolean {
  return key.length > 0;
}

function hasExactKeys(value: object, expected: readonly string[]): boolean {
  return (
    Object.keys(value).sort().join("\n") === [...expected].sort().join("\n")
  );
}

/* Carried over unchanged from the browser-storage record this replaced: a save
   is only resumable if every screen, beat index and map node in it is one the
   current content actually has. */
function isStoryState(value: unknown): value is StoryState {
  if (typeof value !== "object" || value === null) return false;
  const state = value as Record<string, unknown>;
  const screens = new Set<string>(STORY_SCREENS);
  const choices = new Set([
    null,
    "trust-rin",
    "challenge-rin",
    "observe-first",
  ]);
  const outcomes = new Set([null, "win", "loss", "abort", "failure"]);
  /* Both handoff fields accept `undefined` as well as `null`: a save written
     before the duel handoff existed carries neither key, and reading that as
     corruption would cost a player progress this build can resume perfectly
     well. `restoreStoryState` normalises them on the way back in. */
  const encounters = new Set([
    undefined,
    null,
    "old-arena",
    "archive",
    "hidden-gate",
  ]);
  if (
    typeof state.screen !== "string" ||
    !screens.has(state.screen) ||
    !(
      state.previousScreen === null ||
      (typeof state.previousScreen === "string" &&
        screens.has(state.previousScreen))
    ) ||
    typeof state.savedScreen !== "string" ||
    !screens.has(state.savedScreen) ||
    typeof state.progressExists !== "boolean" ||
    !Number.isSafeInteger(state.narrativeIndex) ||
    (state.narrativeIndex as number) < 0 ||
    (state.narrativeIndex as number) >= PROLOGUE.beats.length ||
    !(
      state.lastInputId === null ||
      (Number.isSafeInteger(state.lastInputId) &&
        (state.lastInputId as number) >= 0)
    ) ||
    !choices.has(state.choice as null | string) ||
    !(
      state.choiceResponse === null || typeof state.choiceResponse === "string"
    ) ||
    !(
      state.laterAcknowledgment === null ||
      typeof state.laterAcknowledgment === "string"
    ) ||
    !outcomes.has(state.outcome as null | string) ||
    !(state.outcomeScene === null || typeof state.outcomeScene === "string") ||
    typeof state.rewardGranted !== "boolean" ||
    typeof state.rewardAcknowledged !== "boolean" ||
    typeof state.objective !== "string" ||
    !encounters.has(state.encounterId as undefined | null | string) ||
    !(
      state.pendingHandoffId === null ||
      state.pendingHandoffId === undefined ||
      typeof state.pendingHandoffId === "string"
    ) ||
    !Array.isArray(state.locations) ||
    !isEconomy(state) ||
    !isDeckLibrary(state)
  )
    return false;
  const VALID_LOCATION_IDS = new Set([
    "old-arena",
    "archive",
    "hidden-gate",
    "card-shop",
  ]);
  const REQUIRED_LOCATION_IDS = ["old-arena", "archive", "hidden-gate"];
  const locationIds = new Set<string>();
  const validLocations = state.locations.every((location) => {
    if (typeof location !== "object" || location === null) return false;
    const item = location as Record<string, unknown>;
    if (typeof item.id !== "string" || locationIds.has(item.id)) return false;
    locationIds.add(item.id);
    return (
      VALID_LOCATION_IDS.has(item.id) &&
      typeof item.access === "string" &&
      ["available", "locked", "hidden"].includes(item.access) &&
      typeof item.completed === "boolean"
    );
  });
  return (
    validLocations &&
    REQUIRED_LOCATION_IDS.every((id) => locationIds.has(id)) &&
    locationIds.size === state.locations.length
  );
}
