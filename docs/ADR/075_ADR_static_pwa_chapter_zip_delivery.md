# ADR-075: Static PWA chapter ZIP delivery

> Status: accepted; planned
> Amended by [ADR-084](084_ADR_asset_free_core_boot.md) D1/D4 and [ADR-086](086_ADR_installed_chapters_own_gameplay_catalog.md) D1: executable CORE boots asset-free; runtime alone grants no gameplay, installed chapters define available union.
> Decided: 2026-09-07
> Owners: shell / content delivery
> Relates: ADR-043 (whole runtime scope)
> Baseline: `b0575deb33e3f999fa31723481660bf262b7077d` — existing implementation, not evidence these decisions landed.
> Amends: ADR-043 §§1,3 for PWA transport/packaging only; whole-runtime catalog scope remains.

## Context

Existing whole-runtime build serves raw snapshot/art assets. Product requires one install entry, explicit bulk downloads inside game, seven cumulative chapters, no paid backend. Chapter-01 is current prototype only; later chapter slots are unavailable.

## Decision

D1. Core HTML/JS/CSS/fonts/icons plus pinned release index cache automatically. Runtime/WASM/data and chapter media arrive only through explicit in-game download actions. Default BasicOpponentPolicy remains compiled code.

D2. One complete runtime pack supports whole supported catalog independently of art. Chapter N requires runtime plus chapter prefix 1…N; sequential progression remains save policy, not download state.

D3. Independent deterministic ZIP parts cap compressed bytes at 20 MiB, inflated bytes at 32 MiB, each file at 16 MiB, entries at 2,048. Oversized files fail publication; no split-file reconstruction.

D4. Manifest refs, ZIPs and extracted files carry exact SHA-256/length. Completed verified parts survive interruption; Resume is explicit, incomplete part may restart. No Range support assumption.

## Consequences

C1. Bounded archives permit useful mobile recovery without backend state. Missing art stays placeholder in freeplay.

C2. Users wait for full runtime before first duel. An interrupted part can redownload up to 20 MiB. Asset authors must shrink oversized media.

## Alternatives rejected

A1. One enormous install bundle: surprising transfer and poor recovery.

A2. External ZIP download/manual extraction: breaks in-game installation contract.

A3. Streaming arbitrary runtime subsets: weakens whole-catalog/engine consistency.
