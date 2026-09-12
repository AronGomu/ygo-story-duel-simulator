# ADR-076: Content storage ownership and exact saved refs

> Status: accepted; planned
> Decided: 2026-09-07
> Owners: shell / battle / story
> Relates: ADR-026 (domain DB ownership), ADR-049 (save-owned decks)
> Baseline: `b0575deb33e3f999fa31723481660bf262b7077d` — existing implementation, not evidence these decisions landed.

## Context

Cache Storage writes and IndexedDB transactions are not one atomic operation. Runtime snapshot, media installation and story saves have distinct owners. Updating installed defaults cannot silently change a running or saved story.

## Decision

D1. Shared content public entry owns clone-safe vocabulary and parsers only. Shell owns ygo-story-content records and verified file cache; battle retains snapshot/engine authority; story retains ygo-story-saves/progression.

D2. Readiness requires verified receipts plus cached presence/length. Reads rehash before use; explicit Verify hashes whole closure. Cache-only reads never trigger repair downloads.

D3. ContentSetRef pins runtime/catalog/chapter manifests immutably. Default pointer switches by expected generation CAS after battle activation and complete closure verification; cross-DB crash fails closed.

D4. Save schema 5 adds nullable content binding. Legacy saves migrate without guessed refs; known prototype-compatible explicit binding uses existing save revision CAS. Installing content never completes story chapters.

D5. Live sessions hold Web Lock shared ref leases; removal needs exclusive leases. Later dependants block earlier removal. Explicit idle media removal never writes save/deck DB; missing media demands exact reinstall.

## Consequences

C1. Old compatible saves remain meaningful after content updates. Crash recovery must reconcile receipts with actual files.

C2. Suspended live tabs can block deletion indefinitely. Browser origin eviction can erase saves too; app-induced preservation is not eviction protection.

## Alternatives rejected

A1. One merged DB spanning all domains: erases established ownership without cross-cache atomicity.

A2. Latest-version aliases in saves: silently substitutes content and breaks reproducibility.

A3. Heartbeat-only deletion leases: suspended mobile tabs can lose live data.
