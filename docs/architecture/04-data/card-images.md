# Card Images

> Status: accepted with distribution review required

## Coverage and delivery

- Maintain a versioned card-code-to-image manifest for every supported catalog ID.
- Keep the multi-gigabyte image archive outside the JavaScript bundle and source Git.
- Serve approved images from project-controlled static hosting rather than continual provider hotlinking.
- Begin preloading all unique active-deck images at startup, but never block a legal prompt on image or storage I/O; use placeholders until preload finishes.

## Rendering and privacy

Render face-up images in field/hand/inspector/GY/banished/Extra Deck/prompt surfaces as applicable. Use a card back for hidden cards and a deterministic placeholder for unavailable IDs.

## Cache behavior

Use snapshot/provider-aware Cache Storage keys, deduplicate concurrent requests, validate manifest digest/length/content/dimensions/decode before persistence, evict invalid cache entries, tolerate provider outages with placeholders, and revoke temporary object URLs. Network and decode work is bounded by byte, concurrency, cancellation, and timeout limits.

Technical availability is not permission to redistribute; see [`../07-governance/licensing-and-distribution.md`](../07-governance/licensing-and-distribution.md).
