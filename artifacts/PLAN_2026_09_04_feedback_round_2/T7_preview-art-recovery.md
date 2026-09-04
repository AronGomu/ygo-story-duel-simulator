# T7: Preview art recovery

**Plan:** `./artifacts/PLAN_2026_09_04_feedback_round_2.md`  
**Depends:** none  
**Commit outcome:** Missing card art renders branded placeholder and never poisons later preview images from catalog or deck zones.

## Context (self-contained)

- C1. Goal: Fix sticky missing-image state reported after hovering or adding a card without art.
- C2. This slice: Shared `CardPreviewPanel` failure lifecycle plus Deck Builder transition coverage.
- C3. Out of scope here: Image downloads/cache policy, card tile fallback, Duel image leases, new network fallback.
- C4. Assumptions in force: Placeholder is authored CSS/SVG geometry using brand tokens, offline, with no external asset.

## Requirements

- R1. Valid→missing→valid preview transitions restore `<img>` for latest card.
- R2. Image `error` changes reactive state; code never calls `HTMLElement.remove()` on Svelte-managed DOM.
- R3. Failure is keyed to resolved current image source; a new source clears failed state.
- R4. Missing source and failed source both show same branded placeholder.
- R5. Placeholder carries accessible card context without pretending to be card art.
- R6. Catalog hover, deck-zone hover, and selection fallback use one lifecycle; adding missing card cannot make future art disappear.
- R7. Existing image-library lease acquire/release behavior remains unchanged.

## Inputs

- I1. `src/shell/card-preview/CardPreviewPanel.svelte`, `card-preview-view.ts`.
- I2. `src/deck-editor/components/DeckEditor.svelte` — `previewView`, `previewImageUrl`, empty `placeholderUrl`.
- I3. `src/deck-editor/components/CardTile.svelte` — existing authored fallback visual reference.
- I4. Tests: `tests/component/CardPreviewPanel.test.ts`, `tests/component/deck-editor/card-preview-pane.test.ts`, new missing sequence test.
- I5. **From Depends:** none.

## Interface contract (level 5)

- **Produces:** Reactive state `failedImageUrl: string | null`; derived card-art `resolvedImageUrl: string | null` from leased/static sources only; common placeholder root `data-cy="card-preview-image-placeholder"`, `role="img"`, `aria-label={`Card image unavailable for ${preview.name}`}` for both missing and failed art.
- **Consumes:** Existing props unchanged: `preview`, `imageLibrary`, `placeholderUrl`, `staticImageUrl`. Card-art priority stays leased URL → static URL. `placeholderUrl`, when nonempty, renders inside common semantic placeholder branch rather than becoming card-art source; empty value uses authored brand geometry.
- **Errors:** current image fires `error` → mark only current resolved URL failed and render placeholder; stale error from prior URL cannot hide current URL.
- **Invariants:** one image or one placeholder, never neither for non-null preview; switching `preview.code`/resolved URL resets visible failure; lease releases exactly once on source/library change and destroy; no network fetch added.
- **Integration links:** CardTile hover → `DeckEditor.hovered` → `previewView/staticImageUrl` → `CardPreviewPanel` keyed source → image load/error → reactive image/placeholder branch → next hover source rerenders art; observe DOM selector and src.

## TDD

- [ ] **Red** — Add shared valid→error→new-valid test and editor catalog/deck/add sequence regression; validation: targeted preview cmd fails before impl.
- [ ] **Green** — Replace imperative removal with URL-keyed reactive failure + common placeholder branch; validation: missing and failed art expose identical semantic root and targeted cmd passes.
- [ ] **Refactor** — Reuse existing fallback geometry only if import does not cross domain/deepen API; validation: targeted cmd remains green and boundaries do not widen.

## Test plan

| Test             | Input                                   | Expect                                |
| ---------------- | --------------------------------------- | ------------------------------------- |
| absent source    | preview, `staticImageUrl=null`          | branded placeholder                   |
| failed source    | fire error for URL A                    | placeholder; no detached managed node |
| recovery         | rerender URL B                          | image B visible                       |
| stale event      | URL changes A→B, late A error           | image B remains                       |
| catalog sequence | missing hover→valid hover               | valid art restored                    |
| deck sequence    | missing card added/selected→valid hover | valid art restored                    |
| lease regression | changing codes/destroy                  | prior lease released once             |

## Impl steps

- [ ] 1. Add failing shared and editor sequence tests; validation: current `image.remove()` leaves valid rerender absent.
  - [ ] 1.1 Include stale-error race; validation: event from old src cannot mark new src failed.
- [ ] 2. Implement URL-keyed failure state and placeholder; validation: exactly one art branch renders for non-null preview.
- [ ] 3. Remove empty-placeholder imperative path; validation: source has no `.remove()` and all lease tests pass.
- [ ] 4. Run shared consumers; validation: Duel preview and Deck Builder use unchanged prop API.

## Validation

- [ ] Targeted tests pass: `npx vitest run tests/component/CardPreviewPanel.test.ts tests/component/deck-editor/card-preview-pane.test.ts tests/component/deck-editor/missing-card-placeholder.test.ts`.
- [ ] Shared consumer regressions pass: `npx vitest run tests/component/DuelField.test.ts tests/component/deck-editor/card-tile-art.test.ts`.
- [ ] Static gates pass: `npm run typecheck && npm run lint && npm run format:check`.
- [ ] Manual check: hover missing catalog card, valid catalog card, missing deck card, valid deck card; placeholder/art always follows latest card.
- [ ] No silent-failure swallow on a path this slice adds — `none`; `onerror` is explicit state transition.
- [ ] App functional — preview text/stats/scroller and image leases remain intact.
- [ ] Commit msg draft: `fix(preview): let card art recover after a missing image`.
