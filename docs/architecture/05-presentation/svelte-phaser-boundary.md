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
- Applying the same snapshot twice is idempotent and cannot duplicate sprites/listeners; sequenced presentation events remain consumable when the bounded visual log rolls over.
- Animation never delays Worker processing or changes response order.
- Restart/disposal cancels feedback and releases scene/listener/image references.
- Scene/image startup is bounded and falls back to semantic Svelte state rather than leaving a blank surface.
- Preserve 44px targets and contained horizontal field scrolling at mobile widths.
- Respect keyboard access, visible focus, persistent live regions, and `prefers-reduced-motion`.
