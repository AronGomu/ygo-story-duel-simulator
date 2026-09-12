# ADR-086: Installed chapters own gameplay catalog

> Status: accepted; planned
> Decided: 2026-09-12
> Owners: content / decks / story / battle / shell
> Amends: ADR-043 whole-runtime UI availability, ADR-075 D2 runtime-only gameplay, ADR-077 D4 image-independent gameplay readiness, ADR-078 missing-media readiness
> Baseline: `36c6f41e35cca9a4d5ca21ae0de00d325736bbe9` — whole-runtime catalog and compiled Free Play roster precede this decision.

## Context

`src/decks/catalog/runtime-catalog.ts` exposes full packaged runtime catalog. `src/shell/screens/free-play-opponents.ts` compiles persona/deck assignments. Existing chapter policy supplies only card/set/opponent IDs. Runtime support and installed playable content are different facts; engine's full DB must not grant cards or AI choices from uninstalled chapters.

## Decision

D1. Whole compatible shared runtime remains intact for authoritative rules, globals and scripts. Free Play deck builder, collection, card/text/art/set data, starter/deck definitions and AI roster derive exclusively from union of installed verified chapter payloads. No chapter means no gameplay, even with valid runtime. Story progression does not limit Free Play's installed pool.

D2. Content index/manifest schema2 binds exact gameplay payload path plus immutable runtime/dependency refs. Chapter payload carries data definitions, not only IDs; runtime card/text records must agree with included chapter records. AI algorithm remains compiled; chapter data selects supported `basic` policy and roster/decks. No downloaded executable JS.

D3. Dependencies form validated acyclic chapter closure. Union ordering deterministic; identical shared definitions deduplicate, conflicting IDs fail incompatible. Card printing identity retains set/printing membership. Runtime-only support records or script dependencies never become deck/collection grants.

D4. All included required files/media verify before readiness. Placeholder is asset-load error presentation, not missing-media permission. Later failure invalidates owning chapter and dependent descendants; available union rebuilds from verified remainder. Free Play stays usable if nonempty valid closure survives. Unavailable-card local decks remain stored but cannot start; affected live session stops safely, unrelated pinned session remains intact.

D5. Cache-only file reads verify bytes/length/SHA before use. Media object URLs have explicit leases/release; no opportunistic network repair. Explicit repair/update preserves running/saved revision identities. Both Worker duel seats independently enforce installed card pool; UI filter alone is insufficient.

## Consequences

C1. Installing chapter expands Free Play data predictably without campaign progress requirement. Corruption of later content need not disable earlier verified chapters.

C2. Chapter card metadata partly duplicates shared runtime metadata. Consistency verification and payload size bounds are deliberate cost of chapter-owned gameplay data.

C3. Missing required art blocks affected chapter, even when engine could duel. Loss of chapter can make retained decks temporarily unusable; app does not silently delete missing cards.

## Alternatives rejected

A1. Whole runtime unlocks whole catalog: installed chapters stop being product content boundary.

A2. Require all published/future chapters for Free Play: one verified Chapter 1 must suffice.

A3. Placeholder bypass for missing required media: contradicts verified-content unlock policy.

A4. Lock all Free Play after any chapter failure: discards valid remaining dependency-closed content.
