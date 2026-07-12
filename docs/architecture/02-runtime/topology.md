# Runtime Topology

> Status: accepted

## Main thread owns

- Svelte application lifecycle, controls, card details, logs, loading/errors, and results.
- Latest immutable public duel snapshot and one current human prompt.
- Phaser presentation bridge and scene lifecycle.
- Active-duel image preload/cache coordination.
- Typed Worker client only; it never imports the engine.

## Dedicated Worker owns

- Vendored synchronous WASM module and duel handles.
- Raw core messages, response indexes, and process loop.
- Card/script in-memory maps and synchronous callbacks.
- Prompt conversion, response encoding, state projection, and opponent policy.
- Seed, ordered responses, and diagnostic trace.

## Boundaries

- Communication uses structured-clone-safe domain commands and events.
- Raw protocol values never cross to Svelte or Phaser.
- Opponent hidden identities are removed before snapshots leave the Worker.
- Phaser communicates through the presentation store/bridge, never directly with the Worker.
- A runaway or unresponsive engine is bounded by terminating/replacing the Worker.
