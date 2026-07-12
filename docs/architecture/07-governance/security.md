# Security and Trust Boundaries

> Status: accepted

- Load only pinned, project-provided Lua scripts and versioned decks/assets.
- User-provided decks/scripts and arbitrary code execution are outside the MVP.
- Keep the engine in a dedicated Worker so runaway execution can be terminated.
- Validate manifests, hashes, schemas, deck IDs, protocol bounds, prompt IDs, and selection constraints at their boundaries.
- Never trust Phaser/UI state for legality or engine responses.
- Strip opponent hidden information before crossing to the main thread.
- Treat downloaded diagnostics as potentially sensitive local artifacts.
- Client-side authority is acceptable only for offline single-player; future competitive multiplayer requires a server-authoritative engine.
