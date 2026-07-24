# Product Scope

> Status: approved future design; not implemented

## Product

A private, offline-first, single-player Yu-Gi-Oh! card-battling visual novel. Authored chapters combine dialogue, choices, illustrated map hubs, campaign progression, deck selection, and the existing complete duel experience.

## Core loop

```text
Narrative scene
→ Campaign choice or objective update
→ Map hub
→ Available location
→ Location scene or event
→ Optional/required battle
→ Normalized battle outcome
→ Reward, flag, unlock, or branch
→ Continue chapter or return to map
```

## Presentation boundary

Visual-novel presentation applies to:

- title and save/load screens;
- narrative scenes;
- chapter and objective UI;
- illustrated map hubs;
- deck-library entry and transition screens;
- errors, recovery, content installation, and PWA updates.

Battle presentation remains the existing accessible Svelte prompt UI plus non-authoritative Phaser duel field. Story work must not recreate or bypass that duel surface.

## Target features

### Campaign

- Authored chapters with gated map hubs.
- Declared typed variables, objectives, flags, counters, unlocks, and rewards.
- Win/loss/draw branches from normalized battle outcomes.
- Campaign-owned map availability and destination validation.
- One active blocking external effect at a time.

### Narrative

- Framework-independent deterministic cursor interpreter.
- Versioned schema-validated JSON scenes.
- Dialogue, narration, character sprites/expressions, backgrounds, choices, waits, transitions, conditionals, and jumps.
- Typed intents for campaign mutation, rewards, map opening, and battle start.
- Target schema supports music and sound; first slice need not use them.

### Maps

- Illustrated backgrounds with percentage-positioned hotspot buttons.
- Equivalent accessible location list.
- Hidden, locked, available, and completed presentation states computed by campaign engine.
- Campaign-controlled cancellation/back behavior.
- No free movement or world simulation.

### Battles

- Existing engine, Worker, controls, field, diagnostics, image handling, restart, surrender, and failure behavior.
- Self-contained battle facade accepts validated immutable campaign input.
- Terminal result separates resolved, aborted, and failed outcomes.
- Campaign progression changes only for resolved outcomes; engine failure never becomes a player loss.

### Decks

- Unrestricted local deck library.
- Create, edit, rename, duplicate, delete, validate, import, export, and select.
- Versioned internal JSON records in IndexedDB.
- YDK remains import/export format, not canonical storage.
- Campaign rewards do not restrict which cards may be used in the editor.

### Saves

- Manual save slots plus bounded rotating autosaves.
- Atomic out-of-battle writes only at explicit stable states.
- Durable pre-battle checkpoint write must succeed before battle dispatch.
- Interrupted battle load restores pre-battle checkpoint.
- Explicit schema/content/deck migration; no silent coercion.

### Offline delivery

- Installable PWA.
- App shell and acquired playable content work offline.
- Existing duel snapshot stays atomic and battle-owned.
- Story/media content uses separate immutable content-addressed packs.
- First release includes bootstrap + prologue pack bytes locally; no network required for first play.
- Later chapters may download progressively with quota, progress, resume, priority, verification, and rollback.

## First post-MVP vertical slice

### Included

- Title screen with New Game and Load.
- One short prologue scene.
- At least one meaningful player choice.
- One illustrated map with two locations and accessible list parity.
- One location gated or marked by campaign state.
- One required battle through current battle facade.
- Separate player-win and player-loss narrative branches.
- One persisted flag or reward.
- One manual save path, autosave, and pre-battle recovery path.
- Bundled prologue pack verification/activation.
- PWA install, offline cold start, and offline replay of the complete slice.
- Existing diagnostics and release gates.

### Deferred beyond first slice

- Deck-editor UI and arbitrary deck selection in campaign battles.
- Network pack-download UI and background chapter prefetch.
- Audio content, voice, and cinematics.
- Multiple chapters, shops, quests, relationships, tournaments, or card-ownership gating.
- Public distribution.

## Explicitly excluded from target

- Free character movement.
- Tile maps, collision, pathfinding, NPC schedules, camera-follow simulation.
- Online multiplayer, lobbies, chat, or server authority.
- Live battle-state serialization.
- Arbitrary executable code in content packs.
- Content-authored retry logic for operational failures.
- Public deployment before licensing, source-availability, database, image, and content approval.

## Success definition

Target is successful when first slice passes its acceptance flow without weakening current duel guarantees, then later phases add deck editing and progressive downloads behind the same contracts.
