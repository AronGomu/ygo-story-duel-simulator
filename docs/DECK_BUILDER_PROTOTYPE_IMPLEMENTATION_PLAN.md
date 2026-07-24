# Deck Builder Prototype — TDD Implementation Plan

> Status: implemented; deck-builder gates verified; aggregate gate caveat recorded below  
> Scope authority: `docs/DECK_BUILDER_PROTOTYPE_SCOPE.md`  
> Delivery model: green, independently committable sections  
> Final output: isolated desktop deck-builder prototype plus tested deck-module boundary

## Implementation record

- Prototype route: `#/prototype/deck-builder`
- Persistence: IndexedDB `ygo-story-duel-deck-builder-prototype`, schema version 1
- Isolation: default direct-duel entry unchanged and dynamically split
- Verification: focused deck-builder Vitest suite, Chromium acceptance suite, direct-duel regression, lint, typecheck, build, reproducible build
- Aggregate gate: final `npm run check` passes with deck-builder, VN prototype, and direct-duel suites together
- Git status: implementation complete; handoff commit/push requested after validation

## 1. Success contract

Implementation is complete when:

- last-opened deck route works;
- blank-first CRUD works;
- invalid drafts autosave;
- each deck retains latest 50 card-content updates;
- OCG data adapters drive card semantics;
- card-art grid supports Main/Extra/Side drag flows;
- Main grid switches 10 × 4 → 12 × 5 after card 40;
- validation runs after every edit;
- quantity badges, error placeholders, pinned details work;
- VN-facing `resolveDeck(deckId)` returns ready/missing/invalid;
- mobile UI is absent;
- current duel flow remains unchanged;
- full project gate passes.

## 2. Non-negotiable TDD loop

Every committable section follows same sequence:

- [x] Write focused test for next behavior.
- [x] Run focused test → confirm expected failure.
- [x] Record failure reason in working notes; test must fail for missing behavior, not broken setup.
- [x] Implement minimum code needed.
- [x] Run focused test → green.
- [x] Refactor only changed code while tests stay green.
- [x] Run section validation gate.
- [x] Review diff → every changed line maps to section.
- [x] Commit only after all section checkboxes pass.

No production behavior code before red test. No section commit with skipped/focused tests, type errors, lint errors, format drift.

## 3. Proposed file boundaries

Exact names may shift if existing convention demands. Responsibilities must stay separate.

```text
src/
├── decks/
│   ├── index.ts                         # VN/public deck-module API only
│   ├── deck-contracts.ts                # Deck IDs, records, validation/results
│   ├── deck-model.ts                    # Pure card mutations + deterministic packing
│   ├── deck-history.ts                  # 50-update Undo/Redo state
│   ├── deck-validation.ts               # Pinned-rule validation
│   ├── deck-resolver.ts                 # deck ID → ready/missing/invalid
│   ├── deck-repository.ts               # Port/interface
│   ├── indexeddb-deck-repository.ts     # Prototype-isolated IndexedDB impl
│   ├── ydk-adapter.ts                    # Import/export
│   └── catalog/
│       ├── ocg-card-mapper.ts            # OcgCardData → UI view
│       ├── ocg-mask.ts                   # Client-safe mask constants
│       ├── deck-catalog.ts               # Search/filter source
│       └── pinned-ruleset.ts             # One quantity map, no selector
├── prototypes/deck-builder/
│   ├── DeckBuilderPrototype.svelte       # Composition only
│   ├── deck-builder-store.ts             # UI orchestration/autosave
│   ├── prototype-entry.ts                # Last-opened routing
│   ├── fixtures/
│   │   ├── catalog.ts                    # OCG-shaped review fixture
│   │   └── states.ts                     # Deterministic failure/edge states
│   └── components/
│       ├── DeckLibrary.svelte
│       ├── DeckEditor.svelte
│       ├── CardCatalog.svelte
│       ├── CardDetails.svelte
│       ├── DeckWorkspace.svelte
│       ├── DeckZoneGrid.svelte
│       ├── ValidationIssues.svelte
│       ├── YdkImport.svelte
│       └── YdkExport.svelte
└── main.ts                               # Hash-route switch; default duel unchanged

tests/
├── unit/decks/
├── component/deck-builder/
└── fixtures/decks/

e2e/
└── deck-builder-prototype.spec.ts
```

Avoid catch-all utils/types files. Keep prototype state fixtures outside production deck domain.

## 4. App isolation decision

Prototype URL:

```text
#/prototype/deck-builder
```

Default URL still mounts current duel app. Hash route avoids static-host rewrite requirements, preserves non-root Vite base.

Prototype dynamic import prevents initial execution on duel route. Build may still contain prototype chunk; private build policy remains unchanged.

---

# Section 0 — Baseline capture

**Commit:** none. Baseline evidence only.

## Red/green setup

- [x] Record `git status --short`; identify pre-existing changes.
- [x] Run `npm run format:check`.
- [x] Run `npm run lint`.
- [x] Run `npm run typecheck`.
- [x] Run `npm test`.
- [x] Run `npm run build`.
- [x] Record existing test counts, build result, snapshot ID.
- [x] Stop if baseline red; do not mix baseline repair with prototype work.

## Validation

- [x] Existing direct duel opens.
- [x] Existing Chromium smoke passes.
- [x] No source file changed during baseline.

**Section valid when:** every baseline gate green or pre-existing failure explicitly isolated before feature branch work.

---

# Section 1 — Isolated route plus empty prototype shell

**Commit:** `feat: add isolated deck builder prototype route`

## Test first

- [x] Add unit test for route classifier:
  - default/unknown hash → duel;
  - `#/prototype/deck-builder` → prototype.
- [x] Add component smoke test for empty prototype shell heading.
- [x] Add regression assertion: default route still mounts current app contract.
- [x] Run tests → confirm red from missing route/shell.

## Implement

- [x] Extract pure `selectAppEntry(hash)` fn.
- [x] Add dynamic prototype import in `src/main.ts`.
- [x] Add minimal `DeckBuilderPrototype.svelte` shell.
- [x] Set prototype document title.
- [x] Keep default `App.svelte` path behavior unchanged.
- [x] Add no deck logic yet.

## Gate

- [x] `npx vitest run tests/unit/app-entry-route.test.ts`
- [x] `npx vitest run tests/component/deck-builder/prototype-shell.test.ts`
- [x] `npm run typecheck`
- [x] `npm run lint`
- [x] `npm run format:check`
- [x] `npm run build`
- [x] Manually open default route → direct duel unchanged.
- [x] Manually open prototype hash → empty prototype shell.

**Section valid when:** both routes build, default duel regression stays green.

---

# Section 2 — OCG card contract, mapper, review fixture

**Commit:** `feat: map ocg card data for deck builder`

## Test first

- [x] Add mapper tests using `OcgCardData`-shaped records.
- [x] Cover Monster/Spell/Trap family masks.
- [x] Cover Fusion/Synchro/Xyz/Link → Extra.
- [x] Cover Ritual/Pendulum/Tuner/Normal/Effect → Main unless Extra bit exists.
- [x] Cover Quick-Play/Continuous/Equip/Field/Counter subtype labels.
- [x] Cover `OcgAttribute` label mapping.
- [x] Cover `OcgRace` bigint label mapping.
- [x] Cover Level/Rank/Link interpretation.
- [x] Cover Pendulum scales, Link markers, unknown future mask preservation.
- [x] Add Node-only parity test: local client-safe masks equal vendored runtime exports.
- [x] Add fixture integrity test: 24–40 records, unique codes, text per card, major families represented.
- [x] Run tests → confirm red.

## Implement

- [x] Type-import `OcgCardData`, `OcgType`, `OcgAttribute`, `OcgRace`, `OcgScope` from vendored package.
- [x] Add client-safe mask constants without runtime core import.
- [x] Add asset-record adapter:
  - `linkMarker` → `link_marker`;
  - race string → bigint;
  - `ot` → scope;
  - text/image joins.
- [x] Add immutable `DeckBuilderCardView` mapper.
- [x] Add representative OCG-shaped fixture, preferably extracted from current generated snapshot.
- [x] Use placeholders for unapproved/missing art.
- [x] Keep ruleset quantity separate from OCG scope.
- [x] Export only deck-domain/public card types needed by prototype.

## Gate

- [x] `npx vitest run tests/unit/decks/ocg-card-mapper.test.ts`
- [x] `npx vitest run tests/unit/decks/ocg-mask-parity.test.ts`
- [x] `npx vitest run tests/unit/decks/prototype-catalog-fixture.test.ts`
- [x] `npm run typecheck`
- [x] `npm run lint`
- [x] `npm run format:check`
- [x] Inspect built client graph → no WASM/core initializer pulled solely by card mapper.

**Section valid when:** OCG semantics map correctly, fixture coverage green, client boundary clean.

---

# Section 3 — Pure deck model plus deterministic grid packing

**Commit:** `feat: add pure deck editing model`

## Test first

- [x] Add tests for blank deck.
- [x] Add Catalog → canonical Main add.
- [x] Add Catalog → canonical Extra add.
- [x] Add Main/Extra → Side move.
- [x] Add Side → canonical zone move.
- [x] Add Remove operation.
- [x] Prove one mutation changes one repeated tile only.
- [x] Prove duplicate copies remain repeated card codes.
- [x] Prove no manual reorder command exists.
- [x] Prove deterministic auto-pack:
  - Main Monster → Spell → Trap, name/code;
  - Extra Fusion → Synchro → Xyz → Link, name/code;
  - Side canonical class, name/code.
- [x] Prove grid plan:
  - 0–40 → 40 slots, 10 × 4;
  - 41–60 → 60 slots, 12 × 5;
  - overflow cards remain represented for error fixture.
- [x] Prove unknown card placeholder preserves code/zone.
- [x] Run tests → confirm red.

## Implement

- [x] Define immutable deck draft/card-zone contracts.
- [x] Implement pure add/remove/move commands.
- [x] Derive canonical zone from mapper output.
- [x] Implement deterministic pack comparator.
- [x] Implement grid-plan fn independent from Svelte.
- [x] Preserve invalid imported placements until explicit user action.
- [x] Return typed mutation rejection for invalid drag target/copy cap—not thrown UI errors.

## Gate

- [x] `npx vitest run tests/unit/decks/deck-model.test.ts`
- [x] `npx vitest run tests/unit/decks/deck-grid-plan.test.ts`
- [x] `npm run typecheck`
- [x] `npm run lint`
- [x] `npm run format:check`

**Section valid when:** pure model covers every accepted card mutation, deterministic packing stays green.

---

# Section 4 — Pinned ruleset, edit-time validation, VN resolver

**Commit:** `feat: validate and resolve local decks`

## Test first

- [x] Add validation tests for:
  - Main below 40;
  - Main above 60;
  - Extra above 15;
  - Side above 15;
  - copy limit 0/1/2/3;
  - Extra card in Main;
  - Main card in Extra;
  - missing/stale code;
  - unsupported illegal/token card;
  - empty Extra/Side warnings;
  - missing art warning;
  - stale ruleset warning.
- [x] Assert every accepted edit returns recomputed validation summary.
- [x] Assert errors/warnings use stable IDs plus zone/card refs.
- [x] Add resolver tests:
  - valid ID → `ready` + immutable `ValidatedDeckSnapshot`;
  - invalid ID → `invalid` + issues;
  - absent/deleted ID → `missing`.
- [x] Assert resolver accepts deck ID only; no selected-deck state.
- [x] Run tests → confirm red.

## Implement

- [x] Define one pinned `PinnedDeckRuleset` fixture.
- [x] Implement pure `validateDeckDraft`.
- [x] Recompute validation inside card-mutation transaction result.
- [x] Keep invalid drafts representable.
- [x] Define `DeckReader` port for resolver.
- [x] Implement `resolveDeck(deckId)` over reader + catalog + ruleset.
- [x] Export resolver contract from `src/decks/index.ts`.
- [x] Do not integrate VN or Worker.

## Gate

- [x] `npx vitest run tests/unit/decks/deck-validation.test.ts`
- [x] `npx vitest run tests/unit/decks/deck-resolver.test.ts`
- [x] `npm run typecheck`
- [x] `npm run lint`
- [x] `npm run format:check`

**Section valid when:** validation updates per edit, resolver contract matches ready/missing/invalid.

---

# Section 5 — Bounded 50-update history

**Commit:** `feat: retain bounded deck edit history`

## Test first

- [x] Add test: card add creates one update.
- [x] Add test: card remove creates one update.
- [x] Add test: zone move creates one update.
- [x] Add test: bulk import creates one update.
- [x] Add test: rename creates no card update.
- [x] Add test: Undo restores before snapshot.
- [x] Add test: Redo restores after snapshot.
- [x] Add test: new edit after Undo clears Redo.
- [x] Add test: update 51 evicts update 1.
- [x] Add test: histories remain independent per deck.
- [x] Add test: rejected/no-op drag creates no update.
- [x] Run tests → confirm red.

## Implement

- [x] Define immutable `DeckCardUpdate`, `DeckHistory`.
- [x] Implement push/undo/redo pure fns.
- [x] Enforce exact max 50.
- [x] Keep sequence monotonic despite eviction.
- [x] Treat one accepted drag/import transaction as one history update.
- [x] Keep validation snapshots derived, not duplicated inside history.

## Gate

- [x] `npx vitest run tests/unit/decks/deck-history.test.ts`
- [x] `npm run typecheck`
- [x] `npm run lint`
- [x] `npm run format:check`

**Section valid when:** update 51 eviction, Undo/Redo branching, per-deck isolation proven.

---

# Section 6 — Prototype-isolated IndexedDB repo plus autosave transaction

**Commit:** `feat: persist prototype decks and history`

## Test first

Use `fake-indexeddb`.

- [x] Add create/list/load tests.
- [x] Add name-only save test.
- [x] Add atomic deck + history save test.
- [x] Add invalid-draft persistence test.
- [x] Add reload restoration test for latest 50 history entries.
- [x] Add optimistic revision-conflict test.
- [x] Add delete test.
- [x] Add last-opened read/write/clear test.
- [x] Add stale last-opened fallback test.
- [x] Add transaction failure test → old deck/history remain intact.
- [x] Assert DB name/stores do not overlap current snapshot DB.
- [x] Run tests → confirm red.

## Implement

- [x] Define `DeckRepository` port.
- [x] Create dedicated prototype DB name/version.
- [x] Store deck + bounded history atomically.
- [x] Implement optimistic expected revision.
- [x] Store last-opened ID separately.
- [x] Clear stale pointer after missing deck detection.
- [x] Preserve exact deck ID/revision semantics.
- [x] Add structured errors: unavailable, conflict, transaction failure.
- [x] Wire resolver tests against real repo adapter.

## Gate

- [x] `npx vitest run tests/unit/decks/indexeddb-deck-repository.test.ts`
- [x] `npx vitest run tests/unit/decks/deck-resolver-integration.test.ts`
- [x] `npm run typecheck`
- [x] `npm run lint`
- [x] `npm run format:check`

**Section valid when:** reload, atomicity, conflict, last-opened behavior green under fake IndexedDB.

---

# Section 7 — YDK domain adapter

**Commit:** `feat: add ydk deck import and export`

## Test first

- [x] Port/extend current parser fixtures for comments, CRLF, sections, duplicates.
- [x] Add malformed line test with exact line number.
- [x] Add unknown card-code preservation test.
- [x] Add illegal placement preservation test.
- [x] Add Main/Extra/Side round-trip test.
- [x] Add invalid draft export test.
- [x] Add deterministic filename sanitizer test.
- [x] Add bulk import → one history update integration test.
- [x] Assert no silent repair/reordering/truncation.
- [x] Run tests → confirm red.

## Implement

- [x] Create deck-domain `YdkAdapter`; reuse/extend parser logic, avoid copy-paste.
- [x] Return typed parse result with line errors/warnings.
- [x] Preserve unknown codes in draft.
- [x] Preserve section placement.
- [x] Export invalid drafts.
- [x] Normalize only YDK syntax/line endings.
- [x] Keep current preset parser behavior unchanged.

## Gate

- [x] `npx vitest run tests/unit/decks/ydk-adapter.test.ts`
- [x] `npx vitest run tests/unit/decks/ydk-history.test.ts`
- [x] `npx vitest run tests/unit/deck-parser.test.ts`
- [x] `npm run typecheck`
- [x] `npm run lint`
- [x] `npm run format:check`

**Section valid when:** valid/invalid YDK paths round-trip, current preset parser regression green.

---

# Section 8 — Editor shell, fixed desktop topology, pinned details

**Commit:** `feat: build deck editor workspace shell`

## Test first

- [x] Add component test for Catalog / Deck / Details landmark order.
- [x] Add test for pinned details presence at 1280-supported state.
- [x] Add header counts/status/save state rendering.
- [x] Add test proving no Select/Use Deck action exists.
- [x] Add test proving no compact-list toggle exists.
- [x] Add desktop-required notice test below 1024 mode.
- [x] Run tests → confirm red.

## Implement

- [x] Build composition-only `DeckEditor.svelte`.
- [x] Build three-region desktop layout.
- [x] Add deck-name input.
- [x] Add separate save plus validity status.
- [x] Add Main/Extra/Side counts.
- [x] Add Undo/Redo controls disabled until history exists.
- [x] Add Import/Export triggers.
- [x] Add Library navigation.
- [x] Add pinned empty Card Details state.
- [x] Add desktop-required guard; no mobile redesign.
- [x] Match existing dark theme tokens where usable.

## Gate

- [x] `npx vitest run tests/component/deck-builder/deck-editor-shell.test.ts`
- [x] `npm run typecheck`
- [x] `npm run lint`
- [x] `npm run format:check`
- [x] `npm run build`

**Section valid when:** fixed topology renders, excluded UI absent, build green.

---

# Section 9 — Catalog filters plus pinned card details

**Commit:** `feat: add deck builder card catalog`

## Test first

- [x] Add name-filter test.
- [x] Add family-filter test.
- [x] Add subtype-filter test.
- [x] Add Attribute-filter test.
- [x] Add race-filter test.
- [x] Add combined-filter intersection test.
- [x] Add Clear all test.
- [x] Add no-results recovery test.
- [x] Assert no excluded filters render.
- [x] Add tile selection → pinned details update test.
- [x] Add long effect text only in details test.
- [x] Add missing art/text fallback test.
- [x] Run tests → confirm red.

## Implement

- [x] Build pure catalog query fn.
- [x] Build `CardCatalog.svelte` using approved filters only.
- [x] Render art tiles, concise labels, current count.
- [x] Build `CardDetails.svelte` with full OCG-derived metadata.
- [x] Keep details pinned.
- [x] Add loading/no-results/error states.
- [x] Add filter chips plus Clear all.
- [x] Do not add Add button/double-click behavior.

## Gate

- [x] `npx vitest run tests/unit/decks/deck-catalog.test.ts`
- [x] `npx vitest run tests/component/deck-builder/card-catalog.test.ts`
- [x] `npx vitest run tests/component/deck-builder/card-details.test.ts`
- [x] `npm run typecheck`
- [x] `npm run lint`
- [x] `npm run format:check`

**Section valid when:** approved filters work, details own long text, excluded filters absent.

---

# Section 10 — Card-art grids plus pointer drag/drop

**Commit:** `feat: add deck grid drag and drop editing`

## Test first

- [x] Add component test: blank Main renders 40 slots, 10 × 4 metadata/class.
- [x] Add test: card 40 keeps 40-slot mode.
- [x] Add test: card 41 switches to 60 slots, 12 × 5.
- [x] Add test: card 60 visible.
- [x] Add Extra/Side 15-slot tests.
- [x] Add repeated copies repeated-tile test.
- [x] Add Catalog → Main drag test.
- [x] Add Catalog → Extra drag test.
- [x] Add Main/Extra → Side drag test.
- [x] Add Side → canonical zone drag test.
- [x] Add tile → Remove target test.
- [x] Add invalid target/rejected drop test.
- [x] Add focus retention test across 40→41 layout transition.
- [x] Assert no reorder path/handle exists.
- [x] Run tests → confirm red.

## Implement

- [x] Build `DeckZoneGrid.svelte` from pure grid plan.
- [x] Render explicit empty slots.
- [x] Render one tile per copy.
- [x] Add pointer drag state owned by editor/store.
- [x] Expose only legal targets.
- [x] Add visible Remove target during deck-tile drag.
- [x] Dispatch one pure mutation per successful drop.
- [x] Cancel rejected/outside drop without history/save mutation.
- [x] Avoid layout-property animation during 40→41 switch.

## Gate

- [x] `npx vitest run tests/component/deck-builder/deck-zone-grid.test.ts`
- [x] `npx vitest run tests/component/deck-builder/pointer-drag.test.ts`
- [x] `npm run typecheck`
- [x] `npm run lint`
- [x] `npm run format:check`

**Section valid when:** all pointer drag paths mutate one card, grids match exact geometry.

---

# Section 11 — Keyboard drag parity plus focus semantics

**Commit:** `feat: make deck drag editing keyboard accessible`

## Test first

- [x] Add keyboard pickup test with Space/Enter.
- [x] Add legal-target navigation test.
- [x] Add keyboard drop test.
- [x] Add Escape cancel test.
- [x] Add invalid-target announcement test.
- [x] Add remove-target keyboard test.
- [x] Add focus restoration after drop/cancel.
- [x] Add live-region announcement assertions.
- [x] Add accessible names for every card tile, empty slot, target.
- [x] Add no-color-only quantity/validation state assertion.
- [x] Run tests → confirm red.

## Implement

- [x] Model keyboard pickup/drop as same drag transaction used by pointer.
- [x] Add roving focus only where it reduces tab count without hiding controls.
- [x] Add bounded polite live region.
- [x] Add `aria-grabbed`-equivalent current semantics through labels/state; do not rely on obsolete ARIA alone.
- [x] Add discoverable keyboard hint.
- [x] Keep deterministic DOM order after auto-pack.
- [x] Respect reduced motion.

## Gate

- [x] `npx vitest run tests/component/deck-builder/keyboard-drag.test.ts`
- [x] `npx vitest run tests/component/deck-builder/deck-builder-a11y.test.ts`
- [x] `npm run typecheck`
- [x] `npm run lint`
- [x] `npm run format:check`

**Section valid when:** every pointer drag has keyboard path, focus/announcements proven.

---

# Section 12 — Validation UI, quantity badges, missing-card placeholders

**Commit:** `feat: surface deck validation and card limits`

## Test first

- [x] Add header counts/status update-after-edit test.
- [x] Add valid state test: no expanded issue panel.
- [x] Add warning/error state test: issue panel appears.
- [x] Add issue → affected card/zone focus test.
- [x] Add 0/1/2/3 top-left badge tests.
- [x] Add badge accessible-label test.
- [x] Add copy-limit blocked drag reason test.
- [x] Add one-placeholder-per-missing-copy test.
- [x] Add missing-code Remove-only test.
- [x] Add invalid draft remains editable test.
- [x] Run tests → confirm red.

## Implement

- [x] Build compact always-visible validation summary.
- [x] Build conditional `ValidationIssues.svelte`.
- [x] Add stable issue anchors.
- [x] Add top-left quantity badge with shape/icon/number.
- [x] Add missing-card error tile.
- [x] Disable illegal catalog drag with explicit reason.
- [x] Preserve invalid imported placements.
- [x] Keep autosave state visually separate.

## Gate

- [x] `npx vitest run tests/component/deck-builder/deck-validation-ui.test.ts`
- [x] `npx vitest run tests/component/deck-builder/quantity-badge.test.ts`
- [x] `npx vitest run tests/component/deck-builder/missing-card-placeholder.test.ts`
- [x] `npm run typecheck`
- [x] `npm run lint`
- [x] `npm run format:check`

**Section valid when:** validation is immediate/actionable, badges/placeholders meet accepted UX.

---

# Section 13 — Editor autosave, 50-history Undo/Redo, failure/conflict recovery

**Commit:** `feat: wire deck autosave and edit recovery`

## Test first

- [x] Add edit → Saving → Saved state test.
- [x] Add invalid edit autosaves test.
- [x] Add rapid edits serialized/coalesced without lost mutation test.
- [x] Add exactly-once history transaction per drag test.
- [x] Add Undo autosave test.
- [x] Add Redo autosave test.
- [x] Add reload restores deck/history test.
- [x] Add 50 retained indicator/boundary test.
- [x] Add save failure plus Retry test.
- [x] Add optimistic conflict state test:
  - Reload remote revision;
  - Preserve local as copy.
- [x] Add stale async save result cannot overwrite newer UI state test.
- [x] Run tests → confirm red.

## Implement

- [x] Build store/controller around pure model + repo.
- [x] Serialize writes per deck.
- [x] Use expected revision on every save.
- [x] Keep submit/edit lock only where mutation would conflict; normal rapid drags queue safely.
- [x] Add request generation guard for stale saves.
- [x] Wire Undo/Redo through same autosave path.
- [x] Add Retry.
- [x] Add conflict recovery actions.
- [x] Never roll valid UI state backward from late save completion.

## Gate

- [x] `npx vitest run tests/component/deck-builder/deck-autosave.test.ts`
- [x] `npx vitest run tests/component/deck-builder/deck-history-ui.test.ts`
- [x] `npx vitest run tests/component/deck-builder/deck-save-conflict.test.ts`
- [x] `npm run typecheck`
- [x] `npm run lint`
- [x] `npm run format:check`

**Section valid when:** every mutation persists, last 50 survive reload, failures recover safely.

---

# Section 14 — Deck Library CRUD plus last-opened entry

**Commit:** `feat: add deck library and last opened routing`

## Test first

- [x] Add no last-opened → Library test.
- [x] Add valid last-opened → Editor test.
- [x] Add stale last-opened → pointer clear + Library test.
- [x] Add blank-first Create test.
- [x] Assert no template UI.
- [x] Add name search/sort tests.
- [x] Add Open updates last-opened test.
- [x] Add Rename autosave/no card-history test.
- [x] Add Duplicate independent ID/fresh history/opens editor test.
- [x] Add named Delete confirmation test.
- [x] Add deleting last-opened → Library test.
- [x] Add empty/loading/error/retry state tests.
- [x] Assert no selected-deck marker/action.
- [x] Run tests → confirm red.

## Implement

- [x] Build entry resolver from repo last-opened pointer.
- [x] Build `DeckLibrary.svelte`.
- [x] Build blank creation flow.
- [x] Add name search + name/modified sort.
- [x] Add Open/Rename/Duplicate/Delete.
- [x] Duplicate card state into fresh baseline, no inherited history.
- [x] Add destructive confirmation/focus restoration.
- [x] Keep VN selection absent.

## Gate

- [x] `npx vitest run tests/component/deck-builder/prototype-entry.test.ts`
- [x] `npx vitest run tests/component/deck-builder/deck-library.test.ts`
- [x] `npx vitest run tests/component/deck-builder/deck-crud.test.ts`
- [x] `npm run typecheck`
- [x] `npm run lint`
- [x] `npm run format:check`

**Section valid when:** last-opened-first route plus blank CRUD complete, selection UI absent.

---

# Section 15 — YDK import/export UI

**Commit:** `feat: add deck builder ydk workflows`

## Test first

- [x] Add pasted YDK preview test.
- [x] Add file-input preview test.
- [x] Add exact malformed-line display test.
- [x] Add unknown-code placeholder import test.
- [x] Add duplicate-name warning test.
- [x] Add editor replacement confirmation test.
- [x] Add Cancel no-mutation test.
- [x] Add import creates one history update test.
- [x] Add invalid export warning + continue test.
- [x] Add copy-text success/failure test.
- [x] Add download success/failure test.
- [x] Run tests → confirm red.

## Implement

- [x] Build import surface with paste/file paths.
- [x] Show counts, errors, warnings before commit.
- [x] Preserve invalid codes/placements.
- [x] Require explicit replacement confirmation in editor.
- [x] Build export surface.
- [x] Allow invalid export after warning.
- [x] Add deterministic filename.
- [x] Restore focus after close/success/failure.

## Gate

- [x] `npx vitest run tests/component/deck-builder/ydk-import.test.ts`
- [x] `npx vitest run tests/component/deck-builder/ydk-export.test.ts`
- [x] `npx vitest run tests/unit/decks/ydk-adapter.test.ts`
- [x] `npm run typecheck`
- [x] `npm run lint`
- [x] `npm run format:check`

**Section valid when:** import/export success/failure paths work, invalid data remains honest.

---

# Section 16 — Deterministic state harness plus desktop UX polish

**Commit:** `test: expose deck builder prototype review states`

## Test first

- [x] Add fixture-switcher classification test covering every scope state.
- [x] Add state reset isolation test.
- [x] Add loading skeleton dimension/landmark test.
- [x] Add no horizontal page overflow assertion at 1280 px through browser test helper.
- [x] Add desktop-required notice assertion below 1024 px.
- [x] Add reduced-motion style assertion.
- [x] Add focus trap/restoration tests for confirmations/import/export.
- [x] Run tests → confirm red.

## Implement

- [x] Add prototype-only fixture switcher.
- [x] Expose all states from scope section 9.
- [x] Add deterministic simulated latency/failure controls.
- [x] Add skeletons preserving three-panel layout.
- [x] Tune 1280/1440/1920 desktop spacing.
- [x] Add below-1024 desktop-required notice.
- [x] Remove accidental mobile breakpoints from prototype CSS.
- [x] Ensure card art remains primary color source.
- [x] Keep motion state-only, reduced-motion safe.

## Gate

- [x] `npx vitest run tests/component/deck-builder/prototype-state-harness.test.ts`
- [x] `npx vitest run tests/component/deck-builder/deck-builder-a11y.test.ts`
- [x] `npm run typecheck`
- [x] `npm run lint`
- [x] `npm run format:check`
- [x] `npm run build`

**Section valid when:** every review state deterministic, desktop UX stable, mobile scope absent.

---

# Section 17 — E2E acceptance, regression, docs handoff

**Commit:** `test: verify deck builder prototype flow`

## Test first

- [x] Add Playwright test before final wiring fixes.
- [x] Confirm E2E initially fails at first missing acceptance behavior.

## E2E coverage

- [x] Default route still starts current duel.
- [x] Prototype route opens last-opened deck.
- [x] No last-opened route opens Library.
- [x] Create blank deck.
- [x] Filter Monster + DARK + Dragon.
- [x] Inspect long effect text in pinned details.
- [x] Pointer drag Catalog → Main/Extra.
- [x] Pointer drag Main/Extra ↔ Side.
- [x] Remove tile.
- [x] Undo/Redo.
- [x] Reload → deck/history restored.
- [x] 40-slot grid visible.
- [x] Card 41 switches to 60-slot grid.
- [x] Quantity badges visible/accessibly named.
- [x] Invalid draft autosaves.
- [x] Unknown import code remains placeholder.
- [x] Invalid export allowed after warning.
- [x] Rename/Duplicate/Delete.
- [x] Resolver integration fixture returns ready/invalid/missing.
- [x] Keyboard drag core path.
- [x] Save failure Retry.
- [x] Revision conflict recovery.
- [x] Below-1024 desktop-required notice.
- [x] No mobile layout claim/test.

## Final review gates

- [x] `npm run format`
- [x] `npm run format:check`
- [x] `npm run lint`
- [x] `npm run typecheck`
- [x] `npm test`
- [x] `npm run build`
- [x] `npm run build:reproducible`
- [x] `npx playwright test e2e/deck-builder-prototype.spec.ts --project=chromium`
- [x] `npm run test:e2e`
- [x] `npm run check`
- [x] Run changed-files code review.
- [x] Run changed-files a11y review.
- [x] Run client-bundle review for vendored-core leakage.
- [x] Run concurrency review for autosave/revision races.
- [x] Run contract review for resolver/repository/UI boundaries.
- [x] Run data-integrity review for prototype IndexedDB/history.
- [x] Run test-quality review.
- [x] Fix all critical/high findings; rerun affected gates.

## Docs/handoff

- [x] Update scope status to `prototype implemented; review pending`.
- [x] Record actual route.
- [x] Record prototype DB name/version.
- [x] Record test commands/results.
- [x] Add prototype review notes doc only after reviewer uses prototype.
- [x] Do not mark production deck editor implemented.
- [x] Do not update future architecture to shipped status.

**Section valid when:** full project check green, review scenarios pass, current duel unchanged.

---

## 5. Commit sequence summary

|   # | Commit                                              | Required green proof                  |
| --: | --------------------------------------------------- | ------------------------------------- |
|   1 | `feat: add isolated deck builder prototype route`   | route unit + shell component + build  |
|   2 | `feat: map ocg card data for deck builder`          | OCG mapper/parity/fixture tests       |
|   3 | `feat: add pure deck editing model`                 | model + grid-plan tests               |
|   4 | `feat: validate and resolve local decks`            | validation + resolver tests           |
|   5 | `feat: retain bounded deck edit history`            | 50-entry history tests                |
|   6 | `feat: persist prototype decks and history`         | fake-IDB + resolver integration tests |
|   7 | `feat: add ydk deck import and export`              | YDK + preset-parser regression tests  |
|   8 | `feat: build deck editor workspace shell`           | shell component + build               |
|   9 | `feat: add deck builder card catalog`               | catalog/details tests                 |
|  10 | `feat: add deck grid drag and drop editing`         | grid + pointer drag tests             |
|  11 | `feat: make deck drag editing keyboard accessible`  | keyboard + a11y tests                 |
|  12 | `feat: surface deck validation and card limits`     | validation/badge/placeholder tests    |
|  13 | `feat: wire deck autosave and edit recovery`        | autosave/history/conflict tests       |
|  14 | `feat: add deck library and last opened routing`    | entry/library/CRUD tests              |
|  15 | `feat: add deck builder ydk workflows`              | import/export component tests         |
|  16 | `test: expose deck builder prototype review states` | state harness + a11y + build          |
|  17 | `test: verify deck builder prototype flow`          | E2E + full `npm run check`            |

## 6. Deferred after prototype review

- production DB migration;
- VN screen/selection UI;
- campaign integration;
- arbitrary deck Worker dispatch;
- format/banlist management;
- mobile/tablet UX;
- full catalog packaging/indexing;
- virtualization/perf tuning;
- public distribution review;
- production visual polish.

No deferred item should leak into prototype commits unless review changes scope first.
