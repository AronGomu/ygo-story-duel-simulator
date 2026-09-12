# ADR-022: Three-UI Modular Monolith and Worktree Boundaries

> Status: accepted
> Decided: 2026-08-14
> Owners: application-shell, duel, deck-editor, visual-novel architecture
> Superseded in part by ADR-045 (branch topology only; the import boundaries stand).
> Amended by [ADR-081](081_ADR_asset_roots_and_delivery_profiles.md): asset-only `assets/shared/` allowed; generic shared code prohibition and public-entry boundaries remain.

## Context

Product has three full-screen UI domains:

1. Duel Simulator;
2. Deck Editor;
3. Visual Novel.

They must feel like one application while allowing parallel development in separate Git worktrees. Prototype branch proved deck-editor and visual-novel UX, but uses two entry documents and prototype-only routing/persistence. Keeping three independent apps would duplicate shell, deployment, storage, design tokens, offline behavior, and cross-domain handoff code. A microfrontend/runtime federation layer would add failure modes without independent deployment need.

Vendored OCG Core is frozen permanently at `vendor/ocgcore-wasm/0.1.2`. Only Duel Simulator may access Worker/engine internals.

## Decision

Use one modular monolith:

- one repository;
- one npm package and lockfile;
- one Vite application build;
- one browser origin;
- one Svelte application shell;
- three lazy-loaded feature roots;
- one atomic release.

Separate modules in source, not separate applications at runtime.

```text
src/main.ts
└── src/shell/
    ├── routes.ts
    ├── AppShell.svelte
    └── public contracts
        ├── Duel Simulator facade
        ├── Deck Editor facade
        └── Visual Novel facade
```

`prototype.html` remains temporary review infrastructure. Production migration ends with all three domains reachable through `index.html`; prototype entry/route code is removed after parity gates pass.

## Domain ownership

| Owner | Exclusive production paths | Transitional paths |
| --- | --- | --- |
| Duel Simulator | `src/battle/` (`app/`, `duel/`, `field/`, `worker/`, `storage/`), duel-owned tests | none |
| Deck Editor | `src/decks/`, future `src/deck-editor/`, deck tests | `src/prototypes/deck-builder/` |
| Visual Novel | future `src/story/`, story content/tests | `src/prototype/` |
| Integration | `src/main.ts`, `src/shell/`, route table, root design tokens, build/package/ESLint/Playwright config, cross-domain E2E, canonical architecture docs | `prototype.html` |

Existing duel files stay in place initially. `src/battle/index.ts` wraps them behind a facade before any optional file move. No broad rename/refactor accompanies shell introduction.

## Dependency direction

```text
main → shell
shell → battle/index, decks/index, story/index
story → battle contract types, deck reference types
battle → immutable validated deck snapshot type
battle → existing duel/app/field/worker internals
decks → static catalog/ruleset data
worker → frozen OCG Core
```

Rules:

- every domain exports one public `index.ts`;
- cross-domain imports target public entry points only;
- no domain deep-imports another domain;
- domains return typed intents/results; they never navigate or mount each other;
- shell owns route transitions, composition, global recovery, and lazy loading;
- no generic `shared`, `common`, `utils`, or catch-all `core` directory;
- contract ownership follows authority: deck IDs in decks, battle results in battle, campaign state in story, routes in shell;
- persisted/public contracts are readonly, serializable, bounded discriminated unions;
- contract changes land through Integration first, then domain branches rebase.

## Routes and seamless behavior

Use typed hash routes for static hosting:

```text
#/story
#/decks
#/decks/:deckId
#/duel
#/duel/session/:handoffId
```

Shell may hide global chrome during immersive narrative/duel screens, but route changes stay inside one document. Shared transitions, error surface, typography, focus restoration, and design tokens make domain changes feel native rather than app launches.

Browser Back during active duel must request explicit exit/surrender, dispose Worker, then transition. Reload of a correlated story duel restores pre-duel recovery, never guesses duel state.

## Cross-domain contracts

Required narrow contracts:

- Deck Editor owns `DeckId`, `DeckRevisionRef`, `ValidatedDeckSnapshot`, `resolveDeck`.
- Duel Simulator owns `BattleRequest`, `BattleFacadeResult`, session lifecycle/disposal.
- Visual Novel owns `CampaignState`, `EncounterId`, `HandoffId`, checkpoint/recovery state.
- Shell owns routes and feature-mount lifecycle.

Story-to-duel flow:

1. Story persists pre-duel checkpoint with stable `handoffId` and exact deck revision.
2. Shell resolves immutable deck snapshot through Deck Editor public API.
3. Duel facade validates request against frozen supported-card/ruleset data.
4. Duel facade starts/disposes Worker; OCG Core remains sole rule authority.
5. Facade returns normalized resolved/aborted/failed result.
6. Story accepts result only when `handoffId` matches; technical failure never becomes player loss.

Custom decks extend duel-owned Worker start wrapper only. Deck Editor and Visual Novel never import `src/battle/worker/**`.

## Persistence

Use separate ownership databases to avoid cross-worktree schema conflicts:

| Domain | Store |
| --- | --- |
| Duel Simulator | existing duel snapshot/debug stores |
| Deck Editor | production deck records/history DB |
| Visual Novel | campaign saves/checkpoints DB |

No cross-database atomicity assumption. Cross-domain operations use persisted correlation IDs and recoverable saga steps. `localStorage` is limited to small namespaced UI preferences.

## Frozen OCG Core

- `vendor/ocgcore-wasm/0.1.2/**` is immutable.
- No UI branch may edit vendor files, engine version, vendor manifest, or core loader resolution.
- `npm run vendor:verify` remains mandatory.
- New deck/story behavior adapts around existing Worker/core boundary.
- Card catalog/content policy is separate from engine binary policy; supported cards must be explicit and validated before Worker start.

## Worktree workflow

> Fork point: commit tagged `restructure-complete` (T21, 2026-08-15).
> All domain branches start from this commit.

Recommended topology: one Integration worktree plus three UI worktrees.

```text
main            # Integration — shell, contracts, merges, aggregate E2E
duel-simulator  # Duel Simulator ownership paths only  (port 4300)
deckbuilder     # Deck Editor ownership paths only     (port 4301)
vn              # Visual Novel ownership paths only    (port 4302)
```

To open a domain lane from the fork point:

```sh
# from the integration repo
git worktree add -b duel-simulator ../ui-duel restructure-complete
git worktree add -b deckbuilder    ../ui-decks restructure-complete
git worktree add -b vn             ../ui-story restructure-complete
```

Domain branches must never merge each other. If a domain needs a contract change:

1. stop domain implementation;
2. land the contract change in `main` (Integration worktree);
3. validate — `npm run check:headless` + full build — and commit;
4. rebase affected domain branches onto the new `main` tip;
5. resume against the updated contract.

Each worktree binds a fixed port via `DEV_PORT` / `PLAYWRIGHT_PORT`:

- Duel Simulator: `4300` — `DEV_PORT=4300 npm run dev`
- Deck Editor: `4301` — `DEV_PORT=4301 npm run dev`
- Visual Novel: `4302` — `DEV_PORT=4302 npm run dev`

Focused tests run in domain worktrees; `npm run build` and E2E run only in the Integration worktree after each merge. Byte budgets are enforced by `npm run build:verify`: one ceiling for the shell cold-start closure and one per lazy domain chunk, measured in `scripts/lib/domain-chunk-closure.ts` and gated in `scripts/verify-browser-build.ts`. A domain's number is what visiting its route costs on top of the shell, so chunks the shell already loaded are not charged twice.

A breach fails the build with the domain named:

```
Error: battle domain closure exceeds its production budget: 501234 > 488750 bytes
```

A lane that outgrows its ceiling raises it in the Integration worktree with a fresh measurement, the same way a contract change lands. Run `npm run build:verify` after every integration merge to catch chunk growth. If only three total worktrees are allowed, the Duel worktree may temporarily double as Integration, but shell/config commits must remain separate from duel feature commits.

## Merge policy

- Domain commits modify owned paths only.
- Root config/new dependency changes land in Integration before parallel work.
- Integration owner wires public APIs and owns cross-domain E2E.
- Merge order: shell/contracts → duel facade → deck/story independently → persistence → story/duel handoff → custom-deck Worker wrapper → prototype removal.
- No feature branch modifies vendored OCG Core.

## Alternatives rejected

- **Three separate deployable apps.** Duplicates shell/storage/offline/release concerns; visible navigation seams; harder atomic compatibility.
- **Workspace monorepo with three packages.** More package/version/build overhead without independent release need.
- **Microfrontends/iframes/module federation.** Runtime complexity, a11y/focus issues, duplicated Svelte runtime, unnecessary network boundaries.
- **One giant `App.svelte`.** High merge-conflict rate and implicit cross-domain coupling.
- **Move all current duel files now.** Large regression surface; facade-first migration is safer.

## Consequences

- Users receive one seamless application and atomic version.
- Three teams/agents can iterate in parallel with low overlap.
- Shell/public contracts become deliberately stable integration points.
- Integration worktree is required for route/config/cross-domain changes.
- Prototype code must be migrated, not declared production merely because it is merged.
- Separate domain storage requires explicit recoverable handoff logic.
