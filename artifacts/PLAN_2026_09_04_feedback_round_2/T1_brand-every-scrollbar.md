# T1: Brand every scrollbar

**Plan:** `./artifacts/PLAN_2026_09_04_feedback_round_2.md`  
**Depends:** none  
**Commit outcome:** Every visible native scrollbar uses Basilica Slate chrome while existing `OverlayScrollbar` hosts still render exactly one custom thumb.

## Context (self-contained)

- C1. Goal: Remove browser-default scrollbar appearance across all app domains.
- C2. This slice: Establish global native scrollbar contract plus regression inventory; preserve custom overlay scrollbars.
- C3. Out of scope here: Scroll-container geometry, Deck Builder overflow bug, new scrollbar component, route behavior.
- C4. Assumptions in force: No user setup, acct, key, pkg install, migration, or external svc exists; begin impl directly. Existing `scrollbar-width: none`/`::-webkit-scrollbar { display: none; }` rules identify hosts where `OverlayScrollbar` replaces native chrome.

## Requirements

- R1. Every visible native vertical/horizontal scrollbar uses brand track, thumb, border, hover, active styling from `src/styles/tokens.css`.
- R2. No raw color literal enters `src/styles/app.css`; `tests/unit/global-styles.test.ts` token rule stays green.
- R3. Native scrollbars hidden for `CardPreviewPanel`, `CardCatalog`, Duel hand bands, and any other `OverlayScrollbar` host stay hidden.
- R4. Keyboard, wheel, track click, and thumb drag behavior remains native where native chrome remains visible.
- R5. `forced-colors: active` keeps platform scrollbar behavior; brand rules must not hide native chrome there.

## Inputs

- I1. `src/styles/tokens.css` — `--scrollbar-thumb`, surface/border tokens.
- I2. `src/styles/app.css` — global selectors, zone-list native scrollbar, hidden custom-overlay hosts.
- I3. `src/shell/card-preview/OverlayScrollbar.svelte` — custom track/thumb contract.
- I4. `src/deck-editor/components/CardCatalog.svelte` — scoped native-hide contract.
- I5. `tests/unit/global-styles.test.ts`, `tests/component/OverlayScrollbar.test.ts`, `tests/component/deck-editor/catalog-scrollbar.test.ts`.
- I6. **From Depends:** none.

## Interface contract (level 5)

- **Produces:** CSS custom props `--scrollbar-track`, `--scrollbar-thumb`, `--scrollbar-thumb-hover`, `--scrollbar-thumb-active`, `--scrollbar-border`; global selectors `* { scrollbar-color: var(--scrollbar-thumb) var(--scrollbar-track); scrollbar-width: thin; }`, `*::-webkit-scrollbar`, `*::-webkit-scrollbar-track`, `*::-webkit-scrollbar-thumb`, `*::-webkit-scrollbar-thumb:hover`, `*::-webkit-scrollbar-thumb:active`.
- **Consumes:** Existing per-host `scrollbar-width: none` plus `::-webkit-scrollbar { display: none; }` rules. Cascade must leave those declarations effective.
- **Errors:** none; CSS-only contract. Browser acceptance failure text uses test name `every visible native scrollbar uses Basilica Slate chrome`.
- **Invariants:** `body` remains `overflow: hidden`; no second native thumb appears beside `[data-cy$="-scrollbar"]`; scrollbar colors come only from tokens; reduced-motion behavior unchanged.
- **Integration links:** overflow owner `{component CSS overflow:auto|scroll}` → browser native scrollbar pseudo-elements → global tokenized CSS → observe Chromium screenshot/computed style plus one-thumb DOM assertion. Custom owner `{CardCatalog|CardPreviewPanel|HandBand}` → hidden native rail → `OverlayScrollbar.svelte` → observe one `[data-cy$="-scrollbar-thumb"]`.

## TDD

- [ ] **Red** — Add global-style/native-hide tests plus Chromium route sweep; validation: targeted Vitest/Playwright cmds fail before global contract.
- [ ] **Green** — Add minimum tokens/global rules; validation: targeted Vitest/Playwright cmds pass with custom-overlay hosts unchanged.
- [ ] **Refactor** — Deduplicate only rules made byte-equivalent; validation: targeted cmds remain green and scrollbar inventory stays complete.

## Test plan

| Test                    | Input                                                      | Expect                                                                |
| ----------------------- | ---------------------------------------------------------- | --------------------------------------------------------------------- |
| global CSS contract     | `tokens.css`, `app.css` source                             | All five tokens and native pseudo-state selectors exist; no raw color |
| overlay host regression | preview, catalog, hand with overflow                       | Native rail hidden; one custom thumb rendered                         |
| native route sweep      | overflowing dialogs/lists across shell, duel, decks, story | Track/thumb use brand colors; no default rail                         |
| forced colors           | Chromium forced-colors emulation where supported           | Native scrollbar remains operable and visible                         |

## Impl steps

- [ ] 1. Add failing style and overlay-host tests; verify target Vitest cmd fails on missing global contract.
  - [ ] 1.1 Inventory every `overflow: auto|scroll`, `scrollbar-*`, and `::-webkit-scrollbar` site; validation: inventory assertions name all intentional native-hide exceptions.
  - [ ] 1.2 Add Chromium test fixture with guaranteed overflow; validation: pre-change screenshot/computed-style assertion fails.
- [ ] 2. Add scrollbar tokens and global native rules; validation: new unit tests pass with zero raw color in `app.css`.
  - [ ] 2.1 Preserve custom-overlay native-hide specificity; validation: catalog/preview/hand each expose one custom thumb only.
  - [ ] 2.2 Add `forced-colors` override; validation: rule restores platform-compatible colors rather than hiding chrome.
- [ ] 3. Run browser route sweep; validation: no visible default scrollbar remains on reachable overflow surfaces.

## Validation

- [ ] Targeted tests pass: `npx vitest run tests/unit/global-styles.test.ts tests/component/OverlayScrollbar.test.ts tests/component/deck-editor/catalog-scrollbar.test.ts`.
- [ ] Browser check passes: `npx playwright test e2e/scrollbar-brand.spec.ts`.
- [ ] Static gates pass: `npm run typecheck && npm run lint && npm run format:check`.
- [ ] Manual check: Chromium desktop + narrow viewport; wheel, keyboard, track click, thumb drag; exactly one thumb on custom-overlay hosts.
- [ ] No silent-failure swallow on a path this slice adds — `none`.
- [ ] App functional — shell, duel, deck, story overflow surfaces remain scrollable.
- [ ] Commit msg draft: `style(shell): make every visible scrollbar belong to Basilica Slate`.
