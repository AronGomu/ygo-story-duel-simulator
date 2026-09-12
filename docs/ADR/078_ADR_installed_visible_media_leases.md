# ADR-078: Installed visible-media leases replace direct art URLs

> Status: accepted; planned
> Amended by [ADR-086](086_ADR_installed_chapters_own_gameplay_catalog.md) D4–D5: required-media failure invalidates owning chapter/dependants; placeholder is error presentation only, never a readiness bypass.
> Decided: 2026-09-07
> Owners: decks / shell / battle presentation
> Relates: ADR-039 (direct art), ADR-043 (catalog/art separation)
> Baseline: `b0575deb33e3f999fa31723481660bf262b7077d` — existing implementation, not evidence these decisions landed.
> Amends: ADR-039 §§1–3 and ADR-043 §4 for PWA installed mode; explicit private profile remains available.

## Context

Editor art currently uses static runtime URL convention; duel image cache eagerly verifies a bounded active manifest. Manual-only chapter delivery forbids either direct online fallback or whole-catalog preload. Hidden opponent identity must cause zero art reads.

## Decision

D1. PWA consumers resolve exact installed-ref media only. Visible card leases begin with placeholder, notify verified decode completion, coalesce reads and release object URLs; no Promise-valued img src.

D2. Shared non-UI deck-data service supplies image leases. Cross-domain consumers use public seams; hidden hand/pile/face-down/material projections never acquire identifying leases.

D3. At most four concurrent image reads/decodes; unleased retained cache caps at 32 MiB and 64 entries. Active mounted leases tracked separately. These caps do not promise total browser/GPU memory bounds.

D4. Missing/corrupt art produces placeholder, never network fetch or deck-invalid warning. Existing private profile remains explicitly separate.

## Consequences

C1. Duel/editor/preview/shop share manual-download policy without coupling rules to imagery.

C2. Mounted views need lifecycle disposal and stale-ref protection. Native memory must be measured; unlimited mounted consumers cannot be hidden behind an LRU claim.

## Alternatives rejected

A1. Direct img URL with onerror fallback: still initiates implicit content downloads.

A2. Reuse eager 500-image cache unchanged: cannot scale to complete catalogs.

A3. Preload each chapter: excess I/O and memory before visibility.
