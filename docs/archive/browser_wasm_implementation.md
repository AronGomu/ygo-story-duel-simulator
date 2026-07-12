---
date: 2026-06-09
title: YGO Story Duel Simulator - Browser WASM Implementation
tags:
  - architecture-option
  - browser
  - javascript
  - wasm
  - ygopro-core
  - duel-ui
---

# YGO Story Duel Simulator - Browser WASM Implementation

## Status

Research validated and accepted on 2026-07-12. Current decisions are in [`../architecture/architecture.md`](../architecture/architecture.md), and active milestones are in [`../MVP_TECHNICAL_IMPLEMENTATION_PLAN.md`](../MVP_TECHNICAL_IMPLEMENTATION_PLAN.md).

## Goal

Build the game as a **pure browser-compatible TypeScript app** with `ygopro-core` running through WebAssembly.

This keeps the project deployable as a web app:

```text
Browser app
  -> story UI
  -> deck editor UI
  -> duel UI
  -> card database in SQLite/WASM or prebuilt JSON index
  -> CardScripts loaded as static Lua files
  -> ocgcore WASM engine
```

## Candidate WASM Core

Existing project found:

- `ocgcore-wasm`: https://github.com/n1xx1/ocgcore-wasm
- Description: Project Ignis EDOPro Core built for WebAssembly using Emscripten.
- License: MIT in repo metadata.
- Package exposes sync and async builds:
  - `ocgcore.sync.wasm`
  - `ocgcore.jspi.wasm`

Important note from README: the async JSPI version requires experimental JS Promise Integration / stack-switching in Node. For browser MVP, prefer the **sync version inside a Web Worker** unless JSPI browser support is proven.

## Recommended Browser Architecture

```text
Main browser thread
  -> UI rendering
  -> input handling
  -> story/deck screens
  -> sends player choices to worker

Duel Web Worker
  -> loads ocgcore WASM
  -> loads card database/index
  -> loads Lua card scripts
  -> owns duel state machine
  -> parses core messages
  -> posts UI events/prompts to main thread
  -> receives player responses

Storage
  -> IndexedDB / OPFS for saves, decks, cached scripts/database
  -> static assets for bundled MVP data
```

## Duel Worker Contract

### Start duel

```ts
worker.postMessage({
  type: "start_duel",
  payload: {
    duelId: "mvp_001",
    playerDeck: "decks/player_starter.ydk",
    opponentDeck: "decks/pass_ai.ydk",
    seed: [1n, 1n, 1n, 1n],
    startingLP: 8000
  }
});
```

### Worker sends UI events

```ts
worker.postMessage({
  type: "duel_event",
  payload: {
    messages: parsedMessages,
    fieldState: fieldStateSnapshot
  }
});
```

### Worker asks for human input

```ts
worker.postMessage({
  type: "prompt",
  payload: {
    promptId: "p42",
    kind: "select_idle_command",
    options: [
      { label: "Normal Summon Alexandrite Dragon", response: "...encoded..." },
      { label: "Set card", response: "...encoded..." },
      { label: "End Phase", response: "...encoded..." }
    ]
  }
});
```

### Main thread returns response

```ts
worker.postMessage({
  type: "response",
  payload: {
    promptId: "p42",
    response: encodedResponse
  }
});
```

## Card Database Options

### Option A — Reuse Project Ignis BabelCDB directly

Use `cards.cdb` from Project Ignis BabelCDB:

- Repo: https://github.com/ProjectIgnis/BabelCDB
- Format: SQLite `.cdb`
- Tables: `datas`, `texts`

Browser implementation needs SQLite support:

- `sql.js`
- `wa-sqlite`
- `node-sqlite3-wasm` pattern adapted for browser
- or a build-time conversion step to JSON.

Pros:

- most compatible with EDOPro/ocgcore IDs;
- keeps data format close to simulator ecosystem.

Cons:

- SQLite WASM adds complexity and bundle weight;
- licensing/redistribution needs verification;
- loading full DB in browser may need caching strategy.

### Option B — Build-time convert CDB to JSON indexes

At build time:

```text
cards.cdb -> cards.min.json / cards.index.json
```

Runtime loads JSON instead of SQLite.

Pros:

- simpler browser runtime;
- easier diagnostics and future search/filter UI;
- no SQLite WASM dependency in production;
- can split the complete catalog into deterministic locale/card-type shards.

Cons:

- requires build pipeline;
- must preserve exact numeric fields needed by `OCG_DataReader`.

Recommended for MVP: **Option B**. Keep the CDB as source-of-truth and generate a complete browser-friendly catalog rather than a preset-only subset.

## Card Scripts In Browser

Project Ignis CardScripts are Lua files. Browser app can serve them as static assets:

```text
/assets/card-scripts/constant.lua
/assets/card-scripts/utility.lua
/assets/card-scripts/official/c89631139.lua
```

The WASM core `scriptReader` callback loads script text by name.

MVP loading strategy:

- pre-cache global utility scripts;
- preload all scripts required by the preset decks before creating/processing the duel;
- keep loaded scripts in Worker-owned memory;
- package the complete official script snapshot, but expand only active-duel scripts into the Worker's synchronous in-memory lookup.

The synchronous core's `scriptReader` callback cannot await browser `fetch()`. Network-on-demand loading from inside that callback is therefore not allowed in the accepted MVP architecture.

## MVP Browser Duel UI Plan

Accepted duel MVP, implemented in TypeScript:

1. Browser opens directly into a duel.
2. Duel Worker starts `ocgcore-wasm` with two preset decks.
3. Opponent uses a deterministic deck-specific policy that can take coherent turns.
4. Main UI renders field, hand, LP, phase, graveyard/banished/deck counts.
5. Human player chooses legal actions from parsed prompts.
6. Face-up cards render current card images; active-duel images are preloaded and cached.
7. Worker emits `MSG_WIN` result and app shows win/loss.

## Suggested Tech Stack

Minimal:

- TypeScript
- Vite
- Canvas/WebGL UI, or React/Svelte with canvas duel field
- Web Worker for duel engine
- ocgcore-wasm
- generated card JSON index
- IndexedDB for saves/cache

If the duel UI needs heavy game rendering:

- PixiJS, Phaser, or custom Canvas/WebGL layer.

## Main Technical Risks

1. **Core message parsing**  
   Still the biggest task. Browser/WASM does not remove the need to parse every duel message and encode valid responses.

2. **Script loading latency**  
   Fetching Lua scripts on demand can stall. Cache aggressively or bundle MVP scripts.

3. **Bundle and cache size**
   The full card database, scripts and image catalog are large. Ship metadata/scripts as compressed versioned shards, host the verified image archive separately, preload active-duel images, and lazy-cache the remaining image catalog rather than placing every image in the initial bundle.

4. **Browser WASM support details**  
   Use sync WASM in a Worker first. Avoid relying on experimental JSPI for MVP.

5. **Licensing/IP**  
   Redistribution of Project Ignis data/scripts and official card names/text/art needs careful review.

## Recommendation

This browser direction was accepted. Current implementation milestones are defined in [`../MVP_TECHNICAL_IMPLEMENTATION_PLAN.md`](../MVP_TECHNICAL_IMPLEMENTATION_PLAN.md).

Recommended first spike:

```text
Vite + TypeScript
  -> load ocgcore-wasm sync build in Worker
  -> load a generated JSON card index from BabelCDB
  -> bundle scripts for 2 tiny starter decks
  -> auto-pass both players headlessly
  -> then add UI for human player prompts
```

The full data/script/image import pipeline is now available. Prove the Worker/core loop with a tiny preset duel first, loading only that duel's shards into memory.
