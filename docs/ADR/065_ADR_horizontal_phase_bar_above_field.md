# ADR-065: Horizontal phase bar above the field, three-column shell

> Status: accepted; planned
> Decided: 2026-09-02
> Owners: browser presentation architecture
> Supersedes: ADR-062 §1–§3 (vertical pane placement, half orientation, outward chip order); ADR-062 §4–§6 (ADR-010 interaction semantics, End-turn chip treatment, PhaseStrip deletion) stay in force
> Amends: ADR-028 §4 (Full Control checkbox moves bottom-right → bottom-left of the duel field)
> Relates: ADR-010 (chip availability/current semantics, unchanged), ADR-019 (duel-shell panes), ADR-061/060 (band shrink + projection that first evicted the strip)
> Amended by [ADR-073](073_ADR_end_turn_returns_to_field_corner.md): §3 no longer places End Turn inside PhaseBar; phase chips remain above field.

## Context

ADR-062 gave phases a vertical fourth `.duel-shell` column between field and rail, costing ~8rem of field width and accepting the board shrink. Owner feedback round 2026-09-02 reverses that trade: "Move phases bar to be above the duel field, horizontally. Opponent at the right, you at the left, splitted by the vertical middle of duel field", "Reduce width of the right pane", and "with freed-up width space, make duel field bigger to fill the given space". Field size is now the explicit priority; the vertical pane's width cost is no longer acceptable.

The field's rendered size derives from its slot box: `.duel-field-slot` width feeds a `ResizeObserver` into `computeFieldGeometry`, whose `pitch = min(availableHeight/hP, (availableWidth-c)/wCoeff)`. A bar above the field converts the phase pane's width cost into a height cost; the bar therefore has to stay thin (2.5rem budget) and its height is subtracted from the slot deliberately, because if the height term of that `min` binds, the board would shrink — the opposite of the ask.

## Decision

1. The `.duel-shell` grid returns to three columns: preview | field column | rail. The phase pane column is deleted.
2. Phases render as a thin horizontal bar (height `--phase-bar-h: 2.5rem`) in a flex column wrapper above `.duel-field-slot`, spanning the field column only. The slot's height subtracts the bar's height.
3. The bar splits at its horizontal center — the field's vertical middle. Player half left, opponent half right. Player chips run Draw→Main 2 left-to-right with the End-turn chip; opponent chips mirror so the two turn timelines meet at the center seam. ADR-062 §4–§5 chip semantics apply unchanged.
4. The rail floor narrows: `--rail-min` 15rem → 11rem (9rem at the ≤1500px breakpoint). Freed width flows into the slot formula.
5. The Full Control toggle anchors bottom-left of the duel field (was bottom-right per ADR-028 §4); its tooltip opens rightward.
6. One layout for all orientations: portrait keeps the horizontal bar; the portrait-only vertical `--phase-bar-w` override is deleted.

## Consequences

- The field gains the ~8rem column plus 4rem of rail, minus 2.5rem of height. Net area growth is the acceptance bar and is measured in Chromium at 1920×1080, not assumed.
- The vertical bar's "whose half glows" reading rotates 90°: turn position now reads left/right instead of top/bottom, and the opponent's mirrored horizontal order is less like reading a list than the vertical stack was. Trade taken for field size.
- Exact-string CSS locks (`tests/unit/global-styles.test.ts` grid/slot formulas) and phase-bar pixel-geometry e2e assertions all rewrite; anyone bisecting across this change will see mass test churn from one commit.
- The rail at 11rem is tight for long status text; overflow there is now the rail's problem to solve within its narrower track.

## Alternatives rejected

- **Keep ADR-062's vertical pane, only narrow it.** Below ~5rem the chip labels truncate to unreadability; the ask was explicit about horizontal-above placement.
- **Overlay the bar on the field's top edge (absolute, zero layout cost).** Occludes the opponent's back row exactly when chains prompt there; ADR-062 rejected field overlays for the same reason.
- **Put phases back on the center band (pre-ADR-062 strip).** ADR-061's band is `0.12`–`0.78 pitch` — still physically too thin; nothing changed there.
- **Let the grid auto-place the bar as a full-width row.** Spanning preview and rail wastes the split-at-field-middle anchor the owner asked for; the bar must track the field column alone.
