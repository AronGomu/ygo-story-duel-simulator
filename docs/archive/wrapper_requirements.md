---
date: 2026-06-09
title: YGO Story Duel Simulator - Wrapper Requirements
tags:
  - requirements
  - edopro
  - architecture
---

# YGO Story Duel Simulator - Wrapper Requirements

## Status

Historical EDOPro-wrapper research. The accepted custom browser client no longer launches an external EDOPro application. See [`../architecture/architecture.md`](../architecture/architecture.md).

## Hard Requirement

Everything must go through the story wrapper.

The wrapper must be able to:

1. choose the player deck for a story duel;
2. choose the opponent/NPC deck;
3. launch a specific duel or match instance;
4. let the player edit/save decks through a YGOPro/EDOPro-compatible deck editor;
5. receive duel outputs: win/loss, match result, replay reference, and saved deck changes;
6. update story progression from those outputs.

## Feasibility Read

EDOPro is open source and supports deck files, local hosting, bot launching, and replay saving, but the current upstream client does **not** appear to expose a complete clean command-line API for:

- launching directly into a preset story duel;
- forcing both deck selections from outside;
- returning a structured `win/loss` JSON result to another skill;
- locking all navigation behind an external story wrapper.

Therefore the project should assume that a serious prototype needs either:

- automation around EDOPro plus manual result entry for the very first spike; or
- a small EDOPro fork/patch that adds a story-wrapper API; or
- direct use of ocgcore/server components with a custom wrapper-owned UI.

## Recommended Control Model

The story wrapper should own a `duel_instance.json` contract.

Example:

```json
{
  "storyDuelId": "chapter_1_jaden_01",
  "mode": "single",
  "matchBestOf": 1,
  "player": {
    "name": "Player",
    "deckPath": "story/decks/player/current.ydk"
  },
  "opponent": {
    "name": "Rookie Duelist",
    "deckPath": "story/decks/npcs/rookie_duelist.ydk",
    "botProfile": "rookie_duelist"
  },
  "rules": {
    "banlist": "story_chapter_1",
    "startingLP": 8000,
    "masterRule": "current"
  },
  "outputPath": "story/runs/chapter_1_jaden_01/result.json",
  "replayPath": "story/runs/chapter_1_jaden_01/replay.yrp"
}
```

After the duel, the simulator side should write:

```json
{
  "storyDuelId": "chapter_1_jaden_01",
  "status": "completed",
  "winner": "player",
  "loser": "opponent",
  "turns": 8,
  "finishReason": "lp_zero",
  "replayPath": "story/runs/chapter_1_jaden_01/replay.yrp",
  "playerDeckPath": "story/decks/player/current.ydk"
}
```

## Integration Options

### Option 1 — External EDOPro + File Watching

- Wrapper writes `.ydk` files and duel metadata.
- Player opens EDOPro from wrapper.
- Wrapper watches `deck/` for saved deck changes and `replay/` for `_LastReplay.yrp`.
- Result is manual or parsed from replay/log later.

Good for first spike, but not enough for final UX.

### Option 2 — EDOPro Fork With Story Mode API

Patch EDOPro to add:

- launch argument like `--story-duel path/to/duel_instance.json`;
- direct host/start with selected player deck and bot/NPC deck;
- restricted UI mode that only allows deck editor + active duel;
- automatic `result.json` write on `MSG_WIN`;
- deterministic replay save path.

This best matches the requirement that everything goes through the wrapper.

### Option 3 — Wrapper-Owned Client Around ocgcore

Use ocgcore/server pieces as a backend and build a custom duel/deck UI.

This gives maximum control, but it is much more work because the project must recreate duel prompts, chain interaction, animations, card display, and deck editor UX.

## Current Recommendation

Prototype with Option 1 only to prove the game loop, then move quickly to Option 2 if the concept is fun.

The project should not depend on the unmodified EDOPro client for final wrapper-owned story UX.
