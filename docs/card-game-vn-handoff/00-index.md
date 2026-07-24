# Card Game Visual Novel — Future Architecture Handoff

> Status: approved future design; not implemented  
> Authority: guides post-MVP work but does not override current runtime architecture until each migration phase lands  
> Baseline: completed browser duel MVP and all existing release gates

## Purpose

This handoff defines a Yu-Gi-Oh!-specific visual-novel campaign around the completed Svelte + Phaser duel client. It converts the exploratory proposal into an implementation-ready target and phased migration plan.

Current architecture under [`../architecture/`](../architecture/) remains the source of truth for shipped code. During migration:

1. current duel invariants remain mandatory;
2. this handoff defines intended post-MVP boundaries;
3. each implemented phase updates the owning canonical architecture file;
4. no future decision silently weakens a current test, privacy, integrity, diagnostics, or distribution gate.

## Accepted direction

- Yu-Gi-Oh!-specific product; generalize internal seams only when useful.
- Visual-novel presentation for narrative, campaign, maps, menus, and transitions.
- Existing Svelte controls + Phaser duel field remain the battle presentation.
- Authored chapter campaign with gated illustrated map hubs.
- Single Svelte/Vite application package with enforced domain boundaries.
- Pure campaign reducer, deterministic narrative cursor, validated JSON content.
- Self-contained battle feature facade around the current Worker-owned duel runtime.
- Unrestricted local deck library with editor plus YDK import/export.
- Out-of-battle saves with manual slots, rotating autosave, and pre-battle checkpoints.
- Installable offline PWA using a project-owned service worker through `vite-plugin-pwa` `injectManifest` mode.
- Existing atomic duel snapshot retained; separate immutable story/media packs managed by `ContentManager`.
- Private-only builds and installs until existing licensing and artwork gates are cleared.

## First acceptance slice

One end-to-end prologue:

```text
New game
→ Short narrative scene
→ One player choice
→ Illustrated map hub with two locations
→ One required existing duel
→ Win/loss branch
→ One progression flag or reward
→ Safe-boundary save/load
→ Install + offline replay
```

Deck-editor UI and background pack-download UI are later phases. First slice uses existing validated battle content and bundled immutable prologue pack bytes.

## Documents

1. [`01-product-scope.md`](01-product-scope.md) — target product, boundaries, first slice.
2. [`02-system-architecture.md`](02-system-architecture.md) — topology, dependencies, ownership, runtime flow.
3. [`03-modules-and-contracts.md`](03-modules-and-contracts.md) — public domain APIs and normalized contracts.
4. [`04-narrative-and-map-design.md`](04-narrative-and-map-design.md) — JSON content, interpreter, conditions, map model.
5. [`05-offline-pwa-and-assets.md`](05-offline-pwa-and-assets.md) — service worker, packs, activation, quota, updates.
6. [`06-ai-development-boundaries.md`](06-ai-development-boundaries.md) — domain scopes, imports, AGENTS files, validation.
7. [`07-technical-decisions.md`](07-technical-decisions.md) — accepted, deferred, rejected decisions.
8. [`08-phased-implementation-plan.md`](08-phased-implementation-plan.md) — migration sequence and acceptance gates.

## Non-negotiable inherited invariants

- `ocgcore` remains sole authority for legality, effects, and duel results.
- Dedicated Duel Worker remains sole owner of WASM, raw protocol, scripts, response indexes, handles, and opponent policy.
- Main thread receives clone-safe typed messages and privacy-filtered immutable state.
- Opponent hidden identities remain absent outside Worker.
- Phaser remains presentation-only.
- Engine, catalog, scripts, strings, and image manifest remain one verified atomic duel snapshot.
- Production randomness, diagnostic sensitivity, deterministic compatibility fixtures, bounded failure handling, and handle cleanup remain unchanged.
- Existing headless, unit, component, integration, build, reproducibility, and browser gates remain mandatory.
- Public packaging remains blocked while redistribution approval is false.

## Handoff completion rule

Future implementation may start from this design only by following [`08-phased-implementation-plan.md`](08-phased-implementation-plan.md). No big-bang folder move, contract duplication, or duel rewrite is authorized.
