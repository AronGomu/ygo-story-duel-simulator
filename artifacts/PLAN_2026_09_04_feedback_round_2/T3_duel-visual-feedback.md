# T3: Duel visual feedback

**Plan:** `./artifacts/PLAN_2026_09_04_feedback_round_2.md`  
**Depends:** none  
**Commit outcome:** Opponent hand fans correctly, zoomed hand card keeps semantic halo, and Duel action chips use square Basilica controls with clear hover.

## Context (self-contained)

- C1. Goal: Correct three Duel Field visual/affordance defects without changing legality or response routing.
- C2. This slice: Opponent hand transform, hand zoom halo projection, card-action chip CSS.
- C3. Out of scope here: End Turn location/automation, prompt contracts, engine response logic, material dialog.
- C4. Assumptions in force: “Action buttons” means `CardActionChips` shown on field cards and `HandZoomOverlay`; square means square corners plus content-width rectangle.

## Requirements

- R1. Opponent visual order and fan-angle signs form correct mirror; own hand order/fan stays byte-behavior equivalent.
- R2. Enlarged hovered hand card carries same legal/selected halo semantics as source card; enlarged art cannot hide feedback.
- R3. Halo derives only from `ActiveInteractionSpec`/selection state: legal green, selected orange, dashed vs solid per ADR-058.
- R4. Action chips use square corners, explicit brand border, `cursor: pointer`, darker hover, visible focus, distinct disabled state.
- R5. Choice labels, click/keyboard dispatch, stable `data-cy`, hidden identity, and perspective-plane boundaries remain unchanged.

## Inputs

- I1. `src/battle/app/components/duel-field/HandBand.svelte`, `CardControl.svelte`, `HandZoomOverlay.svelte`, `CardActionChips.svelte`.
- I2. `src/battle/app/components/DuelField.svelte` — zoom state + interaction spec.
- I3. `src/styles/app.css`, `src/styles/tokens.css`.
- I4. ADR-047, ADR-058, ADR-060, ADR-067.
- I5. Tests: `HandBand.test.ts`, `HandZoomOverlay.test.ts`, `CardActionChips.test.ts`, `DuelField.test.ts`, `global-styles.test.ts`.
- I6. **From Depends:** none.

## Interface contract (level 5)

- **Produces:** `HandZoomOverlay.svelte` prop `export let halo: "legal" | "selected" | null = null;`; root classes `.is-legal`, `.is-selected`; opponent displayed fan angle equals `-fanDegFor(index,total)` while player remains `fanDegFor(index,total)`.
- **Consumes:** `ActiveInteractionSpec` card choices and `InteractionSession.selectedChoiceIds`; existing `CardActionChips` props/callback unchanged.
- **Errors:** none; unrecognized/no choice state maps to `halo=null`, never guessed legal.
- **Invariants:** engine/display order untouched; only CSS transform sign changes for opponent; selected wins over legal when both apply; hidden opponent identity never gains art/text; action controls remain native `<button>`.
- **Integration links:** Worker prompt → `mapPromptToInteractionSpec` → `DuelField` derives hovered card halo → `HandZoomOverlay` class → CSS ring observable around enlarged card. `CardActionChips` choice click → existing `onchoose(choice.id)` → keyed interaction dispatch unchanged.

## TDD

- [ ] **Red** — Add mirrored fan-sign, zoom-halo class/priority, and action-chip style-state tests; validation: targeted component/style cmd fails before impl.
- [ ] **Green** — Negate only opponent display angle, pass exact halo enum, add minimum tokenized CSS; validation: targeted cmd passes.
- [ ] **Refactor** — Remove obsolete selected boolean only if halo enum fully replaces it; validation: targeted cmd remains green with one halo source.

## Test plan

| Test              | Input                              | Expect                                                            |
| ----------------- | ---------------------------------- | ----------------------------------------------------------------- |
| fan mirror        | equal 5-card hands                 | opponent displayed angle sequence mirrors player; droop symmetric |
| player regression | existing ordered hand              | own angle/order unchanged                                         |
| legal zoom        | hovered actionable unselected card | enlarged overlay has legal halo                                   |
| selected zoom     | hovered selected card              | selected halo wins                                                |
| neutral zoom      | no matching choice                 | no halo class                                                     |
| chip hover CSS    | enabled chip                       | square corner, border, pointer, darker hover                      |
| chip disabled     | pending response                   | no pointer affordance; click emits nothing                        |

## Impl steps

- [ ] 1. Add failing component/style tests; validation: target cmd fails on current opponent sign, missing legal zoom halo, rounded/borderless chip.
  - [ ] 1.1 Pin own-hand angle/order baseline first; validation: new fix cannot rewrite player behavior.
- [ ] 2. Correct opponent angle sign at display boundary; validation: no engine index/displayOrder changes in diff.
- [ ] 3. Replace zoom selected-only prop with semantic halo enum; validation: legal/selected/neutral fixtures render exact classes.
- [ ] 4. Restyle action chips with tokens; validation: hover/focus/disabled source rules and click tests pass.
- [ ] 5. Capture Chromium visual evidence at supported desktop viewport; validation: opponent fan, halo, chip hover visible without overlap.

## Validation

- [ ] Targeted tests pass: `npx vitest run tests/component/HandBand.test.ts tests/component/HandZoomOverlay.test.ts tests/component/CardActionChips.test.ts tests/component/DuelField.test.ts tests/unit/global-styles.test.ts`.
- [ ] Browser Duel check passes: `npx playwright test e2e/duel-smoke.spec.ts --grep "opponent hand fan|zoom halo|action chip hover"`.
- [ ] Static gates pass: `npm run typecheck && npm run lint && npm run format:check`.
- [ ] Manual check: hover legal/selected own-hand cards; inspect halo at 1.6× zoom; hover each action chip; inspect opponent fan.
- [ ] No silent-failure swallow on a path this slice adds — `none`.
- [ ] App functional — prompt responses, hand order, drag, keyboard activation remain green.
- [ ] Commit msg draft: `fix(duel): keep field intent legible through hand and action feedback`.
