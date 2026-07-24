# Session Handoff — Experience Prototypes

> Date: 2026-07-24  
> Intended branch: `feature/experience-prototypes`  
> State: implementation complete, final aggregate gate green, ready for review  
> Scope: visual-novel experience prototype + desktop deck-builder prototype + supporting project agent workflow files

## 1. Executive summary

Two isolated prototypes now coexist without changing default direct-duel startup:

1. **Visual novel experience prototype** at `/prototype.html`
   - Launcher, title/load, 30-beat prologue, retained choice, illustrated map, pre-battle briefing, mock battle outcomes, authored outcome/reward flow, manual/autosave persistence, reviewer links, 43 deterministic matrix presets, responsive/a11y/reduced-motion coverage.
   - Uses one namespaced `localStorage` envelope with distinct manual/autosave slots.
   - Initial bundle creates no Worker and requests no duel runtime/WASM assets.

2. **Deck-builder prototype** at `#/prototype/deck-builder`
   - Desktop-only library/editor, card catalog/details, Main/Extra/Side zones, drag + keyboard movement, undo/redo, validation, YDK import/export, failure/revision recovery, isolated IndexedDB persistence, VN-facing `resolveDeck(deckId)` contract.
   - Default route remains direct duel; deck builder loads dynamically.

Both prototypes remain private, provisional, and disposable. Neither establishes production campaign/save architecture.

## 2. Validation state

Final `npm run check` passes.

Latest totals:

- Legacy tests: **21 passed**
- Unit tests: **257 passed**
- Component tests: **92 passed**
- Integration tests: **18 passed**
- Browser tests: **80 passed**
  - Chromium prototype/deck/direct-duel coverage
  - Firefox + WebKit direct-duel smoke
- VN focused unit/component tests: **64 passed**
- VN reviewer presets: **43/43 browser-tested** plus fixed test-owned inventory
- Build verifier: green
- Reproducible build: **122 files**, green
- Runtime snapshot: `a562f5ad6794e377157d91adba6a51d73960d5384a00b25fd8bf1236b0f69fb2`

Evidence:

- `.agentsystem/evidence/final-canonical-check.log`
- `.agentsystem/evidence/section-*-red.log`
- `.agentsystem/evidence/section-*-green.log`
- `.agentsystem/ship-run.md`
- `.agentsystem/ship-vn-run.md`

## 3. Key entry points

### Visual novel

- `prototype.html`
- `src/prototype/PrototypeApp.svelte`
- `src/prototype/model/prototype-state.ts`
- `src/prototype/model/prototype-reducer.ts`
- `src/prototype/content/prologue.ts`
- `src/prototype/storage/prototype-storage.ts`
- `src/prototype/review/review-presets.ts`
- `src/prototype/review/ReviewDrawer.svelte`
- `src/prototype/README.md`
- `docs/card-game-vn-handoff/10-experience-prototype-implementation-plan.md`
- `docs/card-game-vn-handoff/prototype-review-notes.md`

### Deck builder

- `src/prototypes/deck-builder/DeckBuilderPrototype.svelte`
- `src/prototypes/deck-builder/deck-builder-store.ts`
- `src/decks/`
- `src/app/select-app-entry.ts`
- `docs/DECK_BUILDER_PROTOTYPE_SCOPE.md`
- `docs/DECK_BUILDER_PROTOTYPE_IMPLEMENTATION_PLAN.md`

### Build/routing

- `src/main.ts`
- `vite.config.ts`
- `scripts/verify-browser-build.ts`
- `package.json`

## 4. Run locally

```bash
npm install
npm run dev
```

Open:

- Direct duel: `http://localhost:5173/`
- VN prototype: `http://localhost:5173/prototype.html`
- Deck builder: `http://localhost:5173/#/prototype/deck-builder`

Production-like verification:

```bash
npm run check
```

## 5. Product decisions already encoded

### VN

- Illustrated map is primary chapter navigation.
- Always-visible location list is equivalent accessible selection surface.
- Battle remains reviewer mock; no Worker/WASM integration.
- Win/loss/abort/technical failure remain semantically distinct.
- Choice branches reconverge but produce immediate + later acknowledgment.
- Auto/Skip remain visible experiments only.
- Audio remains unavailable.
- Placeholder assets are local/private with provenance notes.

### Deck builder

- Prototype is desktop-only.
- Persistence is isolated from production saves.
- Invalid drafts autosave; validation remains visible.
- VN integration consumes `resolveDeck(deckId)` rather than repository internals.
- Default direct-duel behavior remains unchanged.

## 6. Known limits

- No public deployment approval.
- No final story canon, art, audio, localization, or production campaign schema.
- VN save envelope is intentionally disposable; no migration promise.
- Deck-builder IndexedDB schema is prototype-only.
- VN real-duel handoff remains optional next-round work.
- Agent workflow files under `.pi/`, `.github/skills/`, and `.github/hooks/` are included in this branch because user requested committing everything.

## 7. Recommended next session

1. Run both prototypes and record review decisions in:
   - `docs/card-game-vn-handoff/prototype-review-notes.md`
   - deck-builder plan/review notes
2. Choose VN visual direction A/B/C/hybrid.
3. Decide first production-slice controls: History, Auto, Skip, Hide UI, Save placement.
4. Decide whether next VN round needs real duel integration.
5. Decide whether deck-builder prototype contracts graduate, get revised, or are discarded.
6. Only after product review, draft production architecture/migrations. Do not promote prototype persistence directly.

## 8. Git handoff

Dedicated branch: `feature/experience-prototypes`.

Logical commits already present:

1. project agent/workflow assets;
2. isolated deck-builder prototype;
3. visual-novel experience prototype;
4. completed prototype handoff;
5. validation evidence;
6. final session stop-point details.

## 9. Stop point for next session

- Implementation stopped at user request; no further feature work should be inferred.
- Deck-builder focused verification: **35 files / 98 tests passed**.
- Deck-builder Chromium acceptance: **5/5 passed**, including direct-duel regression, Library import, save retry, and revision-conflict recovery.
- Final deck-builder code and contract reviewer passes reported no blockers.
- Atomic `createAndOpen`, conditional last-opened clearing, corrupt-row isolation, committed-import recovery, and failed-save navigation protection are implemented.
- Implementation-plan checkboxes are complete in `docs/DECK_BUILDER_PROTOTYPE_IMPLEMENTATION_PLAN.md`.
- Next session should begin with product review, not additional implementation, unless explicitly requested.
