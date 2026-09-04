# PDDR: advanced_card_search

## Decision 1: Prototype scope

- CHOSEN: Desktop-first advanced card-search dialog inside mocked current deck editor.
- WHY: Request asks filter interaction/structure validation before production impl.
- NOT CHOSEN: Production Svelte, catalog-index changes, real card queries, mobile flow.
- PARAMS: Standalone HTML; mocked 14,551-card catalog; no real mutation.
- DATE: 2026-09-04

## Decision 2: UI branch + host

- CHOSEN: UI branch; standalone evaluator mirrors existing 3-pane editor.
- WHY: Existing app is plausible host, but prototype route changes would touch prod code. Standalone copy answers placement question without runtime risk.
- NOT CHOSEN: Logic prototype; integrated route; generic detached modal.
- PARAMS: 1440 × 810 px desktop stage; incumbent columns 210 px / fluid workspace / min 280 px catalog.
- DATE: 2026-09-04

## Decision 3: Dialog geometry

- CHOSEN: Dialog uses exact `deck-workspace` grid cell and `inset: 0`.
- WHY: Satisfies same-position, same-width, same-height req; keeps catalog trigger visible.
- NOT CHOSEN: Viewport-centered modal; drawer; catalog-column expansion.
- PARAMS: `position: absolute`; center grid column; 0 px inset; 1 px gold edge; 34% workspace veil default.
- DATE: 2026-09-04

## Decision 4: Trigger replacement

- CHOSEN: Small `Advanced Search` button occupies former `To sideboard` header position.
- WHY: Direct match to req; result count remains left-aligned.
- NOT CHOSEN: Keep checkbox; move trigger under name; icon-only trigger.
- PARAMS: 30 px min height; text label; persistent while dialog opens.
- DATE: 2026-09-04

## Decision 5: Filter inventory

- CHOSEN: Prototype covers text, identity, mechanics, numeric stats, Link markers, legality, dates, print metadata, ownership, discovery signals.
- WHY: Cross-product research shows these as useful union, not one competitor's exact copy.
- NOT CHOSEN: Basic current five fields only; API-param dump; metagame popularity treated as rules authority.
- PARAMS: Name/match mode; card text; archetype; passcode/Konami ID; family; attribute; monster type; summon frame; Tuner/Flip/Gemini/Spirit/Toon/Union; ATK; DEF; unknown stats; Level/Rank; Link Rating; Pendulum Scale; Spell property; Trap property; 8 Link markers with any/all/exact semantics; format; restriction; list date; release window; owned-only; addable-only; set/product; rarity; sort; optional community signal.
- DATE: 2026-09-04

## Decision 6: Numeric operators

- CHOSEN: Equality, inequalities, bounded ranges.
- WHY: Deck searches often encode effect thresholds such as `ATK <= 1500`; equality-only APIs are insufficient UX.
- NOT CHOSEN: Exact value only; two unlabeled number boxes.
- PARAMS: `=`, `<`, `<=`, `>=`, `>`, range; explicit min/max placeholders; unknown-value toggle.
- DATE: 2026-09-04

## Decision 7: Evaluation variants

- CHOSEN: Three structurally different variants remain open for review.
- WHY: Search density, discoverability, expert speed trade against each other.
- NOT CHOSEN: Color-only alternates; final variant before user review.
- PARAMS: `VariantA` Filter Matrix; `VariantB` Facet Navigator; `VariantC` Query Composer; URL `?variant=A|B|C`; Left/Right keys.
- DATE: 2026-09-04

## Decision 8: VariantA — Filter Matrix

- CHOSEN: All filter groups visible in two-column scrollable matrix.
- WHY: Maximum discoverability; easiest completeness audit.
- NOT CHOSEN: Hidden accordions; horizontal tabs.
- PARAMS: Six groups; 2-column dialog grid; section borders; compact responsive stack below 900 px.
- DATE: 2026-09-04

## Decision 9: VariantB — Facet Navigator

- CHOSEN: Persistent left group rail plus focused form page.
- WHY: Lower cognitive load while keeping active facets across groups.
- NOT CHOSEN: Wizard with Next/Back; modal-inside-modal dropdowns.
- PARAMS: 145 px nav; Identity, Stats, Mechanics, Legality, Printing; dedicated 3 × 3 Link marker control.
- DATE: 2026-09-04

## Decision 10: VariantC — Query Composer

- CHOSEN: Search syntax bar plus editable field/operator/value clauses.
- WHY: Fast expert use; visually explains complex Boolean query.
- NOT CHOSEN: Raw query syntax only; unrestricted nested Boolean tree.
- PARAMS: Parsed query preview; add/remove clauses; field/operator/value rows; default `text contains "banish from GY" AND atk <= 1500`.
- DATE: 2026-09-04

## Decision 11: Evaluation controls

- CHOSEN: Draggable/collapsible toolbar controls density, veil, apply behavior, unavailable-card inclusion, result order.
- WHY: Review can tune behavior without code edits.
- NOT CHOSEN: Hidden constants; toolbar inside dialog.
- PARAMS: Density 1.00 or 0.86; veil 0.00–0.70; live/manual apply; unavailable on/off; 4 sort defaults; copied output includes dialog geometry/state.
- DATE: 2026-09-04

## Decision 12: Research basis

- CHOSEN: Use union of high-value fields from official Card DB, EDOPro source, YGOPRODeck API/UI, Master Duel Meta, NEURON/YGO Omega leads. Mark remote/live UI claims provisional.
- WHY: Runtime fetched DuelingBook entry only; YGOPRODeck blocked with HTTP 403; research subagents lacked web tools. Exact current competitor UI parity cannot be attested.
- NOT CHOSEN: Claim exhaustive competitor parity; copy stale screenshots as fact.
- PARAMS: Sources: `https://www.duelingbook.com/`, `https://github.com/ProjectIgnis/edopro/blob/master/gframe/deck_con.cpp`, `https://www.db.yugioh-card.com/yugiohdb/card_search.action`, `https://ygoprodeck.com/api-guide/`, `https://ygoprodeck.com/card-database/`, `https://www.masterduelmeta.com/card-search`, `https://www.konami.com/yugioh/neuron/en/`, `https://omega.duelistsunite.org/`; attempted 2026-09-04.
- DATE: 2026-09-04

## Decision 13: Accessibility + interaction

- CHOSEN: Semantic dialog/controls, visible focus, Escape close, trigger focus restore, reduced-motion support.
- WHY: Advanced search must stay keyboard-operable despite density.
- NOT CHOSEN: Click-only chips; icon-only unlabeled close; focus-obscuring animation.
- PARAMS: `role="dialog"`; `aria-modal="true"`; 3 px focus ring; Left/Right variant keys ignored in form fields.
- DATE: 2026-09-04

## Decision 14: Approval state

- CHOSEN: Pending user selection and exact approval phrase.
- WHY: Variant, density, veil, apply behavior, unavailable policy, result order remain adjustable.
- NOT CHOSEN: Freeze before decisions settle.
- PARAMS: Required phrase `prototype approved`; fixed prototype and final spec intentionally absent until approval.
- DATE: 2026-09-04

## Decision 15: Name exclusion + comparable monster values

- CHOSEN: Name match adds `Exclude`; Level/Rank, Link Rating, Pendulum Scale each use comparator plus one value.
- WHY: User needs negative name filtering and same threshold searches available for ATK/DEF.
- NOT CHOSEN: Positive name matching only; exact-only monster values; bounded range for these three fields.
- PARAMS: Name modes `Contains`, `Exact`, `Starts with`, `Exclude`; numeric operators `=`, `>`, `>=`, `<`, `<=`; Level/Rank and Scale values 0–13; Link Rating values 1–8.
- DATE: 2026-09-04

## Decision 16: Min/max parity for monster values

- CHOSEN: Level/Rank, Link Rating, Pendulum Scale each expose Min and Max beside comparator.
- WHY: User requires same input shape as ATK/DEF, including bounded ranges.
- NOT CHOSEN: Single value input; separate exact-only control.
- PARAMS: Operators `Range`, `=`, `>`, `>=`, `<`, `<=`; two numeric inputs labeled by `Min` and `Max` placeholders; Level/Rank and Scale bounds 0–13; Link Rating bounds 1–8.
- DATE: 2026-09-04

## Decision 17: VariantA asymmetric section grid

- CHOSEN: Stack `Card identity` above `Spell, Trap & links`; span `Stats` across both rows.
- WHY: `Stats` height now equals combined left-column sections; no empty lower quadrant caused by shared row height.
- NOT CHOSEN: Equal-height row pairing; blank filler; stretching `Card identity` around empty space.
- PARAMS: Desktop areas `words words / identity stats / spell stats / legality printing`; narrow layout returns to one-column source order.
- DATE: 2026-09-04

## Decision 18: Locked evaluator state

- CHOSEN: `VariantA · Filter Matrix` with comfortable density, live filtering, unavailable cards excluded, name ascending default.
- WHY: User locked exact copied evaluator params.
- NOT CHOSEN: VariantB Facet Navigator; VariantC Query Composer; compact density; manual apply; unavailable-card inclusion; relevance/ATK/newest default ordering.
- PARAMS: `variant=A`; `controlDensity=comfortable`; `controlDensityScale=1`; `workspaceVeil=0.34 opacity`; `applyBehavior=live`; `includeUnavailable=false`; `defaultResultOrder=Name A–Z`; `dialogBounds=deck-workspace exact inset 0`; `dialogState=open`.
- DATE: 2026-09-04

## Decision 19: Approval + freeze

- CHOSEN: Accept locked VariantA state and freeze standalone artifact.
- WHY: User sent exact validation phrase `prototype approved` after locking every evaluator param.
- NOT CHOSEN: Further variant iteration; promotion of throwaway code into production.
- PARAMS: Fixed path `docs/feature/PROTOTYPE_advanced_card_search.html`; evaluator toolbar, variant switcher, VariantB, VariantC, copy control, drag/collapse controls, prototype note removed; domain filter controls remain.
- DATE: 2026-09-04

## Decision 20: Settled answer

- CHOSEN: Advanced search is a dense Filter Matrix overlay exactly covering deck workspace; catalog retains trigger; live results exclude unavailable cards and sort Name A–Z.
- WHY: Preserves editor context, exposes full filter power, removes empty grid quadrant, matches approved state.
- NOT CHOSEN: Facet navigation; query composer; detached modal; hidden advanced groups.
- PARAMS: Comfortable scale 1; workspace veil 0.34; dialog open default; asymmetric matrix `words words / identity stats / spell stats / legality printing`.
- DATE: 2026-09-04

## Decision 21: Production entry state

- CHOSEN: Production Deck Builder starts with Advanced Search closed and card-name filter focused; trigger opens dialog and transfers focus to dialog.
- WHY: Owner's 2026-09-04 feedback explicitly makes card-name filter entry target. Standalone evaluator remains open by default only to expose prototype for review.
- NOT CHOSEN: Production dialog open on every editor entry; competing initial focus targets.
- PARAMS: Prototype `dialogState=open` unchanged; production `dialogState=closed`; trigger `Advanced Search`; open focus = close control; close focus = trigger.
- DATE: 2026-09-04

## Assumptions

- Existing request item number `3.1` identifies one prototype question: advanced filter dialog placement, contents, structure.
- `To sideboard` checkbox replacement removes that control from this location; its future destination is outside prototype question.
- Dialog overlays only `deck-workspace`, not preview/catalog/header.
- Desktop is judgment surface per project product context; narrow view is fallback simulation, not final mobile design.
- Card metadata not present in current `DeckBuilderCardView` remains mocked and would need production data-contract work.
- Competitor research is directional, not exhaustive current-state attestation, due HTTP/tool limits above.
