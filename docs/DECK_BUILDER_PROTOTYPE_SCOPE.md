# Deck Builder Prototype Scope

> Status: prototype implemented and verified  
> Purpose: define and record isolated prototype coverage  
> Output: interactive desktop prototype with isolated local persistence  
> Implementation status: prototype available at `#/prototype/deck-builder`; production duel integration remains intentionally absent

## 1. Goal

Prototype should validate deck-building UX before production integration.

Primary outcome: reviewer can build, edit, import, export, recover, reopen, then request deck by ID through module boundary. Prototype should expose missing behavior, weak UI choices, unclear rules.

Prototype is not duel integration. Visual Novel (VN) owns deck selection. Deck module owns deck creation, editing, validation, persistence, resolution by deck ID.

## 2. Repo alignment

Approved future direction already defines:

- unrestricted local deck library;
- create, edit, rename, duplicate, delete;
- validation;
- YDK import/export;
- deck selection outside deck module;
- versioned JSON deck records in IndexedDB;
- exact deck revision pinning for saves/battles;
- no campaign card-ownership restriction.

Current shipped MVP differs:

- fixed preset decks only;
- reviewed 22-card allowlist;
- Main Deck constraint: 40–60;
- Extra Deck max: 15;
- Side Deck disabled;
- no user deck persistence;
- no arbitrary-deck duel start.

Prototype targets future direction. Current preset restrictions must remain unchanged.

## 3. Accepted product decisions

| Topic | Decision |
|---|---|
| Entry | Open last-opened deck. Fall back to Deck Library when no valid last-opened ID exists. |
| Create | Blank deck first. No template picker. |
| Invalid draft | Autosave allowed. Import/export allowed. VN resolution returns invalid result. |
| Save | Autosave every accepted mutation. Keep latest 50 card-content updates per deck. |
| Selection | No selected-deck UI. VN supplies deck ID. Deck module resolves validated deck. |
| Side Deck | First-class editor zone. |
| Desktop layout | Catalog + deck workspace + pinned card details. |
| Deck display | Card-art grid only. No compact list. |
| Card details | Always pinned on desktop. Full effect text lives here. |
| Validation timing | Recompute after every edit. |
| Validation visibility | Compact counts/status always visible. Expanded issue list appears when warnings/errors exist. |
| Mobile | Excluded. Desktop-only prototype. |
| Pointer edit model | Drag/drop. |
| Add target | One canonical target per catalog card: Main or Extra. |
| Copies | Repeated tiles. No stacked card or quantity collapse. |
| Main layout | 0–40 cards: 40 slots, 10 × 4. 41–60 cards: 60 smaller slots, 12 × 5. |
| Ordering | No manual ordering. System auto-packs grid. |
| Filters | Name, card family, subtype, Attribute, monster type/race. |
| Long effect text | Omitted from result tiles. Pinned details panel shows full text. |
| Limit state | Distinct quantity badge at card top-left. |
| Missing cards | Error placeholder retains code plus validation issue. |
| Rulesets | One pinned ruleset. No format/banlist selector. |
| Card model | Based on vendored `ocgcore-wasm` data types. UI uses adapters/mappers. |

## 4. Clarified behavior

### 4.1 Autosave plus 50-update history

“Latest 50 card updates” means bounded per-deck card-content history:

- card add, remove, zone move, YDK replacement each create one history entry;
- one drag transaction creates one entry;
- bulk YDK import creates one entry;
- deck rename autosaves but does not consume card-content history;
- history stores maximum 50 committed card-content updates per deck;
- update 51 evicts oldest entry;
- Undo/Redo operates on retained history;
- new card edit after Undo clears Redo branch;
- reload restores current deck plus retained history;
- deck, history, revision commit atomically;
- save failure leaves visible retry state;
- validity never controls autosave.

### 4.2 Validation visibility

Always-visible header shows:

- Main count;
- Extra count;
- Side count;
- `Valid`, `Warnings`, or `Errors` status;
- autosave status kept separate.

Expanded validation panel appears only when issues exist. Each issue points to affected zone/card. Valid state needs no large persistent panel.

### 4.3 Validation blocking policy

All drafts may be created, imported, edited, autosaved, duplicated, exported.

Only deck resolution for VN is blocked:

```ts
type ResolveDeckResult =
  | Readonly<{ type: "ready"; deck: ValidatedDeckSnapshot }>
  | Readonly<{ type: "missing"; deckId: DeckId }>
  | Readonly<{
      type: "invalid";
      deckId: DeckId;
      issues: readonly DeckValidationIssue[];
    }>;
```

No selected/active deck exists inside deck module. VN stores chosen deck ID, calls resolver before encounter dispatch.

### 4.4 Single add target plus Side Deck

Catalog card has one canonical target derived from `OcgCardData.type`:

- Fusion, Synchro, Xyz, Link → Extra;
- all other supported cards → Main.

Catalog drag adds only to canonical target. No destination menu.

Side Deck population uses zone-to-zone drag:

- Main/Extra → Side;
- Side → canonical Main/Extra target.

Invalid imported placement remains visible as error placeholder/state. System never silently relocates it.

### 4.5 Long effect text

Catalog stays dense:

- art;
- card name;
- family/subtype summary;
- quantity-limit badge.

Full description/effect text appears only in pinned details panel. Selecting catalog tile or deck tile updates details.

## 5. Prototype information architecture

```text
Deck Builder entry
├── Valid last-opened ID → Deck Editor
└── Missing/invalid last-opened ID → Deck Library

Deck Library
├── Create blank deck
├── Import YDK
├── Open deck
├── Rename deck
├── Duplicate deck
├── Export deck
└── Delete deck

Deck Editor
├── Deck name + autosave state
├── Undo/Redo history
├── Catalog search + filters
├── Pinned card details
├── Main Deck grid
├── Extra Deck grid
├── Side Deck grid
├── Validation summary/issues
├── YDK import/export
└── Back to Deck Library

VN integration boundary
└── resolveDeck(deckId) → ready | missing | invalid
```

Prototype remains isolated from current direct-to-duel entry. No current duel startup changes.

## 6. Screen coverage

### A. Deck Library

Must show:

- `Create deck` primary action;
- `Import YDK` action;
- library search by deck name;
- sort by name or last modified;
- deck entries containing:
  - name;
  - Main/Extra/Side counts;
  - validity state;
  - updated timestamp;
  - Open;
  - Rename;
  - Duplicate;
  - Export;
  - Delete;
- empty state with Create plus Import;
- loading state;
- load failure plus Retry.

No selected-deck marker/action.

Representative fixtures:

1. valid deck;
2. incomplete invalid draft;
3. imported deck with missing card;
4. empty library.

### B. Create Blank Deck

Must cover:

- deck name;
- blank creation only;
- Cancel;
- empty-name validation;
- duplicate-name warning;
- keyboard submit;
- initial focus;
- creation autosave;
- new deck becomes last-opened;
- editor opens with empty 40-slot Main grid.

### C. Deck Editor

Fixed desktop topology:

```text
┌──────────────────────────────────────────────────────────────────────────┐
│ Library | Deck name | Save state | Main/Extra/Side | Validity | Undo Redo │
├───────────────────────┬────────────────────────────┬─────────────────────┤
│ Catalog               │ Deck workspace             │ Pinned details      │
│ Name filter           │ Main: 10×4 or 12×5         │ Art                 │
│ Family/subtype        │ Extra: 15 slots            │ Name + type         │
│ Attribute/race        │ Side: 15 slots             │ Full effect text    │
│ Art results           │ Validation issues          │ Limit badge         │
└───────────────────────┴────────────────────────────┴─────────────────────┘
```

Must show:

- editable deck name;
- `Saving`, `Saved locally`, `Save failed`;
- Main/Extra/Side counts;
- `Valid`, `Warnings`, `Errors`;
- Undo/Redo depth bounded by retained history;
- YDK Import/Export;
- Back to Deck Library;
- pinned details panel at all supported widths.

No `Use deck`, `Select deck`, compact-list view, manual ordering, mobile collapse.

### D. Catalog

Search/filter coverage is intentionally narrow:

- case-insensitive name filter;
- family: Monster, Spell, Trap;
- subtype from `OcgType` mask, including Normal, Effect, Ritual, Fusion, Synchro, Xyz, Pendulum, Link, Tuner, Quick-Play, Continuous, Equip, Field, Counter;
- Attribute from `OcgAttribute`;
- monster type/race from `OcgRace`;
- active-filter chips;
- Clear all;
- result count.

Explicitly excluded filters:

- effect text;
- card code;
- ATK/DEF range;
- Level/Rank/Link range;
- archetype/set;
- limit status;
- target zone;
- formats/banlists.

States:

- initial results;
- filtered results;
- no results plus Clear filters;
- loading skeleton;
- load error plus Retry.

Result tile:

- card art or deterministic fallback;
- name;
- concise family/subtype;
- quantity-limit badge at top-left;
- current total copy count;
- draggable state;
- disabled drag plus reason when copy limit reached;
- selection updates pinned details.

No Add button, double-click add, destination menu.

### E. Pinned Card Details

Must show:

- image or deterministic fallback;
- full name;
- card code;
- family/subtype line;
- Attribute, race, Level/Rank/Link, ATK/DEF when applicable;
- full description/effect text;
- Pendulum scales/link markers when applicable;
- quantity-limit badge plus accessible label;
- current copies split across Main/Extra/Side;
- canonical target;
- missing catalog/text/image state.

Panel remains pinned. Catalog/deck tile selection replaces panel content.

### F. Deck Workspace

Main:

- 0–40 cards → exactly 40 slots, 10 columns × 4 rows;
- 41–60 cards → exactly 60 smaller slots, 12 columns × 5 rows;
- transition at card 41 updates tile dimensions without losing focus/drag state;
- empty slots remain visually distinct from cards;
- repeated copies render as repeated tiles;
- no quantity stacking;
- no manual order handles.

Extra:

- exactly 15 visible slots;
- canonical Extra cards only unless invalid import fixture;
- overflow remains represented through validation fixture, never clipped.

Side:

- exactly 15 visible slots;
- accepts cards dragged from Main/Extra;
- returning card goes to canonical Main/Extra zone;
- overflow remains represented through validation fixture, never clipped.

Auto-pack order:

- system-owned, deterministic;
- Main groups Monster → Spell → Trap, then name/code;
- Extra groups Fusion → Synchro → Xyz → Link, then name/code;
- Side uses canonical class, then name/code;
- user cannot reorder.

Workspace drag operations:

- Catalog → canonical Main/Extra;
- Main/Extra → Side;
- Side → canonical Main/Extra;
- any deck tile → visible Remove drop target;
- invalid placeholder → Remove only.

Every successful drop creates one card-history update, autosave, validation run.

### G. Keyboard drag equivalent

Pointer model remains drag/drop. Accessibility requires same conceptual operation without pointer:

1. focus card tile;
2. press Space/Enter to pick up;
3. move focus among legal drop targets;
4. press Space/Enter to drop;
5. press Escape to cancel.

Announcements must state picked card, legal target, successful drop, cancelled drop, blocked reason.

No separate visible Add button required.

### H. Validation

Runs after every accepted card mutation, import, Undo, Redo, catalog revision change.

Errors:

- Main below 40;
- Main above 60;
- Extra above 15;
- Side above 15;
- total copies above pinned quantity limit;
- forbidden card;
- Extra card in Main;
- Main card in Extra;
- missing card code;
- stale card unavailable in pinned catalog;
- unsupported token/illegal card where ruleset rejects it.

Warnings:

- empty Extra;
- empty Side;
- imported deck not yet reviewed;
- card image unavailable;
- pinned ruleset revision changed.

Behavior:

- header counts/status update immediately;
- issue list appears only when non-empty;
- issue focuses affected card/zone where possible;
- error placeholder preserves missing card code;
- invalid draft still autosaves/imports/exports;
- `resolveDeck` returns `invalid` until errors clear;
- no silent fix, removal, relocation, truncation.

### I. Quantity-limit badge

Every catalog/deck card tile has top-left badge:

- `0` Forbidden;
- `1` Limited;
- `2` Semi-Limited;
- `3` Unlimited/current max.

Badge needs distinct icon/shape plus number. Color may reinforce, never carry meaning alone. Accessible name includes status plus allowed quantity.

Prototype uses one pinned fixture ruleset. No selector.

### J. Missing-card placeholder

Imported/stale unknown card remains one tile per copy:

- error treatment;
- card code;
- `Missing from catalog` label;
- zone retained;
- Remove drag/keyboard operation;
- validation issue link;
- no invented name/art/type;
- no silent canonical-zone move.

### K. YDK Import

Must cover:

- paste text;
- choose `.ydk` file;
- file name;
- parse preview with Main/Extra/Side counts;
- imported deck name;
- malformed line with exact line number;
- unknown card-code list;
- illegal placement retained as validation error;
- duplicate-name warning;
- successful import as editable invalid/valid draft;
- existing editor import replaces card content only after explicit confirmation;
- whole import creates one card-history update;
- Cancel causes no mutation.

No silent repair.

### L. YDK Export

Must cover:

- current counts plus validity;
- invalid draft warning;
- download `.ydk`;
- copy YDK text;
- filename preview;
- success feedback;
- download/copy failure.

Invalid export allowed.

### M. Rename, Duplicate, Delete

Rename:

- name-only autosave;
- empty-name block;
- duplicate-name warning;
- does not consume 50-entry card history.

Duplicate:

- independent deck ID/revision/history;
- generated `Copy` name;
- duplicate becomes last-opened, opens editor;
- copied card state begins one fresh baseline, no inherited Undo stack.

Delete:

- named confirmation;
- Cancel;
- delete failure;
- deleting last-opened clears pointer, returns Library;
- no VN selection consequence because VN owns selected deck ID;
- later VN resolution of deleted ID returns `missing`.

## 7. OcgCore-based data contract

Prototype must not invent duplicate raw card semantics.

Canonical card data uses vendored types:

```ts
import type {
  OcgAttribute,
  OcgCardData,
  OcgRace,
  OcgScope,
  OcgType,
} from "../../vendor/ocgcore-wasm/0.1.2/dist/index.js";

type DeckCatalogText = Readonly<{
  code: number;
  name: string;
  description: string;
  strings: readonly string[];
}>;

type DeckCatalogRecord = Readonly<{
  card: Readonly<OcgCardData>;
  text: DeckCatalogText;
  scope: OcgScope | (number & {});
  imageUrl: string | null;
}>;
```

Generated asset adapter maps existing fields without loss:

- `linkMarker` → `OcgCardData.link_marker`;
- string `race` → `OcgCardData.race` bigint;
- `ot` → `OcgScope`;
- text shard → `DeckCatalogText`;
- image manifest/cache → `imageUrl` or null.

UI mapper derives display-only view:

```ts
type DeckBuilderCardView = Readonly<{
  code: number;
  name: string;
  description: string;
  family: "monster" | "spell" | "trap";
  subtypes: readonly string[];
  attribute: string | null;
  race: string | null;
  levelRankLink: number | null;
  attack: number | null;
  defense: number | null;
  pendulumScales: readonly [number, number] | null;
  linkMarkers: readonly string[];
  canonicalZone: "main" | "extra";
  imageUrl: string | null;
}>;
```

Ruleset data remains separate from `OcgCardData`:

```ts
type PinnedDeckRuleset = Readonly<{
  id: string;
  revision: string;
  quantityByCode: ReadonlyMap<number, 0 | 1 | 2 | 3>;
}>;
```

Constraints:

- use `OcgType` bitmask semantics for family, subtype, canonical zone;
- use `OcgAttribute` for Attribute labels;
- use `OcgRace` bigint semantics for monster type labels;
- use `OcgScope` only as source scope metadata, not quantity limit;
- keep raw card record immutable;
- adapters/mappers may enrich presentation;
- no deck UI import from Worker internals;
- production client must not runtime-import core/WASM initializer solely for constants;
- type-only vendor imports plus parity-tested local masks are allowed.

## 8. Deck persistence contract

Prototype uses isolated IndexedDB namespace, never current snapshot stores.

```ts
type DeckCardUpdate = Readonly<{
  id: string;
  deckId: DeckId;
  sequence: number;
  createdAt: string;
  before: Readonly<Pick<DeckRecord, "main" | "extra" | "side">>;
  after: Readonly<Pick<DeckRecord, "main" | "extra" | "side">>;
  reason: "add" | "remove" | "move" | "import";
}>;

type DeckHistory = Readonly<{
  undo: readonly DeckCardUpdate[];
  redo: readonly DeckCardUpdate[];
}>;
```

Repository expectations:

- list/create/load/save/delete;
- optimistic revision check;
- atomic deck + bounded history write;
- last-opened deck ID read/write/clear;
- independent per-deck history;
- exact-key validation;
- no current duel snapshot-store mutation.

## 9. Required UI states

Fixture switcher or deterministic action must expose:

| Area | States |
|---|---|
| Entry | last-opened ready, no last-opened, stale/deleted last-opened |
| Library | loading, populated, empty, load error |
| Editor | empty, 40 cards, 41 cards, 60 cards, invalid overflow |
| Save | saving, saved, failed, retrying, revision conflict |
| History | empty, partial, 50 retained, Undo, Redo, branched edit |
| Catalog | loading, results, filtered, no results, load error |
| Details | no selection, selected, long text, missing art/text/card |
| Drag | idle, picked up, valid target, invalid target, dropped, cancelled |
| Validation | valid, warnings, errors, stale ruleset |
| Import | idle, preview, malformed, unknown cards, success |
| Export | ready, invalid warning, success, failure |
| Delete | confirm, pending, success, failure |
| Resolver | ready, missing, invalid |

Loading states preserve panel dimensions. No spinner-only blank workspace.

## 10. Desktop support

Supported prototype viewport: 1280–1920 px.

Required:

- full three-region workspace;
- pinned details;
- 10 × 4 plus 12 × 5 Main grid modes;
- no horizontal page overflow at 1280 px;
- browser zoom remains readable at 200% with desktop viewport adjustment;
- dialogs remain usable within viewport.

Below 1024 px:

- show clear desktop-required notice;
- preserve access back to Library/export where practical;
- no mobile/tablet redesign;
- no mobile acceptance testing.

## 11. Accessibility coverage

- semantic regions: Catalog, Main, Extra, Side, Details, Validation;
- labels for name/filter inputs;
- top-left badges receive accessible quantity status;
- card selection, drag pickup, target, drop, cancel announced;
- keyboard drag equivalent for every pointer drag;
- no color-only state;
- validation issue associated with card/zone;
- visible focus;
- focus restored after dialogs;
- full effect text readable at zoom;
- reduced-motion behavior;
- WCAG AA contrast target;
- deterministic DOM order independent from visual auto-pack animation.

## 12. Visual direction

Scene: player sits at desktop in low evening light, compares many card images quickly, expects quiet focus plus immediate rule feedback.

Direction:

- existing dark navy theme;
- Restrained color strategy;
- teal primary accent;
- amber warning;
- rose danger;
- one familiar sans family;
- card art carries most color;
- state color carries meaning only;
- 150–250 ms state transitions;
- no decorative load motion;
- no nested-card maze, glassmorphism, gradient text, ornamental rarity effects.

Reference roles:

- EDOPro: deck zones, vocabulary, dense expectations;
- Moxfield/Archidekt: lookup, inspection, validation readability;
- Linear/Raycast: keyboard speed, restrained chrome, state feedback.

References guide behavior only. No brand/layout cloning.

## 13. Prototype boundaries

Allowed:

- isolated deck-builder route/mode;
- Svelte components;
- prototype-only IndexedDB database;
- `fake-indexeddb` tests;
- actual generated catalog/text adapters;
- safe representative current card art or placeholders;
- simulated failures;
- fixture switcher behind prototype-only control;
- production-shaped deck contracts where approved.

Forbidden:

- arbitrary deck dispatch to Duel Worker;
- current preset duel edits;
- current snapshot IndexedDB store changes;
- VN UI implementation;
- fake production legality claims;
- silent import repair;
- network dependency;
- public redistribution of unapproved art;
- collection/reward/shop/pack ownership systems;
- treating prototype UI as final production UI.

## 14. Out of scope

- mobile/tablet UX;
- template decks;
- deck selection inside module;
- duel start/simulation;
- strategic recommendations;
- AI deck generation;
- opening-hand simulator;
- combo testing;
- side-deck match flow;
- accounts/cloud sync;
- sharing URLs;
- collection ownership;
- reward unlocks;
- shops/packs/economy;
- advanced analytics;
- format/banlist selector;
- effect-text/card-code/stat/archetype filters;
- manual card ordering;
- compact list view;
- localization impl;
- final production migration;
- full-catalog virtualization tuning.

## 15. Review scenarios

Reviewer should complete without guidance:

1. Open route with saved last-opened deck → editor opens directly.
2. Clear last-opened pointer → Library opens.
3. Create blank `Prototype Control` deck.
4. Filter Monster + DARK + Dragon.
5. Inspect long effect text in pinned details.
6. Drag three Main cards from catalog to Main.
7. Drag Extra card from catalog to Extra.
8. Drag Main/Extra card to Side, then return to canonical zone.
9. Remove tile through Remove drop target.
10. Undo/Redo card update.
11. Create 51 updates → only latest 50 retained.
12. Reload → deck plus retained history restored.
13. Observe 40-slot 10 × 4 grid.
14. Add card 41 → grid becomes 60-slot 12 × 5.
15. Fill 60 → all tiles visible.
16. Diagnose under-40 Main error after each edit.
17. Observe 0/1/2/3 top-left quantity badges.
18. Import valid YDK.
19. Import malformed YDK → exact bad line.
20. Import unknown code → persistent error placeholder.
21. Export invalid draft despite warning.
22. Duplicate, rename, delete copy.
23. Recover simulated autosave failure.
24. Resolve simulated revision conflict.
25. Call resolver with valid, invalid, missing IDs.
26. Complete drag flows keyboard-only.

## 16. Acceptance criteria

Prototype is review-ready when:

- every screen/state in sections 6 and 9 is reachable;
- scenarios in section 15 pass;
- last-opened deck opens by default;
- blank-first creation works;
- every mutation autosaves;
- exactly 50 card updates retained per deck;
- invalid drafts survive reload;
- VN resolver returns ready/missing/invalid by deck ID;
- no deck selection UI exists;
- Side Deck editing works;
- desktop topology remains Catalog / Deck / Details;
- card-art grid is only deck view;
- Main switches 10 × 4 → 12 × 5 after card 40;
- repeated copies remain repeated tiles;
- no manual ordering exists;
- only approved filters exist;
- full effect text stays in pinned details;
- validation recomputes after every edit;
- quantity badges appear top-left with non-color semantics;
- unknown cards remain removable error placeholders;
- one pinned ruleset exists without selector;
- OCG data mapping tests prove bitmask/type correctness;
- drag/drop has keyboard parity;
- no mobile layout work lands;
- no current duel behavior changes.

## 17. Source references

- `docs/card-game-vn-handoff/01-product-scope.md`
- `docs/card-game-vn-handoff/03-modules-and-contracts.md`
- `docs/card-game-vn-handoff/07-technical-decisions.md`
- `docs/card-game-vn-handoff/08-phased-implementation-plan.md`
- `src/duel/presets/deck-parser.ts`
- `src/worker/engine/OcgCoreAdapter.ts`
- `src/worker/assets/active-duel-dependencies.ts`
- `vendor/ocgcore-wasm/0.1.2/dist/index.d.ts`
- `src/styles/app.css`
