# T5: Fit and densify Deck Builder

**Plan:** `./artifacts/PLAN_2026_09_04_feedback_round_2.md`  
**Depends:** none  
**Commit outcome:** Deck Builder fits normal stage viewports, keeps workspace width stable, expands deck name, and shows more one-line card tiles.

## Context (self-contained)

- C1. Goal: Remove outer `shell-region-decks` scrollbar and stabilize dense editor geometry.
- C2. This slice: Feedback Deck Builder items 1, 2, 3, 11.
- C3. Out of scope here: Filter behavior/labels, empty-side validation, sideboard routing, advanced dialog, preview fallback.
- C4. Assumptions in force: “More cards” means more catalog result rows visible in first viewport, not larger tiles or more columns. Desktop stage starts at existing 1024px breakpoint; portrait tab layout remains functional.

## Requirements

- R1. Every card tile name is one line with ellipsis; no wrapping.
- R2. `shell-region-decks` has no x/y overflow at normal supported desktop viewports; content is not clipped to fake fit.
- R3. Deck editor derives height from parent grid/flex constraints, not duplicated header-height subtraction constants.
- R4. `deck-workspace` reserves native scrollbar gutter before overflow so cards/header never shift laterally.
- R5. Deck-name input consumes free header width up to action group; controls stay readable and non-overlapping.
- R6. Story/free-play banners and portrait pane layout remain inside stage.

## Inputs

- I1. `src/styles/app.css` — `.shell-region--decks`, stage ownership.
- I2. `src/deck-editor/DeckEditorApp.svelte`, `src/deck-editor/components/DeckEditor.svelte` — root/header/layout sizing.
- I3. `src/deck-editor/components/DeckWorkspace.svelte` — workspace scroller.
- I4. `src/deck-editor/components/CardTile.svelte`, `CardCatalog.svelte` — names/result grid.
- I5. ADR-024, ADR-042; `src/shell/stage-layout.ts`.
- I6. Tests: editor shell/workspace/card tile component tests and `e2e/deck-editor.spec.ts`.
- I7. **From Depends:** none.

## Interface contract (level 5)

- **Produces:** Layout invariant selectors: `.shell-region--decks { min-height: 0; overflow: hidden; }`; Deck Editor root uses `height: 100%; min-height: 0`; pane grid consumes remaining row via `minmax(0,1fr)`; `.workspace { scrollbar-gutter: stable; }`; `.card-name { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }`; `.name-field` flex/grid track `minmax(0,1fr)` and input `width:100%`. Handoff contract: DOM anchor `[data-cy="deck-workspace"]` remains stable, occupies center deck pane, and its measured `getBoundingClientRect()` is authoritative overlay target.
- **Consumes:** Shell stage dimensions/custom props; existing portrait `tabs`/`.filled` variants; action-button intrinsic widths.
- **Errors:** no runtime errors. Geometry test fails with measured `scrollWidth/clientWidth` or `scrollHeight/clientHeight` delta >1px.
- **Invariants:** shell/body never scroll; workspace/catalog own necessary inner scroll; `scrollbar-gutter` disabled/irrelevant when `.filled` uses visible overflow; no card-tile aspect ratio or grid column-count change.
- **Integration links:** `stage-layout.ts` dimensions → `AppShell .shell-region--decks` → `DeckEditorApp` root → `DeckEditor` header + `minmax(0,1fr)` panes → inner workspace/catalog scrollers → observe outer scroll extents equal client extents and extra complete catalog row.

## TDD

- [ ] **Red** — Add parameterized Chromium geometry tests plus source contracts for ellipsis/gutter/header fill; validation: targeted component/Playwright cmds fail before impl.
- [ ] **Green** — Replace fixed subtraction with parent-owned grid sizing and minimum CSS changes; validation: targeted component/Playwright cmds pass.
- [ ] **Refactor** — Remove only now-unused height vars/constants introduced by old sizing; validation: responsive tests remain green.

## Test plan

| Test          | Input                                             | Expect                                                 |
| ------------- | ------------------------------------------------- | ------------------------------------------------------ |
| tile overflow | long card name                                    | one line, `text-overflow: ellipsis`, clipped width     |
| desktop fit   | 1024×768, 1280×720, 1366×768, 1440×810, 1920×1080 | outer region extents ≤ client +1px                     |
| story banner  | story Deck Builder                                | header/banner/panes fit stage                          |
| stable gutter | workspace below/above overflow threshold          | content x/width unchanged                              |
| header fill   | standard desktop                                  | deck-name input fills gap; actions do not wrap/overlap |
| portrait      | existing narrow fixtures                          | tab pane scroll remains reachable                      |

## Impl steps

- [ ] 1. Add failing source/component/E2E geometry tests; validation: current outer region overflow, two-line names, missing gutter, fixed-width name fail.
- [ ] 2. Rework shell/editor height tracks to parent-owned `minmax(0,1fr)`; validation: all desktop viewport extents fit without clipping.
- [ ] 3. Add workspace stable gutter; validation: before/after overflow content rects differ ≤1px.
- [ ] 4. Make tile names one-line ellipsis and collapse reserved second-line height; validation: long name clips and short name remains readable.
- [ ] 5. Give header name track remaining width; validation: input reaches action group with no overlap at every desktop fixture.
- [ ] 6. Run portrait/story/free-play regressions; validation: pane navigation and banners stay visible.

## Validation

- [ ] Targeted tests pass: `npx vitest run tests/component/deck-editor/deck-editor-shell.test.ts tests/component/deck-editor/deck-workspace-selectors.test.ts tests/component/deck-editor/card-tile-art.test.ts tests/component/deck-editor/portrait-layout.test.ts`.
- [ ] Browser geometry passes: `npx playwright test e2e/deck-editor.spec.ts --grep "fits stage|stable gutter|single-line card name|header fill"`.
- [ ] Static gates pass: `npm run typecheck && npm run lint && npm run format:check`.
- [ ] Manual check: desktop min/typical/max plus portrait; outer shell no scrollbar; workspace/catalog remain independently scrollable.
- [ ] No silent-failure swallow on a path this slice adds — `none`.
- [ ] App functional — all cards/zones/header actions remain reachable.
- [ ] Commit msg draft: `fix(deck-editor): keep workspace dense inside shell stage`.
