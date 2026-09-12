# ADR-083: Verified conflict-safe dev asset installation

> Status: accepted; planned
> Decided: 2026-09-09
> Owners: developer tooling / asset storage
> Baseline: `3fa800c` — source baseline, not implementation evidence.
> Relates: ADR-081 (managed roots), ADR-082 (immutable remote objects)

## Context

Developer asset folders include editable originals and unfinished local work, not disposable caches alone. A remote nightly snapshot can add, change or remove files. Blind extraction or mirroring can destroy edits; ignoring all existing files leaves stale assets indefinitely. Existing acquisition process locks (`scripts/lib/run-lock.ts`) prevent overlapping writers but do not establish file ownership or crash-safe multi-file installation.

## Decision

D1. Anonymous one-command dev download resolves exact snapshot once, verifies manifest/archive/file hashes and lengths, then stages extraction before touching managed assets. Download integrity means matching selected bundle, not game readiness or complete upstream art availability.

D2. Install receipt records previously managed path/hash/length. Differing unknown paths and modified managed paths are conflicts; entire install aborts before writes. Identical existing files can be adopted. Unknown files remain untouched. Frozen vendor, profiles and executable app source outside managed roots cannot be replaced by dev archive.

D3. Remote removals become retired receipt entries; download does not delete them. Explicit local prune previews only unchanged retired managed files. Apply revalidates receipt and file hashes before deleting named entries; unknown or edited files are never implicit candidates.

D4. Install uses process lock, bounded disk/stream budget, staged replacements, backups and persistent journal. Individual replacements are atomic; receipt commits last. Multi-file install is not globally atomic, so app stays closed during apply. Interrupted operation performs hash-guarded recovery before retry, never overwriting post-crash user changes.

D5. ZIP64 supports large dev originals but never relaxes archive containment, byte limits or exact declared-entry checks. Symlink/reparse traversal, Windows reserved names, case/normalization collisions, unexpected entries and wrong hashes are rejected before activation. Failed validation cannot become partial successful installation.

## Consequences

C1. Repeated downloads are idempotent by bytes and preserve local work. Developer must resolve genuine collisions explicitly; automatic mirror convenience is intentionally rejected.

C2. Disk requirement includes downloaded ZIP, staged extraction and changed-file backups. Large originals require substantial temporary disk. Crash recovery can stop for owner intervention if files changed since interruption.

C3. Receipt and journal become versioned local persistence contracts. Their own paths remain outside bundled roots. Removing receipt manually loses ownership evidence and causes conservative conflict behavior rather than permission to overwrite files.

## Alternatives rejected

A1. Extract ZIP directly over repository: partial failure and accidental overwrite lose user work.

A2. Always trust existing files: stale or tampered files pass without matching snapshot.

A3. Delete anything absent remotely: unknown originals and unfinished work disappear.

A4. Call multi-file rename atomic: filesystem guarantees apply per replacement, not entire asset tree; explicit recovery is necessary.
