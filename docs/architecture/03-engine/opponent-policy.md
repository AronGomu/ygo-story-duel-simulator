# Opponent Policy

> Status: accepted

The MVP opponent is deterministic, pure, and specific to its bundled straightforward deck. It is not a general Yu-Gi-Oh! AI.

## Inputs and output

The policy receives typed legal prompts plus permitted visible/projected state. It returns one legal choice and a machine-readable decision reason. It cannot access the human player's hidden information or raw engine response indexes.

## Decision areas

- Phase progression.
- Normal summon, set, and position priorities.
- Spell/trap activation and chain/pass decisions.
- Target, attacker, and battle-target scoring.
- Mandatory prompt fallbacks.

Each decision-table row has a pure unit fixture. Fixed-seed real-WASM scenarios verify coherent turns and that every reachable mandatory opponent prompt receives a response.
