# Extension Path

> Status: deferred until the duel MVP release gate

After the preset duel is reproducibly complete, extensions may proceed in this order:

1. More preset decks and compatibility scenarios.
2. Deck editor and arbitrary local decks.
3. Collection and saves.
4. Visual-novel dialogue and branching story state.
5. Phaser maps and NPC interaction.
6. Rewards, shops, relationships, and tournaments.
7. Stronger deck-specific opponents.
8. Optional server-authoritative multiplayer.

Do not implement these systems before the production browser duel initializes, accepts all human choices, completes, restarts cleanly, and exports diagnostics. Future systems must preserve the Worker authority boundary and atomic asset versioning.
