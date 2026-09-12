# Asset-root inventory — before migration

Baseline: `7a2538f04a3c234be0f0fa1132dc04d6fcb071ec`. No assets moved. Source-only literal inventory; absent ignored corpus is not exhaustive asset availability evidence.

## Cutover

Current mapping: `scripts/lib/asset-roots.ts:ASSET_SOURCES`. Acquisition, validators, Vite, Node Worker inputs now consume canonical sources. Copy-only migration and exact tracked font/story relocations precede cutover; vendor/policy remain unchanged. Operational acquisition reports stay in `generated/`. Historical/archived prose below remains baseline evidence, not active path configuration. See [implemented profiles/migration](asset-profiles.md).

## Root mapping

| ID | Existing input | Planned managed root | Retained browser path / classification |
| --- | --- | --- | --- |
| M1 | `generated/assets/current/` | `assets/shared/data/current/` | `runtime/assets/current/`; catalog, text, scripts, strings, manifests; downloadable inputs |
| M2 | `generated/runtime/current/` | `assets/shared/runtime/current/` | `runtime/current/`; generated runtime manifest/catalog; downloadable inputs |
| M3 | `generated/card-images/archive/full/` | `assets/shared/card-images/full/` | `runtime/images/`; downloadable images |
| M4 | `generated/card-images/archive/cropped/` | `assets/shared/card-images/cropped/` | `runtime/images-cropped/`; downloadable crops |
| M5 | `generated/card-images/card-back.jpg` | `assets/shared/card-back.jpg` | `runtime/images/card-back.jpg`; downloadable back |
| M6 | `generated/set-images/` | `assets/shared/set-images/` | `runtime/sets/`; set bytes, manifest tooling-only unless selected |
| M7 | `generated/engine/current/` | `assets/battle/engine/current/` | Legacy acquired engine; NOT browser authority |
| M8 | `public/fonts/` | `src/assets/fonts/` | Core application CSS assets; excluded from downloadable asset bundles |
| M9 | `src/story/assets/` | `assets/story/chapter-01/` | Chapter 1 story media; `story/media/`; imported map is chapter-scoped |
| M10 | `public/story/shop-sets.v1.json` | Unmoved | Tracked gameplay policy; not downloaded bytes |
| M11 | `vendor/ocgcore-wasm/0.1.2/` | Unmoved | Frozen Git dependency; dev installer never writes here |

## Classification / consumers

- C1. Four managed roots exactly `assets/{battle,deck-editor,story,shared}`. Deck-editor has no legacy exclusive source root; shared card/set imagery serves multiple domains. Rule declarations: `scripts/lib/asset-delivery/source-mapping.ts`.
- C2. `.cache/upstream/`, downloaded source archives, temporary staging, locks, acquisition/status/coverage reports outside mapped current/archive roots are operational caches, not fresh-clone delivery inputs. Never migrate generated reports wholesale just because their parent is `generated/`.
- C3. Mapped manifests/catalogs are inputs, not disposable reports. Files already inside mapped roots remain bytes for later inventory; bundler must not regenerate them. Dev metadata truth = exact archive membership/bytes, not all upstream assets or playable runtime.
- C4. `scripts/lib/vite-runtime-assets.ts` owns browser path translation; `scripts/lib/mvp-assets.ts` owns legacy acquisition orchestration. Existing tests/config/deck/runtime readers retain old paths until complete copy migration verifies. T1 changes neither.
- C5. Story originals/unreleased/unused bytes become intentionally public only after explicit exact-file or future-inclusive tree approval. Git-ignore status never determines future archive membership. Frozen vendor is separate exact-hash approval scope.
- C6. Literal scan includes generic `generated` and standalone family names to catch `path.join` split literals. It intentionally overmatches prose/generated symbols. Dynamic root creation remains review responsibility; appendix lists every matched tracked source/config/doc line at baseline, not asset data contents.

## Reproduce

```bash
git grep -n -E 'generated|public/fonts|src/story/assets|vendor/ocgcore-wasm|\.cache/(upstream|card-images)' -- src scripts tests e2e e2e-acceptance docs public README.md AGENTS.md package.json vite.config.ts vitest.config.ts eslint.config.js playwright.config.ts playwright.acceptance.config.ts .gitignore assets-source-lock.json download-mvp-assets.cmd download-mvp-assets.sh
git grep -n -E '"(fonts|card-images|set-images)"' -- src scripts tests e2e e2e-acceptance
```

## Matched baseline lines

Paths resolve at baseline SHA above; later edits shift line numbers. No ephemeral-document links.

| ID | Tracked file | Matching lines |
| --- | --- | --- |
| L1 | `.gitignore` | 3 |
| L2 | `AGENTS.md` | 114, 181, 183 |
| L3 | `README.md` | 40, 107, 124, 188, 189, 203, 218, 219, 237, 252, 285 |
| L4 | `docs/ADR/022_ADR_three_ui_modular_monolith_and_worktree_boundaries.md` | 18, 132 |
| L5 | `docs/ADR/025_ADR_validated_card_list_duel_start.md` | 14 |
| L6 | `docs/ADR/039_ADR_editor_card_art_via_static_runtime_urls.md` | 22 |
| L7 | `docs/ADR/043_ADR_runtime_catalog_whole_card_database.md` | 34 |
| L8 | `docs/ADR/046_ADR_engine_response_encoding_contract.md` | 21, 27, 42 |
| L9 | `docs/ADR/052_ADR_set_image_pipeline.md` | 23, 27 |
| L10 | `docs/ADR/066_ADR_card_back_optional_runtime_asset.md` | 10, 12, 16, 18 |
| L11 | `docs/DECK_BUILDER_PROTOTYPE_IMPLEMENTATION_PLAN.md` | 207 |
| L12 | `docs/DECK_BUILDER_PROTOTYPE_SCOPE.md` | 485, 511, 702, 816 |
| L13 | `docs/DUEL_FIELD_DOM_IMPLEMENTATION_PLAN.md` | 150 |
| L14 | `docs/GLOSSARY.md` | 104, 131 |
| L15 | `docs/MVP_IMPLEMENTATION_HANDOFF.md` | 278, 288 |
| L16 | `docs/MVP_TECHNICAL_IMPLEMENTATION_PLAN.md` | 94, 140, 193, 225, 236, 239, 240, 308, 327, 346, 525, 548, 596, 731, 875 |
| L17 | `docs/architecture/03-engine/ocgcore-adapter.md` | 8 |
| L18 | `docs/architecture/04-data/asset-snapshots.md` | 11 |
| L19 | `docs/architecture/05-presentation/duel-field-validation-references.md` | 82 |
| L20 | `docs/architecture/07-governance/extension-path.md` | 34 |
| L21 | `docs/architecture/architecture.md` | 95 |
| L22 | `docs/archive/browser_wasm_implementation.md` | 223, 256 |
| L23 | `docs/assets/asset-import-pipeline.md` | 17, 32, 50, 53, 81, 95, 96, 113, 123, 179, 204, 212, 223, 250 |
| L24 | `docs/card-game-vn-handoff/05-offline-pwa-and-assets.md` | 27 |
| L25 | `docs/deck-catalog-data-flow.html` | 66 |
| L26 | `docs/deck-selection-screen-design.html` | 186 |
| L27 | `docs/deck-selection-screen-design.md` | 150 |
| L28 | `docs/developer-guide/data-quality.html` | 28, 34, 45, 61, 94 |
| L29 | `docs/developer-guide/guide.html` | 565, 829, 835, 846, 862, 895, 958, 967, 968, 1005, 1026, 1044, 1070, 1075, 1080 |
| L30 | `docs/developer-guide/index.html` | 183 |
| L31 | `docs/developer-guide/onboarding.html` | 26, 35, 36, 73, 94, 112, 138, 143, 148 |
| L32 | `docs/duel-field-validation-references.html` | 268 |
| L33 | `docs/duel-protocol-and-recovery.html` | 79 |
| L34 | `docs/feature/PDDR-deck_select_layout.md` | 22, 24, 135, 155 |
| L35 | `docs/feature/PDDR-decklist_rows.md` | 13, 81 |
| L36 | `docs/feature/PROTOTYPE_deck_select_layout.html` | 10, 15, 328, 329, 331 |
| L37 | `docs/feature/PROTOTYPE_decklist_rows.html` | 57 |
| L38 | `docs/story-shop-architecture.html` | 121 |
| L39 | `docs/three-ui-architecture.html` | 105, 194 |
| L40 | `e2e/duel-smoke.spec.ts` | 545, 950, 1014, 2016 |
| L41 | `eslint.config.js` | 104 |
| L42 | `scripts/download-card-back.ts` | 10, 32, 33 |
| L43 | `scripts/download-images.ts` | 28, 34, 47, 107, 203, 204 |
| L44 | `scripts/download-mvp-assets.ts` | 15, 16, 54, 71, 77, 84, 85, 104, 105, 106 |
| L45 | `scripts/download-set-images.ts` | 46, 47, 51 |
| L46 | `scripts/generate-image-lock.ts` | 33, 34, 39, 40, 45, 46 |
| L47 | `scripts/generate-runtime-snapshot.ts` | 10, 12 |
| L48 | `scripts/lib/active-card-data-manifest.ts` | 15, 33 |
| L49 | `scripts/lib/active-card-text-manifest.ts` | 25 |
| L50 | `scripts/lib/active-image-manifest.ts` | 28 |
| L51 | `scripts/lib/content-setup-files.ts` | 55, 66, 90, 99, 109, 110, 161 |
| L52 | `scripts/lib/content-setup-runtime.ts` | 26, 27, 39, 86 |
| L53 | `scripts/lib/content-setup.ts` | 69, 185, 186, 187, 295, 367 |
| L54 | `scripts/lib/image-content-lock.ts` | 5, 8 |
| L55 | `scripts/lib/model.ts` | 70 |
| L56 | `scripts/lib/vite-runtime-assets.ts` | 113, 121, 125, 133, 142, 157, 162, 168, 221, 261, 266, 292, 328, 333, 337, 342, 352, 362, 372, 379 |
| L57 | `scripts/lib/vite-sync-core.ts` | 21 |
| L58 | `scripts/sync-assets.ts` | 52, 57, 143, 283, 284 |
| L59 | `scripts/sync-engine.ts` | 24, 30, 31, 40, 101 |
| L60 | `scripts/verify-assets.ts` | 56, 245, 260, 271 |
| L61 | `scripts/verify-browser-build.ts` | 43, 67, 72, 77, 336, 489, 565 |
| L62 | `scripts/verify-engine.ts` | 11, 12 |
| L63 | `scripts/verify-images.ts` | 13, 14, 19, 20 |
| L64 | `scripts/verify-runtime-snapshot.ts` | 15, 23 |
| L65 | `scripts/verify-set-images.ts` | 22, 23 |
| L66 | `src/battle/app/diagnostics/download-diagnostics.ts` | 24 |
| L67 | `src/battle/duel/contracts/duel-diagnostics.ts` | 50 |
| L68 | `src/battle/worker/assets/runtime-manifest.ts` | 14, 39, 48, 49, 50, 52, 136 |
| L69 | `src/battle/worker/assets/runtime-snapshot-node.ts` | 12, 60 |
| L70 | `src/battle/worker/create-node-runtime.ts` | 41 |
| L71 | `src/battle/worker/engine/OcgCoreAdapter.ts` | 16 |
| L72 | `src/battle/worker/engine/load-vendored-core-node.ts` | 13 |
| L73 | `src/battle/worker/protocol/PromptRegistry.ts` | 199, 703 |
| L74 | `src/decks/catalog/ocg-card-mapper.ts` | 4 |
| L75 | `src/decks/catalog/ocg-mask.ts` | 5 |
| L76 | retired; provenance file deleted | — |
| L77 | `src/story/decks/starter-grant.ts` | 28 |
| L78 | `src/story/handoff/story-handoff.ts` | 18 |
| L79 | `src/story/shop/data/shop-set-data.ts` | 106 |
| L80 | `src/styles/fonts.css` | 2 |
| L81 | `tests/fixtures/content-setup-files.ts` | 24, 36, 109, 118, 120, 121, 123, 132, 145, 147, 150, 151 |
| L82 | `tests/fixtures/content-setup.ts` | 13 |
| L83 | `tests/fixtures/fake-ocgcore-adapter.ts` | 1 |
| L84 | `tests/integration/active-duel-dependencies.test.ts` | 16 |
| L85 | `tests/integration/chapter-one-duel.test.ts` | 32 |
| L86 | `tests/integration/cir-mill-chain-prompt.test.ts` | 102 |
| L87 | `tests/integration/custom-deck-duel.test.ts` | 11 |
| L88 | `tests/integration/duel-replay-restore.test.ts` | 43 |
| L89 | `tests/integration/duel-session.test.ts` | 29 |
| L90 | `tests/integration/falco-facedown-special-summon.test.ts` | 87 |
| L91 | `tests/integration/field-spell-activation.test.ts` | 55 |
| L92 | `tests/integration/gy-trigger-chain-window.test.ts` | 103 |
| L93 | `tests/integration/headless-controller.test.ts` | 22 |
| L94 | `tests/integration/programmed-duel.test.ts` | 49 |
| L95 | `tests/integration/rules-profile-placement.test.ts` | 57 |
| L96 | `tests/integration/spellbook-duel-progression.test.ts` | 46 |
| L97 | `tests/integration/worker-runtime.test.ts` | 33, 94, 110 |
| L98 | `tests/integration/xyz-detach-overlay-address.test.ts` | 78, 504 |
| L99 | `tests/integration/xyz-overlay-progression.test.ts` | 84 |
| L100 | `tests/paths.test.ts` | 12, 13, 16, 25, 26, 36, 46 |
| L101 | `tests/unit/browser-runtime-assets.test.ts` | 76 |
| L102 | `tests/unit/chapter-one-decks.test.ts` | 107, 121 |
| L103 | `tests/unit/chapter-one-image-lock.test.ts` | 45 |
| L104 | `tests/unit/content-setup-files.test.ts` | 32, 55, 65, 69, 170, 180, 192, 205, 215, 253, 254, 255, 256, 260, 280, 285, 289, 290, 291, 292, 293, 304, 305, 306, 307, 319, 376, 381, 384 |
| L105 | `tests/unit/content-setup-runtime.test.ts` | 24, 25, 26, 45 |
| L106 | `tests/unit/content-setup.test.ts` | 490 |
| L107 | `tests/unit/decks/deck-catalog-index.test.ts` | 202 |
| L108 | `tests/unit/decks/ocg-mask-parity.test.ts` | 8 |
| L109 | `tests/unit/decks/ownership-validation.test.ts` | 227 |
| L110 | `tests/unit/decks/packaged-catalog.test.ts` | 12 |
| L111 | `tests/unit/decks/starter-deck.test.ts` | 167 |
| L112 | `tests/unit/download-diagnostics.test.ts` | 67 |
| L113 | `tests/unit/duel-rules-profile.test.ts` | 120 |
| L114 | `tests/unit/duel-session.test.ts` | 2 |
| L115 | `tests/unit/image-content-lock.test.ts` | 92 |
| L116 | `tests/unit/ocgcore-adapter.test.ts` | 2 |
| L117 | `tests/unit/opponent-policy.test.ts` | 443, 446, 448, 451, 454, 457 |
| L118 | `tests/unit/prompt-registry.test.ts` | 29 |
| L119 | `tests/unit/runtime-manifest.test.ts` | 18, 46, 57 |
| L120 | `tests/unit/runtime-source-path.test.ts` | 6, 8, 18 |
| L121 | `tests/unit/story/pre-battle-decks.test.ts` | 271 |
| L122 | `tests/unit/sum-selection.test.ts` | 33 |
| L123 | `vite.config.ts` | 21 |
