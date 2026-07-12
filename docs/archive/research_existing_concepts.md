---
date: 2026-06-09
title: YGO Story Duel Simulator - Existing Concept Research
tags:
  - research
  - yugioh
  - fan-game
  - duel-simulator
---

# YGO Story Duel Simulator - Existing Concept Research

## Research Question

Does a concept already exist for a progression/story game like **Yu-Gi-Oh! Tag Force** or **World Championship**, but built on top of a working YGO duel simulator such as YGOPro/EDOPro?

## Short Answer

**Adjacent concepts exist, but I did not find a mature direct equivalent.**

What exists:

- official Konami progression/story duel games;
- modern automatic duel simulators;
- fan RPG/story projects;
- visual-novel/Twine/Ren'Py Yu-Gi-Oh fan works;
- templates and small prototypes.

What I did **not** find in this search:

- a polished open-source Tag Force-like campaign layer built directly on EDOPro/YGOPro;
- a maintained story RPG shell that automates modern YGO duels through ocgcore and exposes progression systems;
- an obvious existing project that already owns the niche.

## Existing Official References

| Reference | Relevance |
|---|---|
| Yu-Gi-Oh! Tag Force series | Strong reference for partner systems, character routes, school/city exploration, relationship progression, and duel unlocks. |
| Yu-Gi-Oh! World Championship games | Strong reference for handheld campaign progression, tournament ladders, NPC duels, and card acquisition. |
| Yu-Gi-Oh! Legacy of the Duelist | Strong reference for curated campaign battles, historical/anime scenario structure, and large official card pool. |
| Yu-Gi-Oh! Master Duel Solo Mode | Modern reference for solo duel gates, rewards, lore-driven card-theme chapters, and puzzle/tutorial duels. |

Conclusion: the **game design concept is proven officially**, but not currently satisfied by a flexible fan/open-source progression shell.

## Existing Duel Simulator Foundations

| Project | Link | Notes |
|---|---|---|
| Project Ignis: EDOPro | https://github.com/edo9300/edopro | Maintained automatic duel simulator, fork of YGOPro. Its README says YGOPro forks and known automatic duel simulators are powered by YGOPro core / ocgcore. Best candidate foundation. |
| Project Ignis website | https://projectignis.github.io/ | Public Project Ignis landing page. |
| YGOPro | https://github.com/Fluorohydride/ygopro | Original widely known open-source automatic simulator/client. GPL-2.0 on GitHub. |
| YGOPro Core / ocgcore | https://github.com/Fluorohydride/ygopro-core | Core automatic scripting engine. MIT on GitHub. |
| Project Ignis CardScripts | https://github.com/ProjectIgnis/CardScripts | Canonical EDOPro card scripts, Lua 5.3, targets Project Ignis ocgcore. |
| WindBot | https://github.com/IceYGO/windbot | C# bot for YGOPro-compatible servers. Useful precedent for story NPCs. |
| ocgcore-wasm | https://github.com/n1xx1/ocgcore-wasm | Experimental/less mature path for running EDOPro core through WebAssembly. |
| EDOPro-server-ts | https://github.com/diangogav/EDOpro-server-ts | TypeScript server compatible with EDOPro/Koishi/YGO Mobile; possible research path for duel orchestration. |

## Existing Fan / Adjacent Story Projects

| Project                                  | Link                                                                       | Found Evidence                                                                                                                                                    | Fit                                                                              |
| ---------------------------------------- | -------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| Yugioh Rememories (Alpha)                | https://johash.itch.io/ygorememories                                       | Itch page describes a retro card game inspired by Forbidden Memories with 8 story chapters, relic progression, card fusion, deckbuilding, and campaign narrative. | Similar story-card-game idea, but not found as an EDOPro/modern simulator shell. |
| Yu-Gi-Oh! The Battle City Begins         | https://romilton11.itch.io/yu-gi-oh-the-battle-city-begins                 | Itch description calls it a Yu-Gi-Oh 3D RPG development version.                                                                                                  | Similar RPG ambition; appears prototype/in-development.                          |
| Yu-Gi-Oh Duelists of the Roses Remake    | https://ignoresolutions.itch.io/yu-gi-oh-duelists-of-the-roses-remake-beta | Fan remake/prototype of a different official YGO tactical card game formula.                                                                                      | Adjacent fan game, not Tag Force-like modern duel progression.                   |
| Yu-Gi-Oh! starter-kit for Ren'Py         | https://fflo.itch.io/yu-gi-oh-starter-kit-renpy                            | Ren'Py starter kit with duel HUD ideas, MIT code license, CC BY asset license.                                                                                    | Useful for visual-novel presentation, not a complete duel simulator.             |
| The World Legacy, a Yugioh Tale in Twine | https://mudkipofdespair.itch.io/the-world-legacy-a-yugioh-tale-in-twine    | Interactive-fiction adaptation of YGO lore.                                                                                                                       | Story-only inspiration, no full duel engine.                                     |
| Yu-Gi-Oh: We Are Friends, Right?         | https://dei-lab-assistant.itch.io/yu-gi-oh-we-are-friends-right            | Short Ren'Py visual-novel test project.                                                                                                                           | Visual-novel precedent only.                                                     |

## Modern Browser / Closed Simulators

| Project | Link | Notes |
|---|---|---|
| Duelingbook | https://www.duelingbook.com/ | Browser-based YGO simulator. Page description says it works in browser. Manual simulator, not a reusable story engine. |
| Dueling Nexus | https://www.duelingnexus.com/ | Page description says it is a fully automated browser-based free YGO online game. Closed service; not ideal for reuse. |
| YGO Omega | https://omega.duelistsunite.org/ | Modern simulator often discussed by players; not treated here as an open reusable engine. |

## Market Gap

A strong project niche remains:

> A standalone progression/story shell that treats EDOPro/ocgcore as the duel-resolution engine and adds the missing single-player campaign layer: NPCs, chapters, tournaments, shops, booster rewards, relationship events, map/time systems, and deck restrictions.

This is different from simply making another simulator. The value is in the **campaign metagame**.

## Differentiation Ideas

- Tag Force-style relationship routes and partner duel events.
- World Championship-style overworld, tournament brackets, and deck progression.
- Master Duel Solo-style lore gates and archetype chapters.
- Roguelite optional mode: draft packs, limited deckbuilding, branching rivals.
- Deck restriction puzzles: beat an NPC with only Structure Deck cards, anime-era cards, archetype-locked cards, etc.
- NPC personality decks with scripted banter and evolving strategies.
- Save import/export compatible with `.ydk` deck files.

## Legal / IP Risk Notes

- The engine/core may be open source, but Yu-Gi-Oh names, card text, card art, characters, and official story material are separate IP concerns.
- A public/commercial release should avoid bundling copyrighted assets without permission.
- Safer options:
  - build a fan prototype for personal/non-commercial use;
  - require users to provide their own EDOPro install/assets;
  - use original characters and an original campaign setting;
  - eventually support an original-card mode if commercial release is desired.

## Research Verdict

Proceed with the project. The concept has strong official precedent and fan interest, but the specific implementation—**a reusable story/progression game built around a proven automatic YGO simulator**—appears underserved.
