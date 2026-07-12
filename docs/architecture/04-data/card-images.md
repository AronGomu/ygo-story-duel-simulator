# Card Images

> Status: accepted with distribution review required

## Coverage and delivery

- Maintain a versioned card-code-to-image manifest for every supported catalog ID.
- Keep the multi-gigabyte image archive outside the JavaScript bundle and source Git.
- Serve approved images from project-controlled static hosting rather than continual provider hotlinking.
- Preload all unique active-deck images before enabling the first action; load other catalog images lazily.

## Rendering and privacy

Render face-up images in field/hand/inspector/GY/banished/Extra Deck/prompt surfaces as applicable. Use a card back for hidden cards and a deterministic placeholder for unavailable IDs.

## Cache behavior

Use snapshot/provider-aware Cache Storage keys, deduplicate concurrent requests, tolerate provider outages when cached images/placeholders exist, and revoke temporary object URLs. Missing/provider failures must appear in diagnostics without blocking a duel unnecessarily.

Technical availability is not permission to redistribute; see [`../07-governance/licensing-and-distribution.md`](../07-governance/licensing-and-distribution.md).
