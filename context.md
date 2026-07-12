# Project Context

## Purpose and status

YGO Story Duel Simulator is a browser-first, offline Yu-Gi-Oh! duel client. The MVP launches directly into one human-versus-computer duel using bundled preset decks. Project Ignis `ygopro-core` is the sole authority for rules, legal actions, effects, and results.

The repository is currently at the asset-pipeline baseline (Step 00). The browser application structure below is the planned target.

## Documentation routing

- Start with [`docs/README.md`](docs/README.md) for all documentation.
- Use [`docs/architecture/architecture.md`](docs/architecture/architecture.md) as the canonical architecture map and granular task-context router.
- Use [`docs/MVP_TECHNICAL_IMPLEMENTATION_PLAN.md`](docs/MVP_TECHNICAL_IMPLEMENTATION_PLAN.md) for implementation order and acceptance gates.
- Use [`docs/assets/asset-import-pipeline.md`](docs/assets/asset-import-pipeline.md) for the implemented asset pipeline.
- `docs/archive/` is historical only and must not override current decisions.

## Technical stack

| Area | Technology | Role |
|---|---|---|
| Language | TypeScript (strict), Node.js 24+ | Application, contracts, tooling, tests, and opponent policy |
| Build | Vite | Dev server, Worker/WASM handling, and static build |
| UI | Svelte | Application layout, prompts, logs, errors, and results |
| Duel field | Phaser | Presentation-only zones, cards, highlights, and feedback |
| Rules | Vendored `ocgcore-wasm@0.1.2` / Project Ignis `ygopro-core` | Authoritative duel engine |
| Isolation | Dedicated Web Worker | Sole owner of WASM, protocol, scripts, handles, and state projection |
| Data | BabelCDB, CardScripts, Project Ignis strings | Versioned card/effect/protocol snapshot |
| Persistence | IndexedDB via `idb`; Cache Storage | Metadata/preferences/debug runs; image cache |
| Tests | Node test runner initially; Vitest and Playwright planned | Unit/integration and browser smoke coverage |
| Quality | TypeScript, ESLint, Prettier, CI | Types, lint, format, compatibility, assets, and build gates |

## Core architecture rules

- The main thread never imports or calls the engine.
- Raw core messages/indexes remain in the Worker; the UI receives clone-safe typed domain data.
- Opponent hidden information is removed before crossing the Worker boundary.
- Svelte owns application UI; Phaser never determines legality.
- Synchronous core callbacks use preloaded memory and perform no async I/O.
- Engine and Project Ignis assets are pinned and activated as one verified snapshot.
- Production duels shuffle normally; deterministic inputs are test/diagnostic-only.

## File design policy

Prefer small, cohesive, independently navigable files.

- Default to one public interface/type union, component, store, adapter/service, or parser/encoder concern per file.
- Split a unit when it has an independent name, responsibility, test surface, reuse potential, or reason to change.
- Keep tiny private helpers/types beside their sole consumer when separation would obscure rather than clarify behavior.
- Do not split files merely to reduce line count or create pass-through modules.
- Avoid broad “utils”, “types”, and catch-all component files; use domain-specific names and folders.
- Keep imports directional across the architecture boundaries documented above.
- When both choices remain sensible, prefer the additional focused file.

## Target project tree

```text
.
├── context.md                         # Fast project and documentation entry point
├── docs/
│   ├── README.md                      # Documentation index
│   ├── MVP_TECHNICAL_IMPLEMENTATION_PLAN.md
│   ├── architecture/
│   │   ├── architecture.md            # Canonical decision map
│   │   └── <numbered concern folders>/
│   ├── assets/                        # Asset-pipeline documentation
│   └── archive/                       # Superseded historical context
├── package.json
├── tsconfig.json
├── index.html                         # Planned browser entry document
├── vite.config.ts                     # Planned Vite/Svelte/Worker config
├── src/                               # Planned browser application
│   ├── main.ts
│   ├── app/                           # Svelte shell, atomic components, stores
│   ├── duel/                          # Atomic contracts, presentation types, presets
│   ├── field/                         # Phaser scene and presentation bridge
│   ├── worker/                        # Worker entry, engine, protocol, projection, opponent, assets
│   ├── storage/                       # IndexedDB and Cache Storage adapters
│   └── styles/
├── scripts/                           # Existing asset acquisition/verification tools
│   └── lib/                           # Focused pipeline modules
├── tests/                             # Unit/integration/fixture tests
├── e2e/                               # Planned Playwright tests
├── vendor/ocgcore-wasm/0.1.2/         # Planned checked-in verified engine
├── public/{engine,assets}/            # Planned browser-served artifacts
├── generated/                         # Ignored generated snapshot/images
└── .cache/                            # Ignored upstream downloads/temp data
```

Generated assets, caches, and `node_modules/` are not source and remain ignored. Story systems, deck editing, progression, and multiplayer are outside the MVP.
