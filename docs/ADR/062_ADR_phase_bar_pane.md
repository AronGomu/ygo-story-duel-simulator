# ADR-062: Phase Bar Pane

> Status: accepted; planned
> Decided: 2026-08-29
> Owners: browser presentation architecture
> Relates: ADR-010 (phase chip availability/current semantics, unchanged), ADR-019 (duel-shell panes this joins), ADR-061 (band shrink that evicted the strip)
> Amended by [ADR-073](073_ADR_end_turn_returns_to_field_corner.md): §5 End-turn chip placement is superseded; sole End Turn control returns to field bottom-right.

## Context

Phase chips lived on the field's centre band (`PhaseStrip`), straddling the EMZ gap, with the End-turn button at the band's right edge. ADR-061 shrinks that band to `0.78 pitch` (EMZ) or `0.12 pitch` (without) — the strip's home is gone. ADR-060 additionally projects the field centre smaller, exactly where phase controls would need to stay legible and tappable.

The duel shell is already a row of panes: card preview | field | rail (ADR-019). Chip interaction semantics are settled (ADR-010): a chip is a button only while the engine offers that jump (`battle`/`main2`/`end` only), the current phase carries the accent ring, everything else is inert; the End-turn label comes from the engine's own choice.

## Decision

1. Phases render in a standalone vertical pane (`PhaseBar`) between the field and the rail — a fourth `.duel-shell` grid column, full shell height, **outside** the field and its projection.
2. The pane splits at the exact horizontal middle. Bottom half is the player, blue-tinted (`--phase-player` token); top half is the opponent, red-tinted (danger token); both gradients fade toward the middle seam.
3. Chip order runs from the middle outward on both halves — Draw nearest the seam, then Standby, Main 1, Battle, Main 2, with the turn-ending control outermost (player: bottom corner; opponent: top corner). The two halves are exact mirrors.
4. Interaction semantics are ADR-010's, unmoved: availability from `phaseSlotChoices`, current from `phaseSlotForDuelPhase`, dispatch via `chooseChoice`. The half belonging to `turnPlayer` carries the current highlight; the other half is fully inert. The opponent's End is never a button.
5. The player's End turn is a chip like every other entry — same pill metrics — whose *enabled* state is warning-yellow with the engine's label (`End Battle Phase`, etc.). Disabled, it is one more muted chip, not a faded yellow button. During the player's End Phase it carries the current ring (the player half has no separate `end` chip). Its `data-cy="field-end-turn-button"` survives the move.
6. `PhaseStrip` and `EndTurnButton` are deleted, along with the band-anchored strip CSS.

## Consequences

- Both players' full phase sequences are always visible, and the turn's position reads at a glance from which half glows — information the single centre strip never showed.
- The duel shell loses ~8rem of field width to the new column. At 1280×720 the board shrinks accordingly; accepted.
- The bar duplicates the rail's turn/phase text in spatial form. Two surfaces now say "Battle Phase"; they can never disagree (same snapshot), but it is redundancy.
- Phase controls no longer sit where the eye is during field play; the pointer travels further to end a turn. Trade taken for an uncluttered projected field.

## Alternatives rejected

- **Keep the strip on the shrunken band.** At `0.12 pitch` the band is thinner than a 44px touch target; projected, thinner still. Physically doesn't fit.
- **Overlay the chips on the field (screen-space, unprojected).** Occludes the smallest, most distant zones — the exact real estate the perspective is spending to look right.
- **Fold phases into the existing rail.** The rail owns identity/status (avatars, LP, options); phase chips are per-turn controls with click semantics. Mixing them makes the rail a junk drawer and leaves no room for the mirrored two-player reading.
- **One shared column of six chips (no halves).** Loses the "whose phase is it" reading that the red/blue split gives for free, and has no natural home for two End controls.
