# Svelte–Phaser Boundary

> Status: accepted

## Svelte owns

Application layout, loading/error/result states, LP/turn/phase displays, typed prompt controls, card details/text, logs, accessibility, focus, and lifecycle actions.

## Phaser owns

Desktop duel-field coordinates, zones, card sprites/placeholders, selection highlights, and cancellable movement/battle feedback.

## Integration rules

- Both consume immutable public snapshots/presentation events through a small main-thread store and bridge.
- Phaser never imports the Worker client or sends raw engine responses.
- Phaser emits user intent to the store/Svelte layer; domain prompt state validates it.
- Applying the same snapshot twice is idempotent and cannot duplicate sprites/listeners.
- Animation never delays Worker processing or changes response order.
- Restart/disposal cancels feedback and releases scene/listener/image references.
- Respect keyboard access, visible focus, and `prefers-reduced-motion`.
