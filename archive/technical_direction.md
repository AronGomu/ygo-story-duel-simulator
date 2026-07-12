---
date: 2026-06-09
title: YGO Story Duel Simulator - Technical Direction
tags:
  - technical-plan
  - yugioh
  - edopro
  - ocgcore
  - game-design
---

# YGO Story Duel Simulator - Technical Direction

## Status

Historical research. The architecture decision was finalized on 2026-07-12 in [[architecture|Architecture]]. The active scope is defined in [[mvp_duel_ui_plan|Browser Duel MVP Plan]].

## Project Premise

Do **not** rebuild the Yu-Gi-Oh rule engine first.

Build the missing game around a proven duel engine:

- story graph;
- NPCs and relationships;
- deck ownership;
- shops and booster unlocks;
- tournaments;
- campaign restrictions;
- progression rewards;
- save system;
- presentation layer.

The duel simulator should be treated as the combat engine.

## Recommended Engine Foundation

Primary candidate: **Project Ignis: EDOPro**.

Relevant components:

- EDOPro client: https://github.com/edo9300/edopro
- ocgcore / YGOPro core: https://github.com/Fluorohydride/ygopro-core
- Project Ignis CardScripts: https://github.com/ProjectIgnis/CardScripts
- WindBot precedent: https://github.com/IceYGO/windbot

Reasoning:

- EDOPro is already an automatic simulator.
- ocgcore handles the hard rules/card-script layer.
- `.ydk` deck files are a useful boundary format.
- Existing bot/server tooling suggests NPC duels are possible.

## Architecture Options

### Option A — Separate Story Shell + External EDOPro Duel Handoff

The story game is its own app. It creates decks, launches EDOPro/local server duels, and records results.

Pros:

- fastest prototype;
- avoids forking the whole simulator UI immediately;
- lets players use a known simulator;
- isolates the progression layer from rules complexity.

Cons:

- duel-result automation may need research;
- UX may feel like switching apps unless tightly integrated;
- requires managing EDOPro install/version compatibility.

Best for: first MVP.

### Option B — Fork EDOPro Client and Add Story Mode Inside It

Modify the simulator client directly to include campaign menus, save data, NPCs, shops, and story screens.

Pros:

- integrated UX;
- direct access to duel state;
- easiest long-term if engine internals are understood.

Cons:

- high complexity;
- must understand C++ client architecture;
- upstream changes may be painful;
- licensing obligations must be handled carefully.

Best for: later if Option A validates fun.

### Option C — ocgcore as a Library / WASM Backend

Build a custom frontend and call ocgcore directly, possibly through native bindings or WebAssembly.

Pros:

- full control of presentation;
- web/mobile possibilities;
- clean architecture if bindings are stable.

Cons:

- technically hardest;
- all duel UI, prompts, chain interactions, logs, and card display must be built;
- card database/script integration still required.

Best for: long-term original product, not MVP.

## MVP Recommendation

Start with **Option A**.

### MVP Loop

1. Player starts Chapter 1.
2. Game presents a map/menu with 3 NPCs.
3. Player selects an NPC duel.
4. App chooses NPC deck and player deck restriction.
5. Duel is launched through EDOPro-compatible flow.
6. Player records or imports result.
7. App grants reward: money, pack, card unlock, relationship points, chapter flag.
8. New NPC/story node unlocks.

### MVP Content Size

- 1 chapter.
- 3 NPC duelists.
- 1 mini tournament.
- 1 shop.
- 5 packs or reward pools.
- 20-50 obtainable cards/deck entries for prototype.
- 3 relationship events.
- 1 final boss duel.

## Data Model Sketch

```yaml
player:
  name: string
  money: number
  owned_cards: CardId[]
  decks: Deck[]
  story_flags: string[]
  relationships:
    npc_id: points

npc:
  id: string
  name: string
  deck_file: path
  difficulty: number
  relationship_events: Event[]
  rewards:
    win: Reward[]
    loss: Reward[]

story_node:
  id: string
  chapter: number
  requirements:
    flags: string[]
    relationship_min?: number
  kind: dialogue | duel | shop | tournament | choice
  next: string[]

reward:
  kind: money | card | pack | flag | relationship | deck_recipe
```

## Immediate Technical Questions

- Can EDOPro be launched directly into a local duel with preset decks?
- Can a bot duel be created from command line/server config?
- Where does EDOPro write replay logs and can win/loss be parsed?
- Is WindBot still compatible with current Project Ignis EDOPro, or is ProjectIgnis/windbot needed instead?
- Is there a stable local server API suitable for automation?
- Can the shell safely depend on users installing EDOPro separately?

## Prototype Stack Candidates

### Fastest

- Electron / Tauri / simple desktop app.
- JSON/YAML content files.
- `.ydk` deck import/export.
- Manual win/loss entry for first slice.

### Game-Feeling

- Godot shell.
- Dialogue/map/shop UI in Godot.
- External duel handoff to EDOPro.
- Later replace manual result entry with logs/API.

### Web-First Experimental

- React app.
- ocgcore-wasm research.
- Highest technical risk.

## Legal/IP Implementation Rule

For early prototype:

- Store only IDs/decklists where possible.
- Do not bundle official card art.
- Prefer requiring a local EDOPro install for official cards/assets.
- Use original NPCs/campaign text rather than anime characters if this may become public.

## First Prototype Milestone

**Milestone 0: Duel Handoff Spike**

Goal: prove that the shell can prepare a duel and receive/record a result.

Done when:

- player deck and NPC deck are selected from the story shell;
- EDOPro-compatible duel can be started;
- outcome is recorded in save data;
- reward unlocks appear in the shell after the duel.

If automatic result import is too hard, allow manual result entry for MVP and postpone full automation.
