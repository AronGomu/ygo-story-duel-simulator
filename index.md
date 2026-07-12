---
date: 2026-06-09
title: YGO Story Duel Simulator
tags:
  - project
  - game-design
  - yugioh
  - deckbuilder
  - rpg
  - research
status: planning
---

# YGO Story Duel Simulator

## Purpose

Design a progression-driven Yu-Gi-Oh-like story game that reuses a proven automatic duel simulator instead of rebuilding the full card-rule engine from scratch.

The target fantasy is close to **Yu-Gi-Oh! Tag Force**, **World Championship**, and older handheld campaign games: story chapters, rivals, deck growth, tournaments, relationships, unlocks, and duel-based progression.

## Desired Outcome

A validated project direction with:

- a legal/technical recommendation for which duel engine to reuse;
- a playable MVP loop: choose story node → duel NPC → receive rewards → update deck/unlocks → progress chapter;
- a clear answer to whether similar concepts already exist;
- a roadmap for building a prototype without being blocked by the full Yu-Gi-Oh rules engine.

## Current Status

Architecture accepted; browser duel MVP planning started. The complete catalog/script/string/image acquisition pipeline is implemented and exposed through `npm run assets:mvp` plus platform launchers.

Research summary: official games already prove the design space, and fan games exist, but I did **not** find a mature open-source project that combines a working modern YGO automatic simulator with a Tag Force-style RPG/story progression layer. This looks like a real niche.

The immediate MVP is deliberately focused on dueling rather than story: a browser-based Project Ignis-like offline duel client with preset decks, one human player, one deterministic deck-specific opponent, full current card/database/script/string coverage, card images, and complete start-to-finish duel support. It excludes the deck constructor, general menus and online matches.

## Accepted Technical Direction

Use Project Ignis `ygopro-core` / `ocgcore` as the duel foundation, compiled to WebAssembly.

Accepted stack:

1. TypeScript for orchestration, duel protocol, projected state and opponent policy.
2. Svelte for application UI, prompts and overlays.
3. Phaser for the duel field and future maps/scenes.
4. `ocgcore.sync.wasm` running exclusively in a dedicated Web Worker.
5. Complete build-time BabelCDB conversion, full pinned official Project Ignis CardScripts and supporting strings.
6. Versioned complete card-image coverage with active-duel preload and lazy caching.
7. Current-core duel protocol compatibility, while the product UI remains limited to preset decks.

See [[architecture|Architecture]] for the canonical decision and [[mvp_duel_ui_plan|Browser Duel MVP Plan]] for implementation milestones.

## Research Notes

- [[architecture|Architecture]] — canonical accepted architecture.
- [[mvp_duel_ui_plan|Browser Duel MVP Plan]] — active implementation plan.
- [[asset_import_pipeline|Asset Import Pipeline]] — implemented one-command data, script, string and image acquisition/verification.
Historical and superseded material is retained under `archive/`:

- [[archive/browser_wasm_implementation|Browser WASM research]]
- [[archive/card_pool_requirements|Card pool requirements]]
- [[archive/research_existing_concepts|Existing concept research]]
- [[archive/technical_direction|Technical direction]] — historical research.
- [[archive/wrapper_requirements|Wrapper requirements]] — historical EDOPro-wrapper research.
- [[archive/cross_platform_packaging|Cross-platform packaging]] — historical desktop packaging research.
- [[archive/ui_reuse_architecture_decision|UI reuse architecture decision]] — superseded.
- [[archive/odin_custom_client_architecture|Odin custom client architecture]] — superseded.

## Next Actions

- Select the exact preset deck lists.
- Inventory the complete current core message/prompt/response protocol.
- Integrate the generated BabelCDB/CardScripts/strings snapshot into the future Worker asset loader.
- Add deterministic placeholders for the 215 provider-missing image IDs and approve the final image redistribution/hosting policy.
- Define the deck-specific opponent decision table.
- Pin one atomic compatible snapshot of `ocgcore-wasm`, `ygopro-core`, CardScripts, BabelCDB, strings and image metadata.
- Create the TypeScript/Svelte/Phaser repository skeleton.
- Prove the smallest browser loop: load WASM in a Worker → start a deterministic headless duel → parse messages → send responses → reach `MSG_WIN`.
- Decide the long-term IP posture before any public deployment.

## Related Roles

- [[2_roles/Game Designer/game_designer_role|Game Designer]]

## Related Resources

- [[3_ressources/trading_card_games/trading_card_games|Trading Card Games]]
- [[3_ressources/video_game_design/video_game_design|Video Game Design]]

## Notes

Main risk: the **technical idea is feasible**, but official Yu-Gi-Oh IP/card-art distribution can be legally sensitive. Treat this as a fan/prototype project unless a safer original-IP wrapper is chosen.
