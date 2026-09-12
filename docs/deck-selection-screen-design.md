# Deck Selection Screen — final design (2026-08-26)

Markdown twin of [`deck-selection-screen-design.html`](deck-selection-screen-design.html) — same content, styled HTML vs. plain text. Update both together; if they ever drift, the HTML is the one with the worked visual examples (colour swatches, wireframe blocks) and wins.

The default entry screen for every duel, free play and story alike: pick who you face, pick what you bring, and manage the deck library — all from one screen. This document records the design as validated on desktop and mobile against the standalone prototype; it is the reference for the real Svelte implementation, not a plan for further prototype iteration.

## Contents

1. [Status & scope](#status--scope)
2. [Two screens, one shell](#two-screens-one-shell)
3. [The deck tile](#the-deck-tile)
4. [Halo & badge semantics](#halo--badge-semantics)
5. [List ordering](#list-ordering)
6. [Desktop layout](#desktop-layout)
7. [Mobile layout](#mobile-layout)
8. [Deck actions (kebab menu)](#deck-actions-kebab-menu)
9. [Desktop hover previews](#desktop-hover-previews)
10. [Opponent selection (free play)](#opponent-selection-free-play-only)
11. [Keyboard & a11y](#keyboard--a11y)
12. [Data model gaps](#data-model-gaps-this-design-assumes-get-filled)
13. [Non-goals](#non-goals)
14. [Real implementation path](#real-implementation-path)

## Status & scope

**Shipped.** This design was built and iterated as a standalone HTML/CSS/JS prototype (three rounds), verified with Playwright against real pointer interaction — not just programmatic state changes — on both a 1440×810 desktop viewport and a 430×900 phone viewport, and the owner validated the result on both surfaces. It is now real code: **`src/deck-select/DeckSelectScreen.svelte`**, reached through the public entry `src/deck-select/index.ts`, with `DeckTile.svelte`, `DeckTileMenu.svelte`, `DecklistPanel.svelte`, `RenameDeckDialog.svelte` and `DeleteDeckConfirm.svelte` beside it. All three hosts mount that one component — free play (`src/shell/screens/FreePlayMatchSetup.svelte`), the story pre-battle briefing (`src/story/screens/PreBattleScreen.svelte`) and the Deck Builder Library (`src/deck-editor/components/DeckLibrary.svelte`) — and the fourth screen, `src/shell/screens/FreePlayDeckSeat.svelte`, is deleted. [Real implementation path](#real-implementation-path) is history now rather than a to-do.

Commits: `e07fa3eb` opened `src/deck-select/`; the hosts moved onto it in `a36d2300` (free play), `470bc0e6` (library) and `4776fab0` (story). The whole round is `e1d6692..bc79588a`.

- **Two scopes, one component** — Free Play and Story share this exact screen. A `scope: "free-play" | "story"` flag decides which library loads, whether the opponent seat is choosable, and where the deck-builder route points.
- **One tile, four contexts** — the same deck-tile component renders the picking grid, the library grid, the opponent's seat card, and the player's own seat preview — only the interaction mode differs.

## Two screens, one shell

Duel Start (pick decks, start the duel) and the Deck Builder Library (manage the collection) share one header/tools/grid/footer shell. A deck tile always means the same thing; only the surrounding frame and what a press does differ.

| Screen | Grid press | Right panel (desktop) | Footer |
|---|---|---|---|
| Duel Start | Selects the deck for the active seat (player or, mid-pick, opponent) | Opponent portrait/deck card + your deck preview | Back · Delete/Rename/Duplicate · Open · Start the duel |
| Deck Builder Library | Focuses the deck (preview only, no seat is being filled) | Full Main/Extra/Side decklist of the focused deck | Back · Delete/Rename/Duplicate |

## The deck tile

2:1 rectangle. The card art fills the **entire** tile — not a cropped half — with a hard black fade (solid at the text edge, transparent by ~70% across) so the name/stats/badges stay legible without needing a separate art panel. This replaced an earlier 50/50 split specifically so the illustration reads as more than half the card.

- **Top-left** — favourite star (☆/★), its own button — outside the tile's own button so it's independently keyboard-reachable.
- **Top-right** — selection checkmark (✓), shown only on the tile currently picked for the active seat or focused in the library.
- **Bottom-right** — kebab (⋮) — opens the deck-actions menu. See [Deck actions](#deck-actions-kebab-menu).

Body text: deck name (2-line clamp), `Main N · Extra N · Side N`, a meta line (last-modified, or the block reason for an illegal deck), and a badge row.

## Halo & badge semantics

Colour carries meaning consistently across the grid, the seat panel, and the mobile list — never decoration.

| Halo | Token | Meaning |
|---|---|---|
| 🔵 Blue | `--seat-you` (`#4ea3ff`) | Your own deck: the tile you've picked for the player seat, and your seat's preview card. |
| 🔴 Red | `--seat-opponent` (reuses `--danger`) | The opponent's deck: their seat's preview card, and — while the opponent seat is actively being filled — the tile chosen for it in the grid. |
| 🟢 Teal | existing app `--accent` | Neutral selection state: the focused tile in the library grid, where no seat/colour distinction applies. |
| 🟡 Gold hairline | `--selected` token, border only, no glow | Persistent "this is the scope's default deck" marker — worn regardless of current pick, so it never competes visually with an active selection glow. |

Both seat colours are new tokens local to this design (`--seat-you: #4ea3ff`, `--seat-opponent: var(--danger)`) — `src/styles/tokens.css` has no blue token today; the real implementation adds one.

### Badges

| Badge | Shown when |
|---|---|
| `Default` | This is the scope's default deck (independent of current pick) |
| `Illegal / <reason>` | Deck fails validation — story shows it disabled with the reason; free play never lists it at all |
| `Bundled` | Preset deck, ships with the app, not user-created |
| `🔒 <AI name>` | Deck is owned by a specific free-play AI opponent — never deletable |
| `Yours` | While filling the opponent seat: marks which tile is your own current pick, so it doesn't disappear from view |

## List ordering

Same rank function everywhere a deck list renders (duel-start grid, library grid, mobile list), in this priority order:

1. **Illegal decks sink to the bottom**, unconditionally — before default/favourite rank is even considered. A deck that cannot be picked should never crowd out one that can.
2. **Default deck** first among the rest.
3. **Favourited decks** next.
4. **Everything else**, ordered by the active sort (last-modified or name).

Mobile adds one more transform on top: whichever deck is *currently selected* for the active seat is pinned to the very first slot in the visible list, ahead of even the default/favourite ranking above, so it never scrolls out of reach while the grid is being browsed.

## Desktop layout

**16:9 stage, two columns.**

- Left (≈73%): header (eyebrow + title + `X/Y` deck count) → filter/sort tools → scrolling deck grid → footer.
- Right (≈27%, ≥17rem): opponent portrait/identity → opponent's deck card (red halo) → your deck card (blue halo).
- Below 62rem container width, the layout collapses to one column with the opponent panel stacked above the grid.

- **No "Change opponent" / "Change deck" buttons.** The opponent's portrait itself is the control that opens the AI picker (persistent "⇄ Change" chip on hover/focus); the opponent's deck card itself is the control that puts the grid into opponent-seat-picking mode (press again, or the card's own toggle state, to return to picking for yourself).
- **Deck count** renders as `shown/total` next to "Choose your deck", live with the filter.
- **Footer** (left to right): Back · Delete/Rename/Duplicate (act on whichever seat's current pick is highlighted; same enablement rule as the library — Delete off for bundled/AI-owned decks) · Open (opens the selected deck directly, no browse step) · Start the duel.
- Double-clicking any grid tile opens it — the single click(s) that precede the browser's native dblclick already updated selection/focus, so this only triggers the open action.

## Mobile layout

**Single column, portrait phone frame.**

Header (back icon + eyebrow + title + `X/Y` count) → opponent card → filter/sort tools → scrolling one-column deck list (selected deck pinned first) → sticky footer (Start the duel only).

- **Opponent card** sits below the header, above the deck list: tappable avatar (with a permanent ⇄ badge — no hover state exists on a phone) opens the AI picker; the deck card below it (red halo) toggles opponent-seat picking. No separate "Change opponent" / "Change deck" buttons — same avatar-and-card-are-the-controls rule as desktop.
- **No standalone "Open" button.** Deck management moved entirely onto each card's own kebab menu (see next section) — the footer's only job is Start.
- Double-click/double-tap to open works identically to desktop.

## Deck actions (kebab menu)

Every grid deck card — desktop and mobile alike — carries a ⋮ kebab at its bottom-right. Pressing it opens an action sheet (dismissed by pressing outside it, or Escape):

1. **Open in deck builder** — first, the primary action.
2. **Rename**
3. **Duplicate** — creates an editable local copy and selects it.
4. **Delete** — disabled for bundled/AI-owned decks (`source === "preset"`), which are never deletable.

Desktop's duel-start screen additionally exposes Delete/Rename/Duplicate as ordinary footer buttons (see [Desktop layout](#desktop-layout)) acting on the currently-picked deck — the kebab and the footer buttons are two paths to the identical operation, not two different feature sets.

## Desktop hover previews

- **Duel start: floating decklist** — hovering a grid tile floats its full Main/Extra/Side decklist beside the card (flips to the opposite side if it would run off-screen). The panel is sized to the **whole viewport height** minus a small margin, not a fixed short tooltip height — a 90-card maximum-size deck should be visible with minimal or no internal scrolling. Disappears immediately when the pointer leaves the tile.
- **Library: docked panel + card art** — hovering a tile in the library grid previews its list in the docked right panel without moving the actual focus (reverts on mouseout). Hovering a decklist row inside that panel floats a full-size, text-free card-art image near the cursor.

> **Implementation trap already hit once:** a floating panel that sets `display: flex` as an ordinary class rule will stay visually displayed even while its `hidden` attribute is set — an author-origin `display` declaration always beats the browser's built-in `[hidden]{display:none}` rule regardless of specificity. Any new floating/tooltip element needs an explicit `.thing[hidden]{display:none}` override, or must avoid declaring `display` on the bare class at all.

## Opponent selection (free play only)

Story's opponent is fixed by the encounter (portrait, name, deck all locked, with a "🔒 Set by the story" caption on the deck card) — none of this section applies there.

- Free play offers exactly three bundled AI opponents (Practice Bot, Blaze Circuit, Vault Warden), picked from the portrait-triggered picker — same tile grammar as decks (name + line, no stats row).
- Each AI owns exactly one bundled, undeletable deck. Picking a different AI brings its deck along automatically; the opponent's own deck card can still override that pick for one duel by opening opponent-seat-picking mode.

## Keyboard & a11y

- **Preserved shortcuts** — `/` focuses the filter · `↑`/`↓` move the pick among legal decks · `Enter` starts the duel · `f` toggles favourite on the current pick.
- **Contract carried into real code** — every rendered element needs a role-describing `data-cy` per the project's HTML element contract; the prototype's naming (e.g. `` deck-tile-${id} ``, `` deck-tile-menu-${id} ``, `duel-start-opponent-portrait`) is the reference naming to reuse, not to redesign.

Open, undecided in this round: colour is still doing real work here (the red/blue halo pair, the gold default hairline) with no contrast or colour-blind pass done yet — flagged in `PRODUCT.md` as the duel field's own known accessibility debt, and the same caveat now extends to this screen.

## Data model gaps this design assumes get filled

| Gap | Where it bites | Suggested fix |
|---|---|---|
| No cover-art field on a deck record | Every tile's full-bleed illustration | Add `coverCardCode?: number` to `DeckRecord` (`src/decks/deck-contracts.ts`), defaulting to the deck's first Extra card, else its first Main card |
| `aiOwner` (one deck permanently bound to one AI) has no real equivalent | Free-play opponent picker, the 🔒 badge, delete-guarding | Check `src/battle/worker/opponent/` for how opponent AI selection actually works today before assuming a 1:1 mapping |

## Non-goals

- No real Yu-Gi-Oh! card art anywhere in the prototype — every illustration is authored inline SVG geometry, matching story prototype asset policy. The real implementation swaps each placeholder for the cover card's cropped image from the pinned asset snapshot.
- No chosen product-wide visual direction is implied here — this is a refinement of the incumbent `src/styles/tokens.css` world, not an adoption of any of the twenty unselected directions explored elsewhere in `artifacts/`.
- No real deck-builder editor screen exists yet; every "Open"/"Open in deck builder" action in the prototype is a simulated acknowledgement (a tile pulse), not a navigation.

## Real implementation path

This is a design spec, not an implementation plan. Before writing real code:

1. Confirm current contracts with `graphify query`/`graphify explain` against `src/battle/duel/presets/deck-catalog.ts`, `src/decks/deck-library-order.ts` (`orderDeckLibrary`), and `src/decks/deck-contracts.ts` — this design's ordering rule and tile data are meant to extend those, not replace them.
2. The four real screens this replaces span three domains — `src/shell/screens/FreePlayMatchSetup.svelte`, `src/shell/screens/FreePlayDeckSeat.svelte`, `src/story/screens/PreBattleScreen.svelte`, `src/deck-editor/components/DeckLibrary.svelte` — so building it is cross-domain work. Read [ADR-022](ADR/022_ADR_three_ui_modular_monolith_and_worktree_boundaries.md) and the Boundary rules in `AGENTS.md` before any cross-domain import.
3. The full prototype markup/behaviour this document summarizes is recoverable at any time from git history: `git show 7c34d05:artifacts/PROTOTYPE_duel_start_deck_selection.html`.

---

Commit: `7c34d05` — validated prototype snapshot this design was written against · Related: [`deck-selection-architecture.html`](deck-selection-architecture.html) (registry/Worker flow, unaffected by this screen's visual redesign) · [`ADR-054`](ADR/054_ADR_free_play_opens_on_the_seats.md) (free-play seat-entry precedent this extends) · Canonical map: [`architecture/architecture.md`](architecture/architecture.md)
