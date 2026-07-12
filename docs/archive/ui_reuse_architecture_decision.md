---
date: 2026-06-09
title: YGO Story Duel Simulator - UI Reuse Architecture Decision
tags:
  - architecture-decision
  - edopro
  - ui
  - deck-editor
  - duel-ui
---

# YGO Story Duel Simulator - UI Reuse Architecture Decision

## Status

Superseded. The current TypeScript/Svelte/Phaser browser direction is documented in [`../architecture/architecture.md`](../architecture/architecture.md).

## Decision

Do **not** build a custom deck editor UI or human duel UI from `ygopro-core` alone.

If the project must reuse existing deck editing and duel interaction screens, the base should be the **full EDOPro client**, not only `ygopro-core`.

## Reason

`ygopro-core` is the duel engine. It does not provide:

- deck editor UI;
- human duel field UI;
- card interaction prompts rendered as a usable interface;
- animations/sounds/card display;
- replay browser/export UI;
- built-in story-wrapper result contract.

EDOPro already provides these surfaces. The missing work is not UI implementation, but **control integration**.

## Recommended Architecture

```text
Electron story wrapper
  -> owns story/save/progression
  -> writes story_duel.json
  -> launches patched EDOPro in story mode

Patched EDOPro client
  -> uses existing deck editor UI
  -> uses existing human duel UI
  -> uses existing card scripts/databases/assets
  -> starts forced story duel/match
  -> writes result.json + replay + saved .ydk deck

Electron wrapper
  -> reads result.json
  -> updates story state
```

## Required EDOPro Patch Surface

Minimal fork/patch should add:

1. `--story-mode path/to/story_duel.json` command-line argument.
2. Optional `--deck-editor path/to/deck.ydk` command-line argument.
3. Forced deck selection for the player.
4. Forced opponent deck / bot profile selection.
5. Auto-create local duel/match from the JSON contract.
6. Auto-save replay to a wrapper-provided path.
7. Write `result.json` when the duel receives `MSG_WIN`.
8. Return to wrapper instead of normal EDOPro main menu when the flow ends.

## NPC / AI Caveat

Reusing the human duel UI solves the player interface, but story NPCs still need control logic.

Options:

- use EDOPro/WindBot-compatible bots for NPC opponents;
- create scripted bot profiles per story NPC;
- allow manual two-sided play only for early testing;
- later build better AI decision layers if needed.

## Licensing Note

EDOPro is AGPLv3/GPLv3-based. If distributing a modified EDOPro client, comply with source-distribution obligations. This is manageable, but it must be accepted as part of the project.

## Consequence

The project becomes an **Electron wrapper + patched EDOPro client** project, not an `ygopro-core` custom-client project.

This is likely the right tradeoff because it avoids rebuilding the hardest UI surfaces.
