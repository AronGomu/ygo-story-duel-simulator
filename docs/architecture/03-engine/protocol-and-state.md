# Protocol and Public State

> Status: accepted

## Protocol adapter

- Parse bounded raw message buffers inside the Worker.
- Convert every classified message into a typed domain event, prompt, or result.
- Keep protocol indexes/bytes private; UI choices use stable opaque IDs and card-instance IDs.
- Encode responses only after validating current prompt constraints.
- Unknown or malformed messages fail deterministically and retain type/bytes in diagnostics.
- Every supported binary shape has a permanent fixture; the pinned constant inventory must have a parser classification.

## Public state projector

Project immutable snapshots from core messages plus field/location queries when reconciliation is needed. Include LP, turn, phase, deck/Extra Deck counts, public zones, human hand identities, opponent hand count, positions, ownership/control, overlays, and chain summary.

## Privacy and invariants

- Opponent hidden card identities are absent, not merely visually concealed.
- One physical card instance cannot occupy two zones.
- Phaser state is never queried as duel truth.
- Public state contains no raw handles, response indexes, functions, or non-cloneable values.
- Every projection/privacy bug receives a minimal fixture before its fix.
