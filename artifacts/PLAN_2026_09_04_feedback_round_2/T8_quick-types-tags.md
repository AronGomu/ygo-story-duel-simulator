# T8: Quick Types tags

**Plan:** `./artifacts/PLAN_2026_09_04_feedback_round_2.md`  
**Depends:** T6  
**Commit outcome:** Four catalog selects become one validated keyboard-accessible Types tag input whose propositions all combine with AND.

## Context (self-contained)

- C1. Goal: Replace crowded family/subtype/attribute/race controls with one compact exact-proposition filter.
- C2. This slice: Pure quick-filter contract/index plus complete combobox/tag UI; freed filter height yields more visible result rows.
- C3. Out of scope here: Advanced Search dialog/facets, persisted search, fuzzy values, OR groups.
- C4. Assumptions in force: Every accepted tag adds a strict predicate; label collisions retain category identity; invalid/duplicate input never commits. Visible Name and Types labels are removed, accessible names remain.

## Requirements

- R1. Remove Card type, Subtype, Attribute, Monster type selects and visible labels.
- R2. Render Name search and Types input using placeholders plus `aria-label`; no visual label text.
- R3. Suggestions contain actual families, subtypes, attributes, and races from loaded cards only.
- R4. Typed filter narrows suggestions case-insensitively; only Enter on active exact suggestion or suggestion click commits.
- R5. Each tag is removable; duplicate category/value never adds twice; Backspace on empty input removes last tag.
- R6. ArrowDown/ArrowUp changes active option; Enter commits; Escape closes list; Tab follows native focus order.
- R7. Results require every tag predicate; contradictory tags return zero.
- R8. Indexed prod filter equals reference oracle and keeps one-build-per-card-list behavior.
- R9. Replacing four select rows with one Types input yields at least one additional complete catalog result row at deterministic 1440×810 fixture.
- R10. Rewritten filter markup preserves T6 entry focus on `[data-cy="deck-catalog-name-input"]`.

## Inputs

- I1. `src/decks/catalog/deck-catalog.ts`, `deck-catalog-index.ts`, `ocg-card-mapper.ts`.
- I2. `src/deck-editor/components/CardCatalog.svelte`; new `CatalogTypeInput.svelte`.
- I3. `tests/unit/decks/deck-catalog.test.ts`, `deck-catalog-index.test.ts`, `deck-catalog-performance.test.ts`.
- I4. `tests/component/deck-editor/card-catalog.test.ts`, `catalog-index-wiring.test.ts`, new type-input test, `deck-editor-a11y.test.ts`.
- I5. **From T6:** `[data-cy="deck-catalog-to-sideboard-field"]` is absent; `[data-cy="deck-catalog-header"]` retains result count plus free action slot; initial editor mount focuses `[data-cy="deck-catalog-name-input"]`. T8 must preserve these exact behaviors.

## Interface contract (level 5)

- **Produces:** Handoff contract: exports exact `CatalogTypeCategory`, `CatalogTypeTag`, `DeckCatalogFilters`, `catalogTypeOptions`, and `cardMatchesCatalogType` symbols below; filter markup retains `[data-cy="deck-catalog-name-input"]` focus target and frees enough vertical space for ≥1 extra complete row at 1440×810.

```ts
export type CatalogTypeCategory = "family" | "subtype" | "attribute" | "race";
export interface CatalogTypeTag {
  readonly id: `${CatalogTypeCategory}:${string}`;
  readonly category: CatalogTypeCategory;
  readonly value: string;
  readonly label: string;
}
export interface DeckCatalogFilters {
  readonly name: string;
  readonly types: readonly CatalogTypeTag[];
}
export function catalogTypeOptions(
  cards: readonly DeckBuilderCardView[],
): readonly CatalogTypeTag[];
export function cardMatchesCatalogType(
  card: DeckBuilderCardView,
  tag: CatalogTypeTag,
): boolean;
```

`CatalogTypeInput.svelte` props: `options: readonly CatalogTypeTag[]`, `value: readonly CatalogTypeTag[]`, `onchange: (value: readonly CatalogTypeTag[]) => void`.

- **Consumes:** `DeckBuilderCardView.family`, `.subtypes`, `.attribute`, `.race`; family labels displayed `Monster`, `Spell`, `Trap`; existing result-window/index lifecycle.
- **Errors:** invalid free text → no state change; duplicate id → no state change; no suggestions → list closes/empty status `No matching types`; no exception.
- **Invariants:** option order category `family`, `subtype`, `attribute`, `race`, then `left.label.localeCompare(right.label, "en")`, then `left.id.localeCompare(right.id, "en")`; ids unique; `filters.types.every(tag => cardMatchesCatalogType(card,tag))`; arrays frozen at pure-data boundary; Name remains contains/case-insensitive.
- **Integration links:** user input → combobox suggestion from `catalogTypeOptions(cards)` → validated `CatalogTypeTag` → `DeckCatalogFilters.types` → `filterDeckCatalogIndex` AND loop → result count/grid → removable tag restores result set.

## TDD

- [ ] **Red** — Change oracle/index tests to new shape, add AND/options/UI/focus/density tests; validation: targeted unit/component/Playwright cmds fail before impl.
- [ ] **Green** — Implement tag types/options/matcher/index plus component/CardCatalog wiring; validation: targeted cmds pass and focus/density contracts hold.
- [ ] **Refactor** — Precompute per-card facet sets only if perf evidence requires; validation: index build <2.5ms, name query <1.5ms, multi-tag query <2.5ms best-of-20 at 15k.

## Test plan

| Test               | Input                             | Expect                                                         |
| ------------------ | --------------------------------- | -------------------------------------------------------------- |
| cross-category AND | DARK + Spellcaster                | only cards matching both                                       |
| contradictory AND  | Monster + Spell                   | zero                                                           |
| same-category AND  | Fusion + Effect                   | cards carrying both subtypes                                   |
| options            | duplicate values/cards            | stable unique category-aware tags                              |
| invalid commit     | arbitrary text + Enter            | no tag/no filter change                                        |
| duplicate commit   | same suggestion twice             | one tag                                                        |
| keyboard           | arrows, Enter, Escape, Backspace  | active commit/close/remove behavior                            |
| labels             | rendered catalog                  | no visible Name/Types label; accessible inputs                 |
| index parity       | generated cards/filter sets       | prod equals oracle                                             |
| perf               | 15k cards, multiple tags          | index build <2.5ms; name <1.5ms; multi-tag <2.5ms, best-of-20  |
| density/focus      | 1440×810 editor after replacement | ≥1 extra complete row; card-name input remains active on entry |

## Impl steps

- [ ] 1. Write failing pure-data tests against exact interfaces; validation: current scalar filters fail compile/tests.
- [ ] 2. Write failing component tests for suggestion validation/tags/keyboard/a11y; validation: current four selects fail absence assertions.
- [ ] 3. Implement pure options/matcher/reference/index contract; validation: differential + generated contradiction tests pass.
- [ ] 4. Build `CatalogTypeInput.svelte`; validation: native input/list semantics, unique `data-cy`, keyboard tests pass.
- [ ] 5. Replace four selects and visible labels in `CardCatalog`; validation: result count/grid update under all-tags-AND.
- [ ] 6. Preserve one index build and result-window reset key; validation: build <2.5ms, name <1.5ms, multi-tag <2.5ms best-of-20 at 15k, no rebuild per keystroke/tag.
- [ ] 7. Add deterministic 1440×810 density/focus browser assertion; validation: at least one extra complete result row and name input owns entry focus.

## Validation

- [ ] Pure tests pass: `npx vitest run tests/unit/decks/deck-catalog.test.ts tests/unit/decks/deck-catalog-index.test.ts tests/unit/decks/deck-catalog-performance.test.ts`.
- [ ] Component tests pass: `npx vitest run tests/component/deck-editor/catalog-type-input.test.ts tests/component/deck-editor/card-catalog.test.ts tests/component/deck-editor/catalog-index-wiring.test.ts tests/component/deck-editor/deck-editor-a11y.test.ts`.
- [ ] Browser density/focus passes: `npx playwright test e2e/deck-editor.spec.ts --grep "quick Types density|card-name entry focus"`.
- [ ] Selector/boundary tests pass: `npx vitest run tests/unit/data-cy-coverage.test.ts tests/unit/domain-boundaries.test.ts`.
- [ ] Static gates pass: `npm run typecheck && npm run lint && npm run format:check`.
- [ ] Manual check: type partial proposition, keyboard commit, click commit, invalid Enter, duplicate, Backspace/remove, contradictory tags.
- [ ] No silent-failure swallow on a path this slice adds — `none`.
- [ ] App functional — infinite result window, selection, hover, add, empty state remain green.
- [ ] Commit msg draft: `feat(deck-editor): compress quick card filters into strict type tags`.
