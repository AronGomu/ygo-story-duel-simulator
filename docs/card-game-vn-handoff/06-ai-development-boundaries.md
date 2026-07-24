# AI Development Boundaries

> Status: approved future design; apply incrementally with each domain phase

## Objective

Let humans and AI change one domain with minimal unrelated context while retaining one application package and current test/release gates.

Isolation comes from ownership, public entry points, lint constraints, focused docs, and tests—not workspace package overhead.

## Required domain files

Each implemented domain contains:

```text
src/<domain>/
├── index.ts       # only public runtime/type exports
├── README.md      # architecture, API, data flow, validation
├── AGENTS.md      # task context and hard boundaries
└── focused implementation folders
```

Tests remain under existing central `tests/` hierarchy, grouped by domain. Do not create per-domain `package.json` or `tsconfig.json`.

## AGENTS.md template

Each file states:

- responsibility;
- explicit non-responsibilities;
- public entry point;
- allowed dependencies;
- forbidden imports;
- owned persisted schemas/contracts;
- error and observability expectations;
- relevant fixtures;
- exact focused validation commands;
- broader required gate before handoff.

## Domain scopes

### Shell task

Primary context:

```text
src/shell/
src/main.ts
public API of affected feature domains
```

Allowed:

- compose public feature APIs;
- own `GameMode`, overlays, effect execution, update prompts;
- map typed feature completion to campaign commands.

Forbidden:

- parse narrative/map/content JSON;
- interpret duel protocol;
- mutate campaign state outside reducer;
- deep import feature internals.

### Campaign task

```text
src/campaign/
content/campaigns/ fixtures relevant to test
```

Allowed:

- pure state/command/effect contracts;
- variable definitions and conditions;
- progression, objectives, rewards, map evaluation;
- save-compatible state migrations.

Forbidden:

- Svelte, DOM, Worker, fetch, IndexedDB, Cache Storage;
- direct battle/map/content/save implementation call;
- arbitrary content code execution.

### Narrative task

```text
src/narrative/
content/scenes/ relevant fixtures
```

Allowed:

- scene parser/validator;
- cursor interpreter;
- immutable presentation state;
- narrative intent contracts.

Forbidden:

- direct campaign mutation;
- feature gateway calls;
- asset URL resolution;
- Svelte/browser dependencies in runtime core.

### Map task

```text
src/map/
content/maps/ relevant fixtures
```

Allowed:

- validated map definitions;
- render evaluated view;
- hotspot/list parity;
- return selected/cancelled result.

Forbidden:

- read raw campaign variable bag;
- evaluate unlock conditions;
- resolve destination scene;
- call battle/narrative directly.

### Battle integration task

```text
src/battle/
public surfaces of existing src/app/, src/duel/, src/field/, src/worker/
```

Allowed:

- facade request validation;
- mount current battle UI;
- map current result to normalized facade result;
- lifecycle/disposal integration.

Forbidden:

- weaken Worker authority/privacy;
- duplicate existing duel contracts;
- expose raw `DuelResult` or Worker event stream to campaign;
- permit seed/order/script/programmed-mode input;
- alter duel internals unless task explicitly requires it and all current gates run.

### Deck task

```text
src/decks/
relevant deck fixtures
```

Allowed:

- versioned records;
- validation;
- IndexedDB repository;
- YDK import/export;
- editor UI.

Forbidden:

- hidden campaign card-ownership restriction;
- silent card-list correction;
- direct Worker protocol construction.

### Save task

```text
src/saves/
src/campaign/ public persisted contracts
src/decks/ public revision refs
src/content/ public pack refs
```

Allowed:

- envelope validation;
- atomic slots/autosaves/checkpoints;
- explicit pure migrations;
- compatibility diagnostics.

Forbidden:

- serialize live Worker/WASM state;
- silent defaulting/coercion;
- mutate deck/content records during load.

### Content/asset task

```text
src/content/
src/assets/
content/packs/
```

Allowed:

- manifests, download, verification, staging, activation;
- installation-global default/fallback pointers and campaign-session pinning rules;
- logical asset resolution.

Forbidden:

- own app-shell service-worker caches;
- alter duel snapshot atomicity;
- activate partially verified bytes;
- return untracked object URLs.

### PWA task

```text
src/pwa/
vite.config.ts
service-worker source
web app manifest
```

Allowed:

- app-shell precache/navigation fallback;
- registration/update coordinator;
- safe-boundary activation messages.

Forbidden:

- own story/media pack activation;
- force reload during unsafe state;
- bypass private-build gate.

### Content-authoring task

```text
content/
content schemas/fixtures exposed for authors
```

Forbidden by default:

- runtime source changes;
- new command/operator without schema/runtime/test change;
- unregistered asset IDs;
- executable JS/TS/Lua in story packs.

## Import enforcement

Use ESLint `no-restricted-imports` or equivalent project-local rule:

- cross-domain imports must target `src/<domain>/index.ts` or approved alias;
- importing `src/<other-domain>/<internal-path>` fails lint;
- campaign/narrative pure cores cannot import Svelte, Phaser, `idb`, service-worker code, Worker clients, or browser globals;
- only existing Worker-owned adapter may import vendored engine;
- only battle facade may bridge campaign shell to current duel internals.

During migration, temporary exceptions must:

1. name exact import path;
2. include removal phase in comment/config;
3. never weaken engine/privacy constraints;
4. be deleted when owning public facade lands.

No broad wildcard exception.

## Public API rules

- Export only contracts and operations consumers need.
- No wildcard export of internal folders.
- No mutable singleton state across domains.
- Repository/service instances are composed by shell.
- Pure reducers/interpreters receive all inputs explicitly.
- Browser adapters sit behind owned interfaces.
- IDs and validation parsers are exported by owning domain.

## Utility rule

Before adding helper:

1. search owning domain;
2. search project for semantically identical helper;
3. place helper in narrow owner domain;
4. promote cross-domain helper only after at least two true consumers share same semantics.

Never create generic `shared`, `common`, `utils`, or `core` dumping grounds.

## Test ownership

```text
tests/unit/campaign/
tests/unit/narrative/
tests/unit/map/
tests/unit/decks/
tests/unit/saves/
tests/unit/content/
tests/unit/pwa/
tests/component/narrative/
tests/component/map/
tests/component/shell/
tests/integration/story-battle-flow/
e2e/prologue-offline.spec.ts
```

Minimum domain gates:

- parsers: valid + malformed + exact-key + bounds + reference failures;
- reducers/interpreters: deterministic state transitions + exhaustive variants;
- effects: stale/duplicate ID rejection;
- storage: atomicity, migration, interruption, quota;
- UI: keyboard, focus, loading/error/empty, reduced motion, accessible names;
- integration: real current battle facade, not mocked Worker, for final vertical slice;
- PWA: production build offline tests.

## Validation commands

Focused commands may be added, but every phase finishes with existing mandatory gates:

```bash
npm run format
npm run check
```

Before current full browser gate is affordable during a small pure-domain iteration, run at minimum:

```bash
npm run format:check
npm run lint
npm run typecheck
npm run test:unit
```

No phase is accepted until full `npm run check` passes.

## Documentation rule

When a phase lands:

- update owning canonical architecture docs under `docs/architecture/`;
- update this handoff status/phase checklist;
- update domain README/AGENTS;
- update save/content schema migration docs where applicable;
- do not leave handoff claiming unimplemented contract is live.
