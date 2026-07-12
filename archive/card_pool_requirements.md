---
date: 2026-06-09
title: YGO Story Duel Simulator - Card Pool Requirements
tags:
  - technical-plan
  - ygopro-core
  - edopro
  - card-database
---

# YGO Story Duel Simulator - Card Pool Requirements

## Key Point

`ygopro-core` / `ocgcore` is the duel rules/script engine. It is **not** by itself the full card collection.

A playable modern YGO simulator needs three separate layers:

1. **Core engine** — resolves game rules and executes card scripts.
2. **Card scripts** — Lua files implementing individual card effects and shared procedures.
3. **Card database** — SQLite `.cdb` files containing card IDs, names, text, stats, types, etc.

## Relevant Project Ignis Sources

| Need | Project | Link | Notes |
|---|---|---|---|
| Duel engine | EDOPro ocgcore / YGOPro core | https://github.com/edo9300/ygopro-core / https://github.com/Fluorohydride/ygopro-core | Core engine. Not a complete card pool alone. |
| Card effect scripts | Project Ignis CardScripts | https://github.com/ProjectIgnis/CardScripts | Canonical EDOPro card scripts, Lua 5.3. Includes official cards plus unofficial anime/manga/video-game-exclusive scripts. |
| Card databases | Project Ignis BabelCDB | https://github.com/ProjectIgnis/BabelCDB | Project Ignis SQLite card databases for EDOPro, synchronized with servers. |

## Implication For This Project

If using `ygopro-core` directly, the wrapper/backend must also package or locate:

- all official and prerelease `script/c*.lua` files and shared Lua utilities/procedures;
- the complete current standard-format `.cdb` catalog (`cards.cdb`, release additions and non-Rush prereleases);
- system strings/localization and supporting duel data;
- banlists / legality lists;
- complete card-image coverage, with images required by the active duel preloaded;
- `.ydk` parsing for bundled preset decks.

## Story Wrapper Requirement

The story wrapper can own progression and deck ownership, but deck validation/editor search must read from the `.cdb` card database. Duel execution must load the matching scripts from CardScripts.

For the accepted browser MVP, pin compatible Project Ignis revisions and convert the complete current standard-format BabelCDB catalog, official/prerelease CardScripts and strings into one versioned browser snapshot. Keep synchronous Worker callbacks fast by loading only active-duel records/scripts into memory, while retaining complete packaged coverage. Maintain the verified local card-image archive and missing-ID report, preload active-duel images, serve them from project-controlled static hosting, and cache them in the browser. Redistribution, AGPL and image-IP obligations must be reviewed before public deployment.
