# Duel Lifecycle

> Status: accepted

## Flow

1. Main thread sends `initialize`.
2. Worker validates the atomic snapshot and loads required indexes.
3. Main thread sends `startDuel` with the preset duel ID.
4. Worker validates decks and preloads active card data, global/card scripts, and strings; main thread preloads active images.
5. Worker creates the duel, adds cards, configures LP/draw/Master Rule, and starts processing.
6. Worker processes messages, projects state, emits events, and pauses only for human input.
7. Human choices return by prompt/choice ID; opponent prompts use the Worker policy.
8. Session ends on `MSG_WIN`, surrender, bounded timeout, unsupported message, or engine error.
9. Worker emits a structured result/diagnostic and destroys the duel handle.

## Randomness and replay

- Every production duel receives a fresh non-zero seed. An application-owned `EVENT_STARTUP` script asks the real core to shuffle both decks before normal opening draws; repeated production tests require varied hands.
- Deterministic seed/order/response and compatibility-startup-script injection exists only on the internal programmed-session configuration. No public Worker command can select it.
- Every run records seed, snapshot revisions, and ordered responses.

## Lifetime rules

- One live duel per Worker.
- `dispose` is idempotent and cleans partial initialization too.
- Restart disposes the current session before replacement.
- If graceful disposal exceeds its timeout, terminate and replace the Worker; the real Node Worker harness pins both graceful active-session exit and bounded forced termination.
- Processing has iteration/time guards and reports the last message/prompt on failure.
