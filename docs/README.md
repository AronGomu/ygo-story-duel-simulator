# Documentation

This directory contains current project documentation and historical context. Root [`context.md`](../context.md) is the fast entry point for AI and contributors.

## Current sources of truth

| Document | Purpose |
|---|---|
| [`architecture/architecture.md`](architecture/architecture.md) | Canonical architecture index, invariants, and task-based routing |
| [`MVP_TECHNICAL_IMPLEMENTATION_PLAN.md`](MVP_TECHNICAL_IMPLEMENTATION_PLAN.md) | Ordered implementation plan and acceptance gates |
| [`assets/asset-import-pipeline.md`](assets/asset-import-pipeline.md) | Implemented asset acquisition, generation, and verification pipeline |

## Architecture navigation

Architecture decisions are split into narrowly scoped files under [`architecture/`](architecture/). Start at [`architecture/architecture.md`](architecture/architecture.md); its decision map points to the minimum context needed for a task.

```text
architecture/
├── architecture.md          # Canonical map and cross-cutting invariants
├── 01-product/              # Scope and technology choices
├── 02-runtime/              # Platform, topology, Worker contract, duel lifecycle
├── 03-engine/               # OcgCore adapter, protocol/state, opponent
├── 04-data/                 # Snapshots, cards/scripts, images, storage
├── 05-presentation/         # Svelte–Phaser ownership boundary
├── 06-quality/              # Testing and diagnostics
└── 07-governance/           # Security, licensing, future extensions
```

## Historical material

[`archive/`](archive/) contains superseded research and rejected directions. Use it for rationale/history only; it cannot override current architecture or the MVP plan.
