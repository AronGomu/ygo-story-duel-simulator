# MVP Scope

> Status: accepted

## Goal

Ship a static browser application that starts a normal Yu-Gi-Oh! duel between one human and one basic computer opponent using bundled preset decks. It must initialize the verified engine/data snapshot, expose every reachable human choice, and finish with a core-provided result such as `MSG_WIN`.

## Included

- Direct-to-duel offline browser application.
- One preset human deck and one deliberately straightforward opponent deck.
- Randomized production shuffling and starting hands.
- Test-only programmed deck order, seed, starting hands, and responses.
- Current standard-format BabelCDB metadata, Project Ignis CardScripts, system strings, and image manifest.
- Typed Worker protocol, public-state projection, human prompts, and deterministic deck-specific opponent.
- Svelte controls, Phaser field, card images, result/restart/surrender, and diagnostic download.
- Unit, real-WASM integration, asset-integrity, compatibility, and browser smoke tests.

## Excluded

- Story, dialogue, maps, relationships, rewards, and progression.
- Deck editor, collection, packs, shops, or user-provided decks.
- General-purpose competitive AI.
- Online multiplayer, lobbies, chat, or server authority.
- Match/side-deck flow and EDOPro replay compatibility.
- Pixel-perfect EDOPro parity, mobile-first polish, or every image in the initial JS bundle.

“Project Ignis-like” means current rules/data/script coverage and a complete playable duel surface, not copying EDOPro menus, networking, or visual design.
