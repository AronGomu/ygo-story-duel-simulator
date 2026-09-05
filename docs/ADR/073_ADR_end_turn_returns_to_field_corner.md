# ADR-073: End Turn returns to field corner

> Status: accepted; implemented
> Decided: 2026-09-04
> Implemented: 2026-09-04 — `DuelField` renders sole screen-space `EndTurnButton`; `PhaseBar` renders phase chips only
> Owners: browser presentation architecture
> Supersedes: ADR-065 §3 (End-turn chip inside horizontal PhaseBar), ADR-062 §5 (End-turn chip treatment inside PhaseBar)
> Relates: ADR-010 (engine-owned phase navigation), ADR-060 (screen-space controls outside perspective plane)

## Context

Current `PhaseBar` renders phase navigation above the field. It also renders `data-cy="field-end-turn-button"` as its last player chip. That keeps phase state and phase exit together, but pushes the highest-frequency turn control away from field play.

Field content is rendered on a CSS-3D perspective plane. Screen controls placed inside that plane inherit projection, shrink, and hit-testing risk. Existing field-corner controls already establish a screen-space layer outside that plane.

Owner review on 2026-09-04 requires End Turn at field bottom-right. Phase chips remain useful above field; only End control moves.

## Decision

1. Exactly one End Turn control renders at bottom-right of Duel Field screen space, outside perspective plane.
2. `PhaseBar` keeps player/opponent phase chips and current/available phase semantics, but renders no End Turn chip.
3. Control keeps stable selector `data-cy="field-end-turn-button"`.
4. Visible label, enabled state, choice id, and dispatch key come from current engine-offered `InteractionChoice` where `action === "endPhase"`.
5. Control never mutates phase directly and never appears as second path inside `PhaseBar`.

## Consequences

- End Turn returns near active field interaction and no longer reads as one phase-history chip.
- PhaseBar loses player/opponent visual symmetry: opponent side may still display inert End phase state while player side has no End control in bar.
- Bottom-right field space becomes reserved control space. Future overlays must not cover or duplicate it.
- Existing PhaseBar component and browser geometry tests must change even though phase-choice authority does not.

## Alternatives rejected

- **Keep End Turn in PhaseBar.** Rejected: latest owner decision explicitly restores field-corner placement.
- **Render both locations.** Rejected: duplicate choice affordance weakens hierarchy and violates unique `data-cy` contract.
- **Place button inside perspective plane.** Rejected: projected scale and transformed hit testing make screen control unstable.
- **Move all phase chips back onto field.** Rejected: only End Turn placement changed; horizontal PhaseBar still preserves field area and phase readability.
