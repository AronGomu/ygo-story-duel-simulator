# T10: Engine-authentic material gating

**Plan:** `./artifacts/PLAN_2026_09_04_feedback_round_2.md`  
**Depends:** none  
**Commit outcome:** Deterministic Dante evidence proves selector gating: real material choices render/submit exactly; pinned-core auto-detach renders no fake selector.

## Context (self-contained)

- C1. Goal: Resolve reported Dante detach-dialog gap without claiming choices core never offered.
- C2. This slice: Strengthen real-core activation trace, positive mapper/component gate, negative auto-detach gate, stale comments.
- C3. Out of scope here: Engine/vendor/card-script edits, projected-sequence inference, informational fake choice, changing detach outcome.
- C4. Assumptions in force: Known pinned-core flow may auto-detach; this is correct no-selector behavior. Existing `MaterialSelectDialog` remains production route when `PromptCard.overlay === true` exists.

## Requirements

- R1. Deterministic real-core fixture must explicitly activate Dante, observe pre/post overlay material state, and capture every prompt between activation and material decrement.
- R2. Fixture classifies `materialDecision` as `"engine-choice"` only when prompt choices carry real `overlay:true`; otherwise `"auto-detach"`.
- R3. `engine-choice` path maps each real choice to `spec.overlayChoices`, renders dialog, and submits exact offered choice id/order.
- R4. `auto-detach` path renders no material dialog and adds no synthetic choice.
- R5. Existing unit/component positive fixtures remain synthetic contract tests and are labeled as such; real-core negative test no longer overclaims unless activation/decrement is proven.
- R6. If strengthened fixture unexpectedly emits real overlay choices, production path must pass unchanged; if it fails, repair only marker→mapper→mount flow using real payload.

## Inputs

- I1. `tests/integration/gy-trigger-chain-window.test.ts` — deterministic Dante activation driver.
- I2. `tests/integration/xyz-detach-overlay-address.test.ts` — current broad but under-attested negative claim.
- I3. `src/battle/worker/protocol/PromptRegistry.ts` — `PromptCard.overlay` marker + raw index response.
- I4. `src/battle/duel/contracts/player-prompt.ts` — optional overlay marker.
- I5. `src/battle/app/prompts/interaction-spec.ts`, `DuelField.svelte`, `MaterialSelectDialog.svelte`.
- I6. Tests: `interaction-spec.test.ts`, `DuelField.test.ts`, `MaterialSelectDialog.test.ts`.
- I7. ADR-059 — explicitly rejects sequence inference and gates detach on integration proof.
- I8. **From Depends:** none.

## Interface contract (level 5)

- **Produces:** Test-only capture:

```ts
interface DanteMaterialDecisionCapture {
  readonly kind: "engine-choice" | "auto-detach";
  readonly activationPromptId: PromptId;
  readonly materialPrompts: readonly PlayerPrompt[];
  readonly before: readonly PublicOverlayMaterial[];
  readonly after: readonly PublicOverlayMaterial[];
  readonly detachedCode: CardCode | null;
}
```

Production gate remains: `prompt.kind === "selectCard" && choice.card?.overlay === true` → `ActiveInteractionSpec.overlayChoices`; `overlayChoices.size > 0` → `MaterialSelectDialog`; submit uses original `ChoiceId`.

- **Consumes:** Engine-issued `PlayerPrompt`, projected `PublicOverlayMaterial[]`, current `PromptRegistry.respond` index mapping.
- **Errors:** auto-detach + rendered dialog → test error `Material selector rendered without an engine material choice`; engine-choice + missing dialog → test error `Engine material choices did not reach MaterialSelectDialog`; chosen id absent from prompt → existing `invalid_response`.
- **Invariants:** no choice synthesized from projected materials; no sequence inference; material art/card code comes only from attested prompt choice; original engine choice id/order survives; hidden identity rules unchanged.
- **Integration links:** deterministic deck/seed → Dante activate choice → `HeadlessDuelController`/core → emitted prompts + projected before/after materials → `PromptRegistry` marker → `mapPromptToInteractionSpec` → `DuelField` gate → `MaterialSelectDialog` → original choice id response → observe exact detached material when core exposes choice, or no dialog when core auto-detaches.

## TDD

- [ ] **Red** — Add test importing missing `captureDanteMaterialDecision` helper and requiring activation/material decrement; validation: targeted real-core cmd fails on missing symbol before impl.
- [ ] **Green** — Implement deterministic capture helper and gate assertions; validation: targeted real-core/UI cmds pass, with production repair only if real engine-choice payload fails route.
- [ ] **Refactor** — Reuse driver helpers only where duplication is material; validation: targeted cmds remain green and fixtures stay self-contained.

## Test plan

| Test             | Input                                            | Expect                                               |
| ---------------- | ------------------------------------------------ | ---------------------------------------------------- |
| activation proof | deterministic Dante line                         | activation true; before count > after count          |
| auto-detach      | known pinned-core capture with no overlay prompt | `kind="auto-detach"`; no dialog contract synthesized |
| engine marker    | synthetic/raw overlay-bit prompt                 | marker exactly mirrors bit                           |
| mapper positive  | real-shaped `overlay:true` choice                | choice in `overlayChoices`, not host/global map      |
| dialog positive  | nonempty overlay choices                         | selector renders; exact id submits                   |
| dialog negative  | projected materials but zero overlay choices     | selector absent                                      |
| identity         | concealed/visible choices                        | no hidden code/art leak                              |

## Impl steps

- [ ] 1. Write failing activation/decrement assertions around deterministic Dante driver; validation: current broad test cannot prove claimed detach boundary.
- [ ] 2. Capture every between-state prompt and classify exact contract; validation: classification derives from emitted marker, not card name/sequence.
- [ ] 3. Feed captured real-shaped prompt through mapper/field harness; validation: auto path has zero dialog, engine-choice path has one.
- [ ] 4. Repair production gate only if step 3 finds mismatch; validation: diff contains no synthetic `ChoiceId`, no sequence inference, no vendor/script edit.
- [ ] 5. Correct stale comments/test names to state proven behavior; validation: every “auto-detach” claim cites activation + material decrement assertion.

## Validation

- [ ] Real-core tests pass: `npx vitest run tests/integration/gy-trigger-chain-window.test.ts tests/integration/xyz-detach-overlay-address.test.ts`.
- [ ] Mapper/UI tests pass: `npx vitest run tests/unit/interaction-spec.test.ts tests/component/DuelField.test.ts tests/component/MaterialSelectDialog.test.ts`.
- [ ] Protocol regressions pass: `npx vitest run tests/unit/prompt-registry.test.ts tests/integration/xyz-overlay-progression.test.ts`.
- [ ] Static gates pass: `npm run typecheck && npm run lint && npm run format:check`.
- [ ] Manual check: when a diagnostic/real prompt includes material choices, selector displays those cards; known Dante auto-detach path shows none.
- [ ] No silent-failure swallow on a path this slice adds — `none`.
- [ ] App functional — Dante duel continues; detached material/projection and prompt response stay core-authoritative.
- [ ] Commit msg draft: `test(duel): prove material dialogs only represent core choices`.
