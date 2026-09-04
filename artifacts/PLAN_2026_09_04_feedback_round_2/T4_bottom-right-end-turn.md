# T4: Bottom-right End Turn automation

**Plan:** `./artifacts/PLAN_2026_09_04_feedback_round_2.md`  
**Depends:** none  
**Commit outcome:** One bottom-right End Turn press safely carries intent across engine-offered exits, pauses for player decisions, then resumes until opponent turn.

## Context (self-contained)

- C1. Goal: Move sole End Turn control from horizontal phase bar to Duel Field bottom-right and reduce repeated phase-exit clicks.
- C2. This slice: Screen-space button, pure automation reducer, app/store wiring, ADR supersession.
- C3. Out of scope here: Auto-answering mandatory/optional gameplay choices, Worker/core changes, phase-chip redesign, Full Control behavior.
- C4. Assumptions in force: Button stays outside CSS-3D plane; same intent remains armed while a non-transition prompt waits for player; no fabricated choice.

## Requirements

- R1. Exactly one `data-cy="field-end-turn-button"` renders at field bottom-right; PhaseBar no longer renders End chip.
- R2. Button label/availability comes from current `InteractionChoice` where `action === "endPhase"`.
- R3. One press arms intent and dispatches current end-phase choice once.
- R4. After each accepted response/new prompt, armed intent dispatches next offered `endPhase` choice once.
- R5. Any non-end-phase prompt pauses: no choice auto-submitted; after user answers, armed intent resumes.
- R6. Intent clears when turn passes to opponent, duel ends/disposes/restarts, or current session generation changes.
- R7. Pending response and repeated reactive evaluation never double-dispatch same `InteractionKey`.
- R8. ADR-073 supersedes ADR-065 §3 and ADR-062 §5 only for End-control placement; ADR-074 records resumable intent. Phase semantics remain engine-owned.

## Inputs

- I1. `src/battle/app/components/PhaseBar.svelte`, `DuelField.svelte`, `src/battle/app/App.svelte`.
- I2. `src/battle/app/prompts/interaction-spec.ts` — `endPhaseChoice()`.
- I3. `src/battle/app/prompts/interaction-session.ts` — keyed action.
- I4. `src/battle/app/stores/duel-store.ts` — `dispatchInteraction()` and pending guard.
- I5. `docs/ADR/062_ADR_phase_bar_pane.md`, `docs/ADR/065_ADR_horizontal_phase_bar_above_field.md`, ADR-073, ADR-074.
- I6. Tests: `PhaseBar.test.ts`, `DuelField.test.ts`, `interaction-session.test.ts`, new reducer test, `e2e/duel-smoke.spec.ts`.
- I7. **From Depends:** none.

## Interface contract (level 5)

- **Produces:** `src/battle/app/presentation/end-turn-automation.ts`:

```ts
export interface EndTurnAutomationState {
  readonly status: "idle" | "armed";
  readonly sessionGeneration: number | null;
  readonly lastDispatchedKey: InteractionKey | null;
}
export interface EndTurnAutomationInput {
  readonly turnPlayer: PlayerIndex;
  readonly duelFinished: boolean;
  readonly responsePending: boolean;
  readonly sessionGeneration: number;
  readonly spec: ActiveInteractionSpec | null;
}
export type EndTurnAutomationEvent =
  | Readonly<{ type: "arm" }>
  | Readonly<{ type: "sync"; input: EndTurnAutomationInput }>
  | Readonly<{ type: "reset" }>;
export interface EndTurnAutomationReduction {
  readonly state: EndTurnAutomationState;
  readonly action: InteractionSessionAction | null;
}
export function reduceEndTurnAutomation(
  state: EndTurnAutomationState,
  event: EndTurnAutomationEvent,
): EndTurnAutomationReduction;
```

`EndTurnButton.svelte` props: `choice: InteractionChoice | null`, `armed: boolean`, `disabled: boolean`, `onstart: () => void`.

- **Consumes:** `endPhaseChoice(spec)`; current `turnPlayer`, `responsePending`, `sessionGeneration`, duel result/status; `duel.dispatchInteraction(action)`.
- **Errors:** no end choice → disabled button and no action; stale/same key → no action; pending → no action; user prompt → armed/no action; session reset/opponent/result → idle/no action.
- **Invariants:** emitted action is exactly `{ type: "chooseChoice", choiceId: choice.id, key: spec.key }`; reducer never emits any other choice; each key emits at most once; button does not mutate phase/state directly.
- **Integration links:** press `EndTurnButton` → reducer `arm/sync` → `endPhaseChoice(current spec)` → `duel.dispatchInteraction` → `reduceInteractionSession` stale/choice guard → `acceptResponse` → Worker/core → new prompt/snapshot → reducer `sync` resumes or pauses → observe opponent `turnPlayer` and idle state.

## TDD

- [ ] **Red** — Add reducer tests for arm/dispatch/dedupe/pause/resume/clear plus component location/one-control tests; validation: `npx vitest run tests/unit/end-turn-automation.test.ts tests/component/PhaseBar.test.ts tests/component/DuelField.test.ts` fails before impl.
- [ ] **Green** — Implement pure reducer and sole bottom-right button; validation: targeted reducer/component cmd passes without bypassing store.
- [ ] **Refactor** — Extract repeated key equality only if existing helper is legally importable; validation: targeted cmd remains green and diff adds no second authority.

## Test plan

| Test            | Input                          | Expect                                              |
| --------------- | ------------------------------ | --------------------------------------------------- |
| first exit      | player spec with end choice    | exact keyed action once                             |
| pending dedupe  | same spec, pending toggles     | no second action                                    |
| next phase      | new key with end choice        | next exact action                                   |
| mandatory pause | armed, non-end prompt          | no action; state armed                              |
| resume          | user answers; later end choice | action emits without second button press            |
| opponent turn   | `turnPlayer=1`                 | state idle                                          |
| duel end/reset  | result or generation change    | state idle                                          |
| placement       | rendered Duel                  | sole control bottom-right outside transformed plane |

## Impl steps

- [ ] 1. Add failing pure reducer tests; validation: missing module causes red, expected transitions cover every stop/pause branch.
- [ ] 2. Add failing PhaseBar/DuelField tests for sole relocated control; validation: current PhaseBar End chip makes test red.
- [ ] 3. Implement reducer and button; validation: exact action only, one key once, mandatory prompt leaves `status="armed"`.
- [ ] 4. Wire App/store reactive sync; validation: real prompt sequence resumes after manual response and ends at opponent turn.
- [ ] 5. Remove PhaseBar End branch/CSS; validation: phase chips retain ADR-010 semantics and selector uniqueness passes.
- [ ] 6. Implement accepted ADR-073/074 contracts and add `Implemented:` evidence when shipped; validation: durable docs contain no artifact/feedback links.
- [ ] 7. Add Chromium geometry/flow coverage; validation: one press reaches opponent turn without auto-answering intervening decision.

## Validation

- [ ] Targeted tests pass: `npx vitest run tests/unit/end-turn-automation.test.ts tests/component/PhaseBar.test.ts tests/component/DuelField.test.ts tests/unit/interaction-session.test.ts`.
- [ ] Browser flow passes: `npx playwright test e2e/duel-smoke.spec.ts --grep "End Turn"`.
- [ ] Doc/selector gates pass: `npx vitest run tests/unit/data-cy-coverage.test.ts tests/unit/global-styles.test.ts`.
- [ ] Static gates pass: `npm run typecheck && npm run lint && npm run format:check`.
- [ ] Manual check: press once in Main Phase; answer any surfaced decision; verify automation resumes and stops on opponent turn.
- [ ] No silent-failure swallow on a path this slice adds — `none`.
- [ ] App functional — phase chips, prompt UI, pending-state guard, duel result remain authoritative.
- [ ] Commit msg draft: `feat(duel): carry end-turn intent through engine-owned phase exits`.
