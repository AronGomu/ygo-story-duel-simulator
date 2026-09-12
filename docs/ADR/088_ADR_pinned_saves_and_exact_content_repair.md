# ADR-088: Pinned saves and exact content repair

> Status: accepted; planned
> Decided: 2026-09-12
> Owners: story / content / shell
> Amends: ADR-076 D4–D5 (legacy binding and removal policy)
> Relates: ADR-026 (domain DB ownership), ADR-027 (checkpoint handoff), ADR-085 (lifecycle locking)
> Baseline: `36c6f41e35cca9a4d5ca21ae0de00d325736bbe9` — Story save schema4 has no immutable content binding.

## Context

New installed revisions can change defaults while old saves remain meaningful. Saved-ref scan and content deletion span separate DBs; scan alone races a concurrent save write. A chapter/latest download API cannot restore exact saved revision A after defaults update to B.

## Decision

D1. New Story schema5 envelopes carry required StoryContentBinding: chapterId, exact ContentSetRef and completed chapter IDs. Existing schemas1–4 are incompatible, untouched and unbound; no migration, starter grant or guessed revision. Explicit user-requested new save replacement keeps normal confirmation semantics.

D2. Story owns all save/manual/autosave/checkpoint/handoff writes and clears. Shared `ygo-content-installer-v1` Web Lock spans content verification plus Story DB commit. Removal owns exclusive same lock through saved-ref scan and content pointer commit. Shell's narrow read-only saved-ref adapter reads current-format bindings without loading Story UI; malformed binding/read failure blocks deletion.

D3. Live sessions hold sorted shared per-manifest Web Locks. Removal rejects installed dependants, live leases or saved refs, including old revisions. Cache cleanup deletes only unreferenced bytes; explicit content removal never deletes saves/decks to make itself succeed.

D4. DownloadTarget includes exact revision variant `{kind:"revision",content:ContentSetRef}`. Repair fetches pinned retained catalog/manifests/parts, verifies full closure, restores exact receipts and clears only fully reverified invalid markers. Latest revision is never substituted. Unknown/unretained revision yields CONTENT_REVISION_UNAVAILABLE.

D5. Repairing saved A leaves default current B, previous pointer, generation and save bytes unchanged. Observers still re-read on repair notification. Continue can use verified saved A independently of default current; New Story/Free Play retain default-union gates. App never auto-downloads repair during cache read.

## Consequences

C1. Old installed saves can recover exact available content without switching current Free Play defaults or changing campaign history.

C2. Unsupported legacy saves cannot resume in new client without separate future work. Bytes remain preserved. Retained saved refs and suspended live tabs can block deletion indefinitely.

C3. Missing public/private retained object remains genuine repair blocker; app does not promise indefinite remote retention. Browser-origin eviction remains outside app-induced deletion guarantees.

## Alternatives rejected

A1. Bind old saves to latest install: invents historical content identity.

A2. Scan refs without shared serialization: save can commit after scan but before deletion.

A3. Download latest to repair old save: silently changes campaign revision.

A4. Delete saves or media still referenced by them: violates immutable saved-content preservation.
