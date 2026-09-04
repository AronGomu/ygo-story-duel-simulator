# T6: Simplify editor controls

**Plan:** `./artifacts/PLAN_2026_09_04_feedback_round_2.md`  
**Depends:** none  
**Commit outcome:** Empty Side Deck stops warning, catalog adds to canonical zones without sideboard toggle, Deck Name label disappears, and card-name search owns entry focus.

## Context (self-contained)

- C1. Goal: Remove low-value warnings/controls and make keyboard entry immediate.
- C2. This slice: Feedback Deck Builder items 4, 8, 9, 12.
- C3. Out of scope here: Types replacement, advanced search, viewport geometry, rename-dialog labels, removing Side Deck itself.
- C4. Assumptions in force: Only `empty-side` warning stops emitting; `side-over-maximum` and all Side errors remain. Side remains reachable by drag/drop and deck-card move menu.

## Requirements

- R1. `validateDeckDraft` never emits `empty-side`; empty Extra warning and all legality errors remain.
- R2. Keep legacy `"empty-side"` union member readable to avoid turning persisted old summaries into unsafe casts; no new summary emits it.
- R3. Remove To sideboard checkbox, label, `toSideboard` state, and `CardCatalog` props.
- R4. Catalog click/double-click/tap adds to `card.canonicalZone`; explicit drag/drop or move-menu can still move card to Side.
- R5. Remove visible Deck Name label; input keeps exact accessible name `Deck name` and placeholder `Deck name`.
- R6. On Deck Builder entry, card-name search receives focus. Advanced Search is not yet present and later starts closed.
- R7. No focus steal occurs while rename/import/load/delete dialogs are already open.

## Inputs

- I1. `src/decks/deck-validation.ts`, `src/decks/deck-contracts.ts`.
- I2. `src/deck-editor/components/DeckEditor.svelte`, `CardCatalog.svelte`, `DeckWorkspace.svelte`.
- I3. `src/deck-editor/layout/click-intent.ts`.
- I4. Tests: deck validation unit/UI, editor a11y, click move, portrait layout.
- I5. **From Depends:** none.

## Interface contract (level 5)

- **Produces:** `validateDeckDraft(...).issues` excludes `issue.code === "empty-side"`; editor deck-name input attributes `aria-label="Deck name"`, `placeholder="Deck name"`; catalog name input exposes focus handle/callback as `export let onnameinputmount: (element: HTMLInputElement) => void = () => undefined` only if parent ownership is needed. Handoff contract: `[data-cy="deck-catalog-to-sideboard-field"]` is absent; `[data-cy="deck-catalog-header"]` retains result count plus free action slot; initial editor mount focuses `[data-cy="deck-catalog-name-input"]`.
- **Consumes:** `catalogCardClickIntent(canonicalZone, counts, false)` or equivalent direct false; existing `DeckBuilderCardView.canonicalZone`; existing explicit Side drop/menu commands.
- **Errors:** empty-side produces no warning/message/status; Side overflow still exact existing `Side Deck exceeds 15 cards by N.`; focus failure is observable through `document.activeElement`.
- **Invariants:** no schema version change; legacy issue member retained; catalog add never routes Side by hidden state; accessible input names remain; every rendered element keeps `data-cy`.
- **Integration links:** deck draft → `validateDeckDraft` → controller revalidation → `DeckWorkspace.issuesForZone` → no empty-side indicator. Catalog activation → `catalogCardClickIntent(..., false)` → controller add command → canonical Main/Extra list. Editor mount → name input element → `.focus()` → observed `document.activeElement`.

## TDD

- [ ] **Red** — Change validation/UI tests to require no empty-side and add absence/routing/focus/a11y tests; validation: targeted validation/editor cmd fails before impl.
- [ ] **Green** — Stop warning emission, remove sideboard state/props/markup, add accessible deck-name placeholder and bounded mount focus; validation: targeted cmd passes.
- [ ] **Refactor** — Remove imports/vars orphaned only by this change and retain legacy union member with comment; validation: typecheck/lint plus targeted cmd remain green.

## Test plan

| Test               | Input                       | Expect                                                  |
| ------------------ | --------------------------- | ------------------------------------------------------- |
| empty Side         | valid Main, empty Side      | no `empty-side`; no Side warning icon                   |
| Side overflow      | 16 Side cards               | existing error remains                                  |
| catalog activation | Main/Extra card             | added to canonical zone                                 |
| Side paths         | drag/move deck card to Side | still succeeds                                          |
| control absence    | rendered catalog            | no to-sideboard field/input/label                       |
| deck-name a11y     | editor header               | no visible label; accessible name + placeholder present |
| entry focus        | initial editor mount        | catalog name input is active element                    |

## Impl steps

- [ ] 1. Add failing unit/component tests for exact four requirements; validation: current empty warning/toggle/label/no-focus each cause red.
- [ ] 2. Stop `empty-side` emission while retaining legacy type member; validation: old fixture can still type/read, new validation excludes code.
- [ ] 3. Delete sideboard toggle state/props/markup and force canonical add route; validation: click tests pass and explicit Side movement remains green.
- [ ] 4. Remove visible Deck Name label; add `aria-label` + placeholder; validation: a11y query finds input, label selector absent.
- [ ] 5. Focus catalog name on initial editor entry after mount/tick; validation: no dialog test loses focus.
- [ ] 6. Remove only orphaned vars/imports/tests; validation: typecheck/lint clean.

## Validation

- [ ] Validation tests pass: `npx vitest run tests/unit/decks/deck-validation.test.ts tests/component/deck-editor/deck-validation-ui.test.ts`.
- [ ] Editor behavior passes: `npx vitest run tests/component/deck-editor/deck-editor-a11y.test.ts tests/component/deck-editor/deck-click-move.test.ts tests/component/deck-editor/portrait-layout.test.ts tests/component/deck-editor/card-catalog.test.ts`.
- [ ] Static gates pass: `npm run typecheck && npm run lint && npm run format:check`.
- [ ] Manual check: enter editor and type immediately; double-click catalog cards; move deck card to Side; empty Side shows no warning.
- [ ] No silent-failure swallow on a path this slice adds — `none`.
- [ ] App functional — Main/Extra add, Side move, validation summaries, dialog focus remain intact.
- [ ] Commit msg draft: `fix(deck-editor): remove noise from entry and canonical add flow`.
