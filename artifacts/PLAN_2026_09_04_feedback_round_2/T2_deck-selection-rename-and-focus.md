# T2: Deck-selection rename and focus

**Plan:** `./artifacts/PLAN_2026_09_04_feedback_round_2.md`  
**Depends:** none  
**Commit outcome:** Deck-name press opens rename, deck filter owns entry focus, and exact sibling names are rejected before host callback.

## Context (self-contained)

- C1. Goal: Make shared deck selection faster and prevent exact duplicate rename submissions in UI.
- C2. This slice: Shared `src/deck-select/` only; all manageable hosts inherit behavior.
- C3. Out of scope here: DB constraint, repository validation, create-name semantics, case-insensitive matching, story pre-battle management.
- C4. Assumptions in force: `RenameDeckDialog` trims before submit; comparison is exact/case-sensitive against stored sibling `DeckTileModel.name`; whitespace-only differences disappear through trim; bundled and local sibling names both count.

## Requirements

- R1. Clicking/keyboard-activating deck name opens rename dialog and does not select/open tile body.
- R2. Tile body press/double-press, kebab, default star, halos, and non-manageable story rendering remain unchanged.
- R3. `DeckSelectScreen` focuses `data-cy="deck-select-filter"` on initial mount.
- R4. Rename blocks trimmed candidate equal to another tile name by `===`; current tile name is excluded.
- R5. Duplicate error is visible, associated to input, announced, and blocks mouse/keyboard/form submission.
- R6. Validation stays inside shared UI; `onrename: (key: string, name: string) => void` remains host boundary.

## Inputs

- I1. `src/deck-select/DeckTile.svelte`, `DeckSelectScreen.svelte`, `RenameDeckDialog.svelte`.
- I2. `src/deck-select/deck-select-contracts.ts` — `DeckTileModel.key/name`.
- I3. Hosts: `src/deck-editor/components/DeckLibrary.svelte`, `src/shell/screens/FreePlayMatchSetup.svelte`, `src/story/screens/PreBattleScreen.svelte`.
- I4. Tests: `tests/component/deck-select/deck-tile.test.ts`, `deck-select-screen.test.ts`, `deck-dialogs.test.ts`, `tests/unit/data-cy-coverage.test.ts`.
- I5. **From Depends:** none.

## Interface contract (level 5)

- **Produces:** `DeckTile.svelte` prop `export let onrename: (() => void) | null = null;`; `RenameDeckDialog.svelte` prop `export let unavailableNames: readonly string[] = [];`; error copy exact: `A deck with this name already exists.`; error node `id="deck-select-rename-error"` and `data-cy="deck-select-rename-error"`.
- **Consumes:** `DeckSelectScreen` existing `tiles: readonly DeckTileModel[]`, `manageable: boolean`, `onrename: (key: string, name: string) => void`; `RenameDeckDialog` existing trimmed `onsubmit(name)`.
- **Errors:** empty trimmed name keeps submit disabled with existing behavior; duplicate sets `aria-invalid="true"`, `aria-describedby="deck-select-rename-error"`, renders exact error, and emits no callback.
- **Invariants:** candidate comparison is `unavailableNames.includes(name.trim())`; case variants remain allowed; current key omitted from unavailable list; no nested `<button>`; every rendered element has unique `data-cy`.
- **Integration links:** name button `DeckTile.svelte` → `onrename()` → `DeckSelectScreen.renaming=tile.key` → `RenameDeckDialog` validates sibling names → `onrename(key,name)` → existing host persistence callback → refreshed tile name. Duplicate stops before host callback; observable error remains in dialog.

## TDD

- [ ] **Red** — Add name-button event isolation, initial focus, exact duplicate/error/a11y tests; validation: targeted component cmd fails before impl.
- [ ] **Green** — Add nullable tile rename callback, sibling-name dialog contract, mount focus; validation: targeted component cmd passes.
- [ ] **Refactor** — Share one `openRename(key)` fn between name, footer, kebab; validation: targeted cmd remains green and callback boundary stays unchanged.

## Test plan

| Test                | Input                                    | Expect                                    |
| ------------------- | ---------------------------------------- | ----------------------------------------- |
| name activation     | manageable tile name click/Enter         | rename opens; `onpress` not called        |
| non-manageable tile | `onrename=null`                          | name is noninteractive; tile body works   |
| entry focus         | mount screen                             | `document.activeElement` is deck filter   |
| exact duplicate     | sibling `Alpha`, candidate `Alpha`       | error shown; submit disabled; no callback |
| case variant        | sibling `Alpha`, candidate `alpha`       | callback receives `alpha`                 |
| own unchanged name  | current tile `Alpha`, no sibling `Alpha` | not treated as duplicate                  |
| trimmed collision   | sibling `Alpha`, candidate `Alpha`       | exact error after trim                    |

## Impl steps

- [ ] 1. Write failing tile/dialog/screen tests; validation: targeted cmd fails for missing name action, focus, duplicate guard.
  - [ ] 1.1 Add keyboard + event-isolation assertions; validation: body callback count stays zero after name activation.
  - [ ] 1.2 Add `aria-invalid`/`aria-describedby` assertions; validation: exact error is input-associated.
- [ ] 2. Add sibling name button without nesting interactive controls; validation: tile semantics and `data-cy` uniqueness pass.
  - [ ] 2.1 Pass callback only when `manageable`; validation: story/non-manageable fixture exposes no rename button.
- [ ] 3. Add `unavailableNames` duplicate guard and mount filter focus; validation: duplicate never reaches `onrename`, unique candidate does.
- [ ] 4. Run host regressions; validation: Deck Library and Free Play persistence tests remain green without host API changes.

## Validation

- [ ] Targeted tests pass: `npx vitest run tests/component/deck-select/deck-tile.test.ts tests/component/deck-select/deck-dialogs.test.ts tests/component/deck-select/deck-select-screen.test.ts tests/component/deck-editor/deck-library.test.ts tests/component/FreePlayMatchSetup.test.ts`.
- [ ] Boundary/selector tests pass: `npx vitest run tests/unit/data-cy-coverage.test.ts tests/unit/domain-boundaries.test.ts`.
- [ ] Static gates pass: `npm run typecheck && npm run lint && npm run format:check`.
- [ ] Manual check: enter each manageable deck-select host, type immediately in focused filter, rename by clicking name, verify exact duplicate error.
- [ ] No silent-failure swallow on a path this slice adds — `none`.
- [ ] App functional — tile selection/open/default/menu behavior unchanged.
- [ ] Commit msg draft: `fix(deck-select): make rename direct without admitting duplicate names`.
