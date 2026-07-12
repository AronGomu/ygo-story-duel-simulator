---
date: 2026-06-09
title: YGO Story Duel Simulator - Odin Custom Client Architecture
tags:
  - architecture-decision
  - odin
  - ygopro-core
  - custom-ui
  - card-database
---

# YGO Story Duel Simulator - Odin Custom Client Architecture

## Status

**Superseded on 2026-07-12.** The accepted browser architecture is documented in [[architecture|Architecture]]. This file remains as historical research for a possible native client.

## Historical decision

Use **Odin** for the full game/client and use **YGOPro core / ocgcore** only as the duel rules engine.

Do not use Electron/web technology for the wrapper. Do not depend on the EDOPro client UI.

The game will implement its own seamless UI for:

- story progression;
- deck editor;
- card collection;
- shops/packs/rewards;
- duel field;
- player prompts/responses;
- result handling;
- saves.

## Why This Changes The Architecture

`ygopro-core` is not a UI framework. It provides a C API for clients:

- create/destroy duel;
- add cards to a duel;
- start/skill duel;
- receive binary duel messages;
- provide player responses;
- load Lua scripts through callbacks;
- provide card data through callbacks.

Odin can call C APIs directly, so this is a reasonable architecture if the project accepts implementing all client UI and message handling.

## High-Level Architecture

```text
Odin game/client
  -> story state
  -> deck editor UI
  -> card collection UI
  -> duel UI
  -> AI/opponent control layer
  -> SQLite card database reader
  -> Lua script file loader callback
  -> YGOPro core C API
       -> resolves rules and card effects
       -> emits duel messages
       -> waits for responses
```

## Card Data Sources

### Best simulator-compatible source: Project Ignis BabelCDB

- Repo: https://github.com/ProjectIgnis/BabelCDB
- Format: SQLite `.cdb`
- Main database: `cards.cdb`
- Tables observed:
  - `datas`: `id`, `ot`, `alias`, `setcode`, `type`, `atk`, `def`, `level`, `race`, `attribute`, `category`
  - `texts`: `id`, `name`, `desc`, `str1` ... `str16`
- Current observed `cards.cdb` size: about 7.4 MB.
- Current observed row count in `cards.cdb`: 14,468 rows in `datas` and `texts`.

This is the most compatible card database path because it is already used by the EDOPro ecosystem and matches YGOPro/ocgcore card IDs.

### Required companion source: Project Ignis CardScripts

- Repo: https://github.com/ProjectIgnis/CardScripts
- Lua scripts targeting Project Ignis ocgcore.
- Needed for actual card effects.
- The database gives metadata; scripts give behavior.

### Alternative metadata source: YGOPRODeck API

- API guide: https://ygoprodeck.com/api-guide/
- Example endpoint: `https://db.ygoprodeck.com/api/v7/cardinfo.php`

YGOPRODeck is useful for rich card metadata, images, prices, sets, and deck-editor convenience, but it is not the canonical simulator runtime database. For duel execution, prefer BabelCDB + CardScripts.

## Licensing/IP Notes

- `Fluorohydride/ygopro-core` is MIT.
- `edo9300/ygopro-core` / Project Ignis core is AGPLv3-or-later.
- Project Ignis CardScripts include AGPL licensing material.
- BabelCDB does not expose a GitHub-detected license in repo metadata; treat redistribution rights as something to verify before public release.
- Yu-Gi-Oh card names/text/art are separate Konami/Shueisha IP concerns.

Safer prototype approach:

1. Use local Project Ignis data paths during development.
2. Do not bundle official card art.
3. If distributing, document licenses and source availability clearly.
4. Consider letting users point the game to their own EDOPro/Project Ignis data folder.

## Odin Implementation Notes

Recommended bindings:

- Bind `ocgapi.h` / `ocgapi_types.h` from Odin.
- Compile core as a shared library first for easier iteration.
- Implement `OCG_DataReader` by querying loaded CDB data.
- Implement `OCG_ScriptReader` by loading `constant.lua`, utility scripts, then `c<ID>.lua` card scripts as requested.
- Parse `OCG_DuelGetMessage` binary messages and render the matching UI prompt.
- Use `OCG_DuelSetResponse` to send player choices back.

## Main Risk

The largest workload is not card data. It is implementing the full duel client protocol:

- all message types;
- card selection prompts;
- chain prompts;
- position selection;
- phase/action menus;
- field state rendering;
- replay/log support;
- AI decisions for NPCs.

This is possible, but it is the real project complexity.
