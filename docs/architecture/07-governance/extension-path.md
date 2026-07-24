# Extension Path

> Status: approved post-MVP direction; implementation not started

The preset duel release gate is complete. Future story/progression work now follows the approved [`card-game-vn-handoff`](../../card-game-vn-handoff/00-index.md) and its [`phased implementation plan`](../../card-game-vn-handoff/08-phased-implementation-plan.md).

## Normative sequence

Phase numbering matches [`08-phased-implementation-plan.md`](../../card-game-vn-handoff/08-phased-implementation-plan.md) exactly:

0. Contract and ownership scaffolding; no runtime behavior change.
1. Self-contained battle facade around completed duel.
2. Validated content schemas and bundled prologue pack.
3. Pure campaign reducer and deterministic narrative runtime.
4. Typed Svelte shell, narrative UI, and map UI.
5. Saves, ContentManager, AssetResolver, and PWA shell.
6. End-to-end prologue acceptance.
7. Unrestricted local deck library/editor with YDK import/export.
8. Progressive chapter/media downloads.

Later optional narrative/audio/localization/product extensions remain outside numbered plan until their owning decisions are approved.

## Preserved constraints

Every extension must preserve:

- dedicated Worker authority over WASM, raw protocol, scripts, response indexes, duel handles, and opponent policy;
- typed clone-safe privacy-filtered main-thread state;
- Svelte ownership of controls and Phaser presentation-only ownership;
- atomic duel snapshot versioning and current cache rollback;
- deterministic real-WASM compatibility coverage;
- bounded diagnostics, cleanup, and Worker replacement;
- current private-only distribution gate.

No extension may directly import duel Worker internals into campaign/narrative/map code, serialize live battle state, or treat technical battle failure as campaign loss.

Current MVP scope remains correctly documented as direct-to-duel. Handoff docs describe future target, not shipped behavior; update canonical runtime files as each phase lands.
