# Documentation

This directory contains current project documentation and historical context. Root [`AGENTS.md`](../AGENTS.md) is the fast entry point for AI and contributors.

## Current sources of truth

| Document                                                                                                                               | Purpose                                                                                   |
| -------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| [`architecture/architecture.md`](architecture/architecture.md)                                                                         | Canonical architecture index, invariants, and task-based routing                          |
| [`GLOSSARY.md`](GLOSSARY.md)                                                                                                           | Shared user/agent vocabulary for naming parts of the codebase                             |
| [`story/README.md`](story/README.md)                                                                                                   | Narrative canon: world rules, philosophy, chapters, characters                            |
| [`DUEL_FIELD_DOM_IMPLEMENTATION_PLAN.md`](DUEL_FIELD_DOM_IMPLEMENTATION_PLAN.md)                                                       | Completed TDD ticket ledger for semantic DOM-field migration                              |
| [`ADR/001_ADR_semantic_dom_duel_field_rendering.md`](ADR/001_ADR_semantic_dom_duel_field_rendering.md)                                 | Accepted renderer ADR                                                                     |
| [`ADR/002_ADR_universal_data_cy_selector_contract.md`](ADR/002_ADR_universal_data_cy_selector_contract.md)                             | Accepted `data-cy` selector contract for every rendered element                           |
| [`ADR/019_ADR_full_height_duel_shell_and_pixel_geometry.md`](ADR/019_ADR_full_height_duel_shell_and_pixel_geometry.md)                 | Accepted full-height shell, px geometry, rail, hands, phase and preview-scroll invariants |
| [`ADR/004_ADR_prompt_surfaces_after_selection_dock.md`](ADR/004_ADR_prompt_surfaces_after_selection_dock.md)                           | Accepted prompt-surface routing after the selection dock is removed                       |
| [`ADR/005_ADR_optimistic_drag_placement.md`](ADR/005_ADR_optimistic_drag_placement.md)                                                 | Accepted optimistic drag placement with engine reconciliation                             |
| [`ADR/006_ADR_preview_panel_replaces_card_inspector.md`](ADR/006_ADR_preview_panel_replaces_card_inspector.md)                         | Accepted preview panel replacing the modal card inspector                                 |
| [`ADR/007_ADR_stack_zones_as_interaction_targets.md`](ADR/007_ADR_stack_zones_as_interaction_targets.md)                               | Accepted deck/extra/graveyard/banished piles as field interaction targets                 |
| [`ADR/008_ADR_projected_deck_order_and_reveals.md`](ADR/008_ADR_projected_deck_order_and_reveals.md)                                   | Accepted projected deck order with offset-based reveal tracking                           |
| [`ADR/009_ADR_automatic_prompt_resolution.md`](ADR/009_ADR_automatic_prompt_resolution.md)                                             | Accepted automatic placement and automatic answering of non-decisions                     |
| [`ADR/010_ADR_in_field_phase_navigation.md`](ADR/010_ADR_in_field_phase_navigation.md)                                                 | Accepted in-field phase strip replacing the corner status pills                           |
| [`ADR/011_ADR_deck_registry_and_derived_card_pool.md`](ADR/011_ADR_deck_registry_and_derived_card_pool.md)                             | Accepted bundled deck registry and derived reviewed pool                                  |
| [`ADR/012_ADR_pre_duel_deck_selection.md`](ADR/012_ADR_pre_duel_deck_selection.md)                                                     | Accepted pre-duel pair selection and replacement lifecycle                                |
| [`ADR/020_ADR_browser_persisted_ui_state_v2.md`](ADR/020_ADR_browser_persisted_ui_state_v2.md)                                         | Accepted v2 deck/window plus field-display preference persistence                         |
| [`ADR/014_ADR_public_knowledge_for_face_down_cards.md`](ADR/014_ADR_public_knowledge_for_face_down_cards.md)                           | Accepted conservative face-down public-knowledge tracking                                 |
| [`ADR/015_ADR_halo_semantics_legal_versus_selected.md`](ADR/015_ADR_halo_semantics_legal_versus_selected.md)                           | Accepted legal/selected/focus/feedback visual semantics                                   |
| [`ADR/016_ADR_dependency_free_drag_physics.md`](ADR/016_ADR_dependency_free_drag_physics.md)                                           | Accepted dependency-free drag ghost physics                                               |
| [`ADR/017_ADR_floating_field_windows_and_dismissal.md`](ADR/017_ADR_floating_field_windows_and_dismissal.md)                           | Accepted field-window bounds, persistence, and dismissal                                  |
| [`ADR/018_ADR_conditional_extra_monster_zones.md`](ADR/018_ADR_conditional_extra_monster_zones.md)                                     | Accepted Worker-owned MR3/MR5 conditional EMZ profile                                     |
| [`ADR/021_ADR_card_list_dialog_modes_and_selection.md`](ADR/021_ADR_card_list_dialog_modes_and_selection.md)                           | Accepted browse/target/range/duplicate-choice card-list contract                          |
| [`ADR/022_ADR_three_ui_modular_monolith_and_worktree_boundaries.md`](ADR/022_ADR_three_ui_modular_monolith_and_worktree_boundaries.md) | Accepted single-app topology and parallel UI ownership                                    |
| [`ADR/023_ADR_single_entry_shell_and_hash_routes.md`](ADR/023_ADR_single_entry_shell_and_hash_routes.md)                               | Accepted one entry document, hash route table and shell ownership                         |
| [`ADR/024_ADR_responsive_stage_and_portrait_strategy.md`](ADR/024_ADR_responsive_stage_and_portrait_strategy.md)                       | Accepted 16:9 stage, 1024px breakpoint and portrait strategies                            |
| [`ADR/025_ADR_validated_card_list_duel_start.md`](ADR/025_ADR_validated_card_list_duel_start.md)                                       | Accepted card-list start contract with strict snapshot validation                         |
| [`ADR/026_ADR_domain_storage_ownership.md`](ADR/026_ADR_domain_storage_ownership.md)                                                   | Accepted one durable store per domain and deck migration policy                           |
| [`ADR/027_ADR_story_duel_handoff_saga.md`](ADR/027_ADR_story_duel_handoff_saga.md)                                                     | Accepted checkpointed story-to-duel handoff and recovery rules                            |
| [`ADR/053_ADR_story_canon_ownership.md`](ADR/053_ADR_story_canon_ownership.md)                                                         | Accepted narrative-canon home and canon-over-content precedence                           |
| [`ADR/054_ADR_free_play_opens_on_the_seats.md`](ADR/054_ADR_free_play_opens_on_the_seats.md)                                           | Accepted free-play entry on the deck seats and early library read                         |
| [`ADR/057_ADR_hand_activation_drop_zone.md`](ADR/057_ADR_hand_activation_drop_zone.md)                                                 | Accepted (planned) hand activation drop zone and cancellable single-choice activation      |
| [`ADR/058_ADR_duel_field_colour_semantics.md`](ADR/058_ADR_duel_field_colour_semantics.md)                                             | Accepted dashed selection colours and orange-as-current-locus (amends ADR-015)            |
| [`ADR/059_ADR_xyz_materials_as_a_zone.md`](ADR/059_ADR_xyz_materials_as_a_zone.md)                                                     | Accepted (planned) xyz materials as a field zone, overlay marker on `PromptCard`           |
| [`ADR/069_ADR_default_is_the_only_deck_mark.md`](ADR/069_ADR_default_is_the_only_deck_mark.md)                                       | Accepted (planned) default as sole deck mark; favourite storage removed                    |
| [`ADR/070_ADR_explicit_sorts_are_undoable.md`](ADR/070_ADR_explicit_sorts_are_undoable.md)                                           | Accepted (planned) explicit deck sorts enter undo history                                  |
| [`ADR/071_ADR_story_screens_consume_the_shell_stage.md`](ADR/071_ADR_story_screens_consume_the_shell_stage.md)                       | Accepted (planned) story screens consume shell-owned stage dimensions                      |
| [`ADR/072_ADR_story_navigation_origin_is_saved.md`](ADR/072_ADR_story_navigation_origin_is_saved.md)                                 | Accepted (planned) internal story return origin persists with saves                        |
| [`ADR/073_ADR_end_turn_returns_to_field_corner.md`](ADR/073_ADR_end_turn_returns_to_field_corner.md)                                 | Accepted (planned) sole End Turn control returns to field bottom-right                     |
| [`ADR/074_ADR_end_turn_intent_resumes_across_prompts.md`](ADR/074_ADR_end_turn_intent_resumes_across_prompts.md)                     | Accepted (planned) End Turn intent pauses and resumes across engine prompts                 |
| [`three-ui-architecture.html`](three-ui-architecture.html)                                                                             | Target three-domain architecture map                                                      |
| [`duel-field-architecture.html`](duel-field-architecture.html)                                                                         | Styled full-height field architecture design                                              |
| [`duel-field-affordance-model.html`](duel-field-affordance-model.html)                                                                 | Affordance surfaces, prompt families, colour/shape semantics, pointer–keyboard parity     |
| [`card-list-dialog-architecture.html`](card-list-dialog-architecture.html)                                                             | Styled card-list modes, data flow, state and acceptance design                            |
| [`duel-field-interaction-shell.html`](duel-field-interaction-shell.html)                                                               | Styled interaction-shell design: surfaces, routing, drag, settings                        |
| [`duel-field-interaction-model-v2.html`](duel-field-interaction-model-v2.html)                                                         | Styled round-2 interaction baseline                                                       |
| [`duel-field-interaction-model-v3.html`](duel-field-interaction-model-v3.html)                                                         | Styled round-3 interaction model: knowledge, semantics, motion, windows, target routing   |
| [`deck-selection-architecture.html`](deck-selection-architecture.html)                                                                 | Styled registry-to-picker-to-Worker deck-selection architecture                           |
| [`deck-selection-screen-design.html`](deck-selection-screen-design.html) / [`.md`](deck-selection-screen-design.md)                    | Validated final visual/interaction design for the duel-start deck-selection screen        |
| [`duel-field-validation-references.html`](duel-field-validation-references.html)                                                       | Styled rule/visual/a11y validation catalog                                                |
| [`MVP_TECHNICAL_IMPLEMENTATION_PLAN.md`](MVP_TECHNICAL_IMPLEMENTATION_PLAN.md)                                                         | Completed MVP/Phaser baseline audit plan                                                  |
| [`assets/asset-import-pipeline.md`](assets/asset-import-pipeline.md)                                                                   | Implemented asset acquisition, generation, and verification pipeline                      |

## Architecture navigation

Architecture decisions are split into narrowly scoped files under [`architecture/`](architecture/). Start at [`architecture/architecture.md`](architecture/architecture.md); its decision map points to the minimum context needed for a task.

```text
ADR/                          # Numbered architecture decision records
architecture/
├── architecture.md          # Canonical map and cross-cutting invariants
├── 01-product/              # Scope and technology choices
├── 02-runtime/              # Platform, topology, Worker contract, duel lifecycle
├── 03-engine/               # OcgCore adapter, protocol/state, opponent
├── 04-data/                 # Snapshots, cards/scripts, images, storage
├── 05-presentation/         # DOM field ADR, detailed architecture, validation references
├── 06-quality/              # Testing and diagnostics
└── 07-governance/           # Security, licensing, future extensions
```

## Approved future architecture handoff

[`card-game-vn-handoff/`](card-game-vn-handoff/) defines the approved post-MVP visual-novel campaign target and phased implementation plan. It preserves the completed duel architecture but is not evidence that story, map, save, deck-library, content-pack, or PWA work is implemented. Current runtime behavior remains governed by [`architecture/`](architecture/) until each handoff phase lands and updates its owning canonical decision.

Start with [`card-game-vn-handoff/00-index.md`](card-game-vn-handoff/00-index.md), then use [`card-game-vn-handoff/08-phased-implementation-plan.md`](card-game-vn-handoff/08-phased-implementation-plan.md) for implementation order.

## Plans and tickets are ephemeral

Plans, self-contained tickets, grill records and design scratch live in the repo-root `artifacts` directory. That directory is working state: it is deleted when a round of work finishes. **No durable document links into it** — not an ADR, not an architecture doc, not this index. Everything that must outlive a round belongs in an ADR or under [`architecture/`](architecture/).

Provenance is cited as an immutable git commit instead. Every ADR header carries one line of this shape:

```text
> Commit: `f0139d0` — T1
```

`f0139d0` is the commit that introduced that ADR. It also contains the plan and ticket files the decision was written against, so `git show f0139d0` recovers them long after the working directory is cleared. The `— T1` suffix is the ticket range the decision covered, kept because it records scope. The design documents under `docs/` cite the same commit in their footer.

## Historical material

[`archive/`](archive/) contains superseded research and rejected directions. Use it for rationale/history only; it cannot override current architecture or current implementation plans.

Superseded records retained at stable paths for old plan links:

- [`ADR/003_ADR_field_first_application_chrome.md`](ADR/003_ADR_field_first_application_chrome.md) → superseded by ADR-019.
- [`ADR/013_ADR_browser_persisted_ui_state.md`](ADR/013_ADR_browser_persisted_ui_state.md) → superseded by ADR-020.
- [`duel-field-interaction-shell.html`](duel-field-interaction-shell.html), [`duel-field-interaction-model-v2.html`](duel-field-interaction-model-v2.html), [`duel-field-interaction-model-v3.html`](duel-field-interaction-model-v3.html) → historical interaction generations; ADR-019/021 + current architecture HTML override them.
