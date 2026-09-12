# ADR-079: Cold service-worker updates preserve active games

> Status: accepted; planned
> Decided: 2026-09-07
> Owners: shell / PWA lifecycle
> Relates: ADR-023 (single entry shell)
> Baseline: `b0575deb33e3f999fa31723481660bf262b7077d` — existing implementation, not evidence these decisions landed.

## Context

Product supports desktop Chromium, Android Chrome and installed Safari on iPhone/iPad. Live replacement of shell code can cross incompatible save/download/Worker lifecycles. One install entry cannot guarantee identical native prompt behavior.

## Decision

D1. Core-only precache excludes runtime, chapter parts, art and bulk media. Offline-ready follows verified shell cache/controller setup, not install-prompt acceptance.

D2. New service worker waits while old controlled game clients remain. No skipWaiting or live clients.claim takeover. User closes all game windows/tabs then reopens to activate coherent new shell.

D3. Shell release identity tracks app build, even when runtime snapshot is unchanged. Old shell cleanup touches shell caches only, never installed content.

D4. Install entry uses native prompt when available, platform instructions otherwise. Root/subpath navigation fallback never handles content URLs.

## Consequences

C1. Active duel/save/download work survives shell update discovery.

C2. Forgotten old tab delays update indefinitely. First setup may need safe reload before offline-ready. Native installed-browser evidence remains necessary.

## Alternatives rejected

A1. Force reload/update now: can interrupt active engine/save transactions.

A2. Cache whole deployment recursively: silently downloads bulk archive.

A3. Claim install prompt equals offline readiness: false before completed cache/controller setup.
