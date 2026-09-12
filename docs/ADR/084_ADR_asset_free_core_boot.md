# ADR-084: Asset-free CORE boot

> Status: accepted; planned
> Decided: 2026-09-12
> Owners: shell / build / content
> Relates: ADR-023 (shell routes), ADR-079 (cold offline shell)
> Amends: ADR-075 D1 (CORE delivery boundary), ADR-051 (main-menu readiness)
> Baseline: `36c6f41e35cca9a4d5ca21ae0de00d325736bbe9` — current source, not implementation evidence.

## Context

`vite.config.ts` synchronously reads acquired runtime manifest and builds image metadata during config loading. `package.json` builds only after snapshot verification. Fresh checkout therefore cannot reach menu without asset acquisition. `src/shell/AppShell.svelte` includes reactive route restores, catalog warmup and lazy domain paths; disabled buttons alone cannot prevent startup effects.

## Decision

D1. CORE consists of executable shell, menu, Settings and content installer. Fresh `npm ci` plus `npm run dev` needs no acquired runtime, card DB, scripts, card/set images or chapter pack. Normal build also supports absent acquired assets. Frozen engine files may remain tracked but never initialize on CORE boot.

D2. Minimal bootstrap contains app/content schema compatibility, SHA-256 policy, known chapter descriptions and optional pinned delivery metadata. Missing delivery means unavailable content, not failed app startup. Acquired files never supply mandatory Vite config-load values; app build identity does not require runtime snapshot.

D3. Readiness precedes all gameplay route effects/imports, including direct hashes, restored sessions, admin duel actions and hover/focus warmup. Continue/New Story/Free Play explain missing verified content. Settings and Install Content remain usable. Existing private-mode build restriction and private deployment marker remain; absent evidence never means redistribution approval.

D4. Vite `dist/` is executable CORE distribution. Asset tooling's `core.zip` is an asset-only byproduct, not proof of runnable application. Content objects are built/verified before their immutable index pin enters app bootstrap; content hash excludes final app bytes, preventing circular identity. Public publication remains a separate concern.

## Consequences

C1. Source-only contributors can inspect shell without downloading game content. Installed content can fail without taking Settings/installer down.

C2. Existing build tests and eager initialization paths need explicit asset-free versus installed-content gates. Zero fake snapshot digests; unavailable content stays visibly locked.

C3. Executable app code, not gameplay payload, may be cached for offline reopen. Initial deployed offline availability still requires completed shell caching; `npm ci` alone is not a deployed PWA installation.

## Alternatives rejected

A1. Catch only missing manifest filesystem error: later runtime globals, warmup and direct routes still assume playable assets.

A2. Require acquisition before menu: contradicts CORE product boundary.

A3. Treat existing asset-only core archive as app release: current profile inventory does not include Vite executable build; empty archive success proves no boot behavior.
