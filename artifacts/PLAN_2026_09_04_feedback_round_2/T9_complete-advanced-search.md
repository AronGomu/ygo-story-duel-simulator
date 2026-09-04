# T9: Complete advanced search

**Plan:** `./artifacts/PLAN_2026_09_04_feedback_round_2.md`  
**Depends:** T5, T6, T8  
**Commit outcome:** Approved Variant A advanced search ships as one complete live, engine-data-backed workspace overlay with full tests, perf budget, and Chromium acceptance.

## Context (self-contained)

- C1. Goal: Implement `docs/feature/PROTOTYPE_advanced_card_search.html` against real catalog data.
- C2. This slice: One vertical production feature: trigger → complete supported query → live result count/grid → reset/apply/close → focus restore.
- C3. Out of scope here: Archetype names, other formats/dates, set/product, rarity, release date, community signal, query persistence, new deps, runtime catalog schema expansion.
- C4. Assumptions in force: Production starts closed; catalog name owns entry focus. Comfortable Variant A, `0.34` veil, live apply, exact workspace bounds, unavailable cards excluded, stable Name A–Z are binding. Unsupported metadata is omitted separately.

## Requirements

- R1. `Advanced Search` trigger replaces former sideboard header slot; dialog starts closed.
- R2. Dialog overlays exact `deck-workspace` rect inside center grid cell; preview/catalog/header remain visible; `0.34` workspace veil blocks center pointer input.
- R3. Dialog is modal/keyboard trapped; open focuses close; Escape/Close/Apply close and restore exact trigger; Reset stays open.
- R4. Every edit applies live to catalog result count/grid; Apply commits nothing extra and closes.
- R5. Reset restores defaults; no rollback on close because apply mode is live.
- R6. Supported Words: shared card name + match mode, card text grammar, decimal passcode.
- R7. Supported Identity/Mechanics: family, attribute, race, summon frame, traits, spell/trap property, Link marker rule/markers.
- R8. Supported Stats: ATK, DEF, Level/Rank, Link Rating, Pendulum Scale with exact operators/ranges from approved prototype.
- R9. Supported Legality/availability: current pinned restriction `0|1|2|3`; every result must satisfy `availableCopies(...) > 0`.
- R10. Results always sort English name ascending, stable code tie-break; unavailable and unsupported fields/options never appear.
- R11. Existing quick name/types remain active; advanced criteria combine with them via AND.
- R12. 15k-card index builds once per card list; typing never rebuilds index; query/perf/build budgets pass.
- R13. Every rendered element has unique role-based `data-cy`; no raw colors/new pkg.

## Inputs

- I1. **From T5:** DOM anchor `[data-cy="deck-workspace"]` remains stable, occupies center deck pane, and its measured `getBoundingClientRect()` is authoritative overlay target.
- I2. **From T6:** `[data-cy="deck-catalog-to-sideboard-field"]` is absent; `[data-cy="deck-catalog-header"]` retains result count plus free action slot; initial editor mount focuses `[data-cy="deck-catalog-name-input"]`.
- I3. **From T8:** Import exact symbols `CatalogTypeCategory`, `CatalogTypeTag`, `DeckCatalogFilters`, `catalogTypeOptions`, `cardMatchesCatalogType` from `src/decks/catalog/deck-catalog.ts`; quick filtering requires `filters.types.every(tag => cardMatchesCatalogType(card, tag))`; rewritten markup retains `[data-cy="deck-catalog-name-input"]` focus target.
- I4. `src/decks/catalog/ocg-card-mapper.ts` — supported `DeckBuilderCardView` fields.
- I5. `src/decks/catalog/pinned-ruleset.ts`; `src/deck-editor/catalog-availability.ts`.
- I6. `src/deck-editor/components/CardCatalog.svelte`, `DeckEditor.svelte`, `focus-trap.ts`.
- I7. `docs/feature/PDDR-advanced_card_search.md`, approved prototype HTML.
- I8. Catalog unit/perf/wiring/ownership tests; new dialog component tests; `e2e/deck-editor.spec.ts`.

## Interface contract (level 5)

- **Produces:**

```ts
export type NameMatch = "contains" | "exact" | "starts-with" | "exclude";
export type NumericOperator = "range" | "eq" | "lt" | "lte" | "gt" | "gte";
export type NumericCriterion =
  | Readonly<{ op: "range"; min: number | null; max: number | null }>
  | Readonly<{ op: Exclude<NumericOperator, "range">; value: number }>;
export type LinkMarkerRule = "any" | "all" | "exact";
export interface AdvancedDeckCatalogFilters {
  readonly nameMatch: NameMatch;
  readonly text: string;
  readonly code: string;
  readonly family: "monster" | "spell" | "trap" | null;
  readonly attribute: string | null;
  readonly race: string | null;
  readonly summonFrame:
    | "Normal"
    | "Effect"
    | "Ritual"
    | "Fusion"
    | "Synchro"
    | "Xyz"
    | "Pendulum"
    | "Link"
    | null;
  readonly traits: readonly (
    "Tuner" | "Flip" | "Gemini" | "Spirit" | "Toon" | "Union"
  )[];
  readonly attack: NumericCriterion | null;
  readonly defense: NumericCriterion | null;
  readonly levelRank: NumericCriterion | null;
  readonly linkRating: NumericCriterion | null;
  readonly pendulumScale: NumericCriterion | null;
  readonly includeUnknownAttackDefense: boolean;
  readonly spellProperty:
    | "Normal"
    | "Continuous"
    | "Equip"
    | "Field"
    | "Quick-Play"
    | "Ritual"
    | null;
  readonly trapProperty: "Normal" | "Continuous" | "Counter" | null;
  readonly linkMarkerRule: LinkMarkerRule;
  readonly linkMarkers: readonly string[];
  readonly restriction: 0 | 1 | 2 | 3 | null;
}
export interface DeckCatalogQuery extends DeckCatalogFilters {
  readonly advanced: AdvancedDeckCatalogFilters;
}
export const EMPTY_ADVANCED_DECK_CATALOG_FILTERS: AdvancedDeckCatalogFilters;
export function filterDeckCatalog(
  cards: readonly DeckBuilderCardView[],
  query: DeckCatalogQuery,
  isAvailable: (card: DeckBuilderCardView) => boolean,
): readonly DeckBuilderCardView[];
export function filterDeckCatalogIndex(
  index: DeckCatalogIndex,
  query: DeckCatalogQuery,
  isAvailable: (card: DeckBuilderCardView) => boolean,
): readonly DeckBuilderCardView[];
```

`AdvancedCardSearch.svelte` props: `filters`, `options`, `resultCount`, `onchange(filters)`, `onreset()`, `onclose()`.

- **Consumes:** quick `name/types`; `DeckBuilderCardView` fields only; `quantityLimit(ruleset,code)`, `availableCopies(code,ownership,limit,copies)`; `handleModalKeydown`.
- **Errors:** invalid code input ignored by predicate until exactly 8 digits; invalid/incomplete numeric criterion matches no cards and exposes associated inline error `Enter a valid value.`; inverted range exposes `Minimum must not exceed maximum.`; unmatched text quote is treated as literal remaining token, never throw.
- **Invariants:** all quick/advanced predicates AND; text grammar = whitespace tokens AND, quoted phrase literal, `-token` exclusion; name case-insensitive by mode; code exact at 8 digits; unknown ATK/DEF is negative engine value and included only when toggle checked plus criterion matches; Level/Rank checks only matching labels; Link checks Link only; Pendulum criterion matches either scale; marker any=intersection, all=selected subset, exact=set equality; restriction maps `quantityLimit`; availability always true requirement; output pre-sorted `name.localeCompare(other,"en",{sensitivity:"base"})`, code ascending tie-break.
- **Integration links:** trigger `CardCatalog` → parent `DeckEditor` opens overlay in workspace grid cell → dialog emits complete filters → one prebuilt `DeckCatalogIndex` + availability fn → live frozen results/count/window → existing CardTile grid → Close/Apply restores trigger focus. Outside modal controls inert while open; observe exact bounding rect equality + result mutation in Chromium.

## TDD

- [ ] **Red** — Add complete pure oracle/index matrix, parser/operator/availability/sort tests, dialog tests, perf and Chromium geometry tests; validation: targeted pure/component/Playwright cmds fail before impl.
- [ ] **Green** — Implement one query module/index extension and one production dialog with shared state; validation: targeted cmds pass.
- [ ] **Refactor** — Pre-sort/index normalized text/facets only where perf evidence requires; validation: index build <2.5ms, name query <1.5ms, worst supported combined query <5ms best-of-20 at 15k.

## Test plan

| Test         | Input                                       | Expect                                                                 |
| ------------ | ------------------------------------------- | ---------------------------------------------------------------------- |
| name modes   | `Dark`, each mode                           | contains/exact/prefix/exclude exact sets                               |
| text grammar | tokens, quote, negative, unmatched quote    | documented AND/literal/exclude behavior                                |
| passcode     | partial/non-digit/8-digit                   | only exact valid code filters                                          |
| identity     | each supported family/attr/race/frame/trait | correct set; irrelevant family returns zero                            |
| numeric      | every op, bound, null, inverted, unknown    | exact validation/match behavior                                        |
| markers      | any/all/exact                               | set algebra exact                                                      |
| restriction  | limits 0/1/2/3                              | exact current ruleset mapping                                          |
| availability | owned/ruleset/copies combinations           | unavailable cards always absent                                        |
| combined     | quick tags + several advanced criteria      | all predicates AND                                                     |
| sort         | case/tie names                              | stable English Name A–Z/code tie                                       |
| dialog       | open, Tab loop, Escape, Close, Apply, Reset | live state; focus contract; no rollback                                |
| exclusions   | rendered dialog                             | no archetype/format/date/set/rarity/community controls                 |
| geometry     | desktop supported matrix                    | dialog rect equals workspace ≤1px; veil opacity `0.34`                 |
| performance  | 15k worst supported combined query          | index build <2.5ms; name <1.5ms; combined <5ms, best-of-20; no rebuild |

## Impl steps

- [ ] 1. Add failing pure query/index tests covering every field/operator/invariant; validation: current filter API cannot compile against `DeckCatalogQuery`.
  - [ ] 1.1 Inspect packaged negative ATK/DEF values and pin fixtures; validation: unknown-stat behavior uses observed values, not guessed constant.
  - [ ] 1.2 Add differential generated-query test; validation: index output equals reference output/order.
- [ ] 2. Add failing dialog/component tests and Chromium geometry/focus tests; validation: absent trigger/dialog makes red.
- [ ] 3. Implement advanced types/defaults/parsers/reference predicate; validation: pure tests pass before UI wiring.
- [ ] 4. Extend index with pre-normalized descriptions and Name A–Z order; validation: one-build wiring and perf tests pass.
- [ ] 5. Build complete Variant A `AdvancedCardSearch.svelte`; validation: every supported field works, unsupported controls absent, all elements `data-cy`-valid.
- [ ] 6. Wire closed-by-default trigger/overlay/live query/reset/focus restore; validation: catalog name retains entry focus until trigger click.
- [ ] 7. Enforce unavailable exclusion from real ownership/ruleset/copies; validation: story/free-play/capped fixtures expose no unavailable result.
- [ ] 8. Validate exact workspace bounds, `0.34` veil, responsive fallback, build bytes; validation: Chromium + `build:verify` green.
- [ ] 9. Honor `docs/feature/PDDR-advanced_card_search.md` Decision 21; validation: production starts closed for catalog-name focus while evaluator remains open by default.

## Validation

- [ ] Pure/perf tests pass: `npx vitest run tests/unit/decks/deck-catalog.test.ts tests/unit/decks/deck-catalog-index.test.ts tests/unit/decks/deck-catalog-performance.test.ts`.
- [ ] Component tests pass: `npx vitest run tests/component/deck-editor/advanced-card-search.test.ts tests/component/deck-editor/card-catalog.test.ts tests/component/deck-editor/catalog-index-wiring.test.ts tests/component/deck-editor/owned-only-catalog.test.ts tests/component/deck-editor/deck-editor-a11y.test.ts`.
- [ ] Browser acceptance passes: `npx playwright test e2e/deck-editor.spec.ts --grep "advanced search"`.
- [ ] Boundaries/build pass: `npx vitest run tests/unit/data-cy-coverage.test.ts tests/unit/domain-boundaries.test.ts && npm run build:verify`.
- [ ] Full headless gate passes: `npm run check:headless`.
- [ ] Manual check: name entry focus; open dialog; use every supported group; watch live grid/count; reset; Apply/Close/Escape; inspect unavailable exclusion and exact bounds.
- [ ] No silent-failure swallow on a path this slice adds — `none`.
- [ ] App functional — catalog windowing, hover, add, ownership, quick tags, workspace remain green.
- [ ] Commit msg draft: `feat(deck-editor): turn approved advanced search into one live catalog query`.
