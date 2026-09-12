# ADR-087: Explicit Chapter 1 source corrections

> Status: accepted; planned
> Decided: 2026-09-12
> Owners: content authoring / asset pipeline
> Relates: ADR-086 (chapter-owned gameplay), ADR-081 (source/profile ownership)
> Source evidence: `content/authoring/card-set-source.json`, SHA256 `b3ac778e5f1b9927554ef8e66185a596c0c35d71ab642b448c952c6c9050496d`
> Baseline: `36c6f41e35cca9a4d5ca21ae0de00d325736bbe9`

## Context

Selected Chapter 1 source has 76 sets and 1,629 distinct IDs before corrections. Source Barrel Dragon uses `81480461`; verified pinned runtime names Barrel Dragon at `81480460` with `c81480460.lua`. Ulevo `501000000` and Meteo the Matchless `501000001` lack records/texts/scripts in current pinned stack. This establishes current absence, not generic engine impossibility.

Selected `Yu-Gi-Oh! Power of Chaos: Yugi the Destiny Limited Collector's Edition` has unknown/empty source membership. Owner removes this video-game collector-edition grouping rather than shipping an unavailable fake set. Separate Yugi the Destiny promotional set remains included.

## Decision

D1. Exactly one source-to-runtime alias applies: `81480461 → 81480460`. No general name matching, numeric correction or substitution inference.

D2. Exactly `501000000` and `501000001` are excluded from playable Chapter 1 closure. Their source evidence and supported cards in their sets remain; no broader prize-set exclusion.

D3. Exactly `Yu-Gi-Oh! Power of Chaos: Yugi the Destiny Limited Collector's Edition` is absent from shipped selections, metadata, shop and packages. No unavailable row or zero-card playable pack remains. Separate promotional set is not merged, removed or inferred from collector grouping.

D4. Frozen raw source stays audit-only and byte-identical. Corrections are explicit derived policy shared by setup verification, normalized selection, acquisition, prepared metadata and package producer. Apply set exclusion, card exclusion, exact alias, then deterministic dedup/sort. Retain every unique included printing tuple and distinct set identity.

D5. Corrected baseline is 75 sets and 1,627 distinct normalized IDs, independently derivable from pinned source. These counts prove policy scope, not runtime/art completeness or publication rights. Remaining included assets still require real verification.

## Consequences

C1. Setup and packaging share one explainable card pool rather than disagreeing on raw versus runtime IDs.

C2. Chapter 1 intentionally omits two unsupported cards and one collector grouping. Source remains recoverable for later explicit policy changes; no claim of exhaustive external catalog correctness.

C3. Raw audit file still contains omitted source records but never supplies shipped PCY metadata directly. Build/source pipeline must prevent raw-source accidental inclusion.

## Alternatives rejected

A1. Rewrite frozen source silently: destroys provenance and breaks its pinned SHA.

A2. Infer alias by every matching name: unrelated identities could collide.

A3. Invent unsupported cards/scripts or zero-member collector set: makes readiness assertion false.

A4. Remove every promotional/prize set: exceeds exact owner-approved exclusions.
