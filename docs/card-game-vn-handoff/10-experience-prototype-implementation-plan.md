# Visual Novel Experience Prototype — TDD Implementation Plan

> Status: implemented and validated (non-git delivery complete)  
> Scope authority: [`09-experience-prototype-scope.md`](09-experience-prototype-scope.md)  
> Product decision: illustrated map is primary chapter-navigation surface  
> Delivery rule: each numbered section is independently testable and committable

## 1. Goal

Implement isolated, disposable visual-novel UX prototype without changing current direct-duel behavior or creating production campaign architecture.

Target flow:

```text
Launcher
→ Title
→ New Game / mock Load
→ Narrative
→ Choice
→ Illustrated map
→ Pre-battle briefing
→ Mock battle outcome
→ Outcome scene
→ Reward/progression
→ Updated map
→ Save feedback
→ End/review
```

## 2. Mandatory TDD loop

Apply this loop to every committable section:

- [x] Write smallest automated test proving next behavior.
- [x] Run focused test; confirm failure for expected missing behavior.
- [x] Record RED evidence in commit notes or working log.
- [x] Implement minimum code needed to pass.
- [x] Run focused test; confirm GREEN.
- [x] Refactor only code introduced by current section.
- [x] Re-run focused test after refactor.
- [x] Run formatting, type, lint, unit, component, integration, build, reproducibility, browser gates through `npm run check`.
- [x] Confirm current direct-duel E2E remains green.
- [x] Defer section commit until `/commit`; all section gates pass.

Never write production behavior before failing test. Visual-only details must still receive semantic/component, state, responsive, or browser assertions before implementation.

## 3. Commit boundaries

- [x] Preserve each numbered section as a standalone future commit boundary; `/ship` performs no git writes.
- [x] Keep prototype commit plan isolated from unrelated cleanup, architecture migration, and duel changes.
- [x] Keep current `index.html` direct-duel entry behavior unchanged.
- [x] Keep prototype code under `src/prototype/` except required root/config/test/doc files.
- [x] Do not import from `src/duel/`, `src/worker/`, `src/field/`, or `src/storage/`.
- [x] Do not add runtime deps unless implementation cannot proceed with existing Svelte/Vite/Vitest/Playwright stack.
- [x] Keep private-distribution safeguards intact.
- [x] Retain suggested conventional messages for deferred `/commit` workflow.

---

## Section 0 — Baseline evidence

**Commit:** none unless baseline documentation changes  
**Purpose:** prove starting tree is green before prototype work.

### Steps

- [x] Record current branch and working-tree status without changing unrelated files.
- [x] Record runtime snapshot ID and current test counts from latest trusted handoff.
- [x] Run `npm run format:check`.
- [x] Run `npm run lint`.
- [x] Run `npm run typecheck`.
- [x] Run `npm test`.
- [x] Run `npm run build`.
- [x] Run `npm run build:reproducible`.
- [x] Run `npm run test:e2e`.
- [x] Run `npm run check` as canonical baseline proof.
- [x] Stop prototype work if failure represents current baseline rather than planned RED test.
- [x] Save command/result summary in implementation notes.

### Validation gate

- [x] Current direct-duel app initializes from root URL.
- [x] Existing Worker/privacy/browser tests pass.
- [x] No baseline repair is bundled into prototype commits.

---

## Section 1 — Isolated prototype entry and boundary guard

**Suggested commit:** `feat(prototype): add isolated visual novel entry`

### RED — tests first

- [x] Add `tests/unit/prototype/prototype-boundaries.test.ts`.
- [x] Assert every source import under `src/prototype/` rejects `app`, `duel`, `field`, `storage`, and `worker` domains.
- [x] Assert prototype entry cannot be current `src/main.ts`.
- [x] Add `e2e/prototype-entry.spec.ts`.
- [x] Assert `/prototype.html` loads heading `Visual novel prototype`.
- [x] Assert prototype page exposes `Start full flow` and `Jump to screen or state`.
- [x] Assert root URL still reaches current direct-duel UI.
- [x] Run `npx vitest run tests/unit/prototype/prototype-boundaries.test.ts`; confirm RED because prototype entry does not exist.
- [x] Run `npx playwright test e2e/prototype-entry.spec.ts --project=chromium`; confirm RED because `/prototype.html` is absent.

### GREEN — minimum implementation

- [x] Add `prototype.html` with private/prototype metadata and `#prototype-app` mount point.
- [x] Add `src/prototype/main.ts`.
- [x] Add minimal `src/prototype/PrototypeApp.svelte` launcher shell.
- [x] Add `src/prototype/styles.css` with prototype-scoped root tokens; do not mutate current `src/styles/app.css`.
- [x] Configure Vite multi-page input for `index.html` and `prototype.html`.
- [x] Update browser-build verifier to require packaged `prototype.html` while preserving all current runtime checks.
- [x] Add clear prototype/private status copy.
- [x] Re-run boundary unit test; confirm GREEN.
- [x] Re-run prototype entry E2E; confirm GREEN.

### Refactor and validation

- [x] Remove any accidental duplicate mount/config code.
- [x] Run `npm run check`.
- [x] Inspect production `dist/prototype.html`.
- [x] Confirm prototype bundle does not initialize Worker or fetch runtime snapshot.
- [x] Confirm root direct-duel bundle behavior remains unchanged.
- [x] Defer commit until `/commit`; gate passes.

---

## Section 2 — Pure prototype state model and sample content

**Suggested commit:** `feat(prototype): add tested story state model`

### RED — tests first

- [x] Add `tests/unit/prototype/prototype-state.test.ts`.
- [x] Define expected screen union: launcher, title, load, narrative, map, pre-battle, battle mock, outcome, reward, end.
- [x] Test New Game starts first narrative beat.
- [x] Test Continue resumes mock progress.
- [x] Test Load selects occupied manual/autosave slot.
- [x] Test dialogue advance cannot skip two beats from duplicate input.
- [x] Test choice records selected option once.
- [x] Test immediate choice response differs by option.
- [x] Test later map/story acknowledgment reads retained choice.
- [x] Test map selection accepts available location only.
- [x] Test locked/hidden locations cannot navigate.
- [x] Test battle win/loss/abort/failure produce distinct state variants.
- [x] Test win/loss route to separate scenes.
- [x] Test abort/failure never grant progression.
- [x] Test resolved outcome grants one reward/flag exactly once.
- [x] Test reset returns pristine state.
- [x] Test every state is serializable.
- [x] Run `npx vitest run tests/unit/prototype/prototype-state.test.ts`; confirm RED.

### GREEN — minimum implementation

- [x] Add `src/prototype/model/prototype-state.ts`.
- [x] Add `src/prototype/model/prototype-reducer.ts`.
- [x] Use small discriminated state/command unions; avoid production campaign abstractions.
- [x] Add `src/prototype/content/prologue.ts` as typed in-code mock fixture.
- [x] Author 25–40 provisional dialogue/narration beats.
- [x] Author 2 speaking characters plus protagonist thought voice.
- [x] Author one 2–3 option choice with immediate reactions.
- [x] Author later choice acknowledgment.
- [x] Author two illustrated-map locations: one available, one locked.
- [x] Author reviewer-only hidden/completed/available-completed variants.
- [x] Author pre-battle briefing.
- [x] Author win, loss, abort, and technical-failure content.
- [x] Author one reward/objective update.
- [x] Implement pure reducer transitions only; no DOM/localStorage calls.
- [x] Re-run state tests; confirm GREEN.

### Refactor and validation

- [x] Remove unreachable commands and speculative generic APIs.
- [x] Confirm reducer file stays prototype-specific.
- [x] Run `npm run check`.
- [x] Defer commit until `/commit`; gate passes.

---

## Section 3 — Visual-direction boards

**Suggested commit:** `feat(prototype): add visual direction comparison`

### RED — tests first

- [x] Add `tests/component/prototype/VisualDirectionBoards.test.ts`.
- [x] Assert exactly three named directions render: Existing client continuity, Duel-anime broadcast, Cinematic visual novel.
- [x] Assert each direction uses same title, dialogue beat, and illustrated-map state.
- [x] Assert each direction explains benefit and risk.
- [x] Assert direction selection is keyboard-operable.
- [x] Assert selected direction is exposed semantically.
- [x] Run `npx vitest run tests/component/prototype/VisualDirectionBoards.test.ts`; confirm RED.

### GREEN — minimum implementation

- [x] Add `src/prototype/components/VisualDirectionBoards.svelte`.
- [x] Implement Direction A with dark navy, teal accent, restrained chrome.
- [x] Implement Direction B with stronger broadcast framing and objective energy.
- [x] Implement Direction C with image-dominant composition and quiet chrome.
- [x] Ensure differences include hierarchy, density, typography, framing, or topology—not palette only.
- [x] Set Direction A as proposed full-flow default without marking it approved.
- [x] Add direction selection to launcher.
- [x] Re-run component test; confirm GREEN.

### Refactor and validation

- [x] Keep comparison styles scoped to direction boards.
- [x] Avoid production token system or theme engine.
- [x] Run `npm run check`.
- [x] Manually inspect boards at 1280 × 720 and 375 × 667.
- [x] Defer commit until `/commit`; gate passes.

---

## Section 4 — Title, New Game, Continue, Load

**Suggested commit:** `feat(prototype): add title and mock load flow`

### RED — tests first

- [x] Add `tests/component/prototype/TitleAndLoad.test.ts`.
- [x] Test title renders New Game, Load, Settings.
- [x] Test Continue appears only when mock progress exists.
- [x] Test New Game transitions directly to prologue.
- [x] Test Continue resumes saved prototype screen.
- [x] Test Load screen shows occupied manual slot, autosave, empty slot.
- [x] Test save summaries include chapter/location, playtime, timestamp, preview.
- [x] Test incompatible/corrupt example is reachable from reviewer state.
- [x] Test Delete requires confirmation.
- [x] Test Back restores title focus.
- [x] Run `npx vitest run tests/component/prototype/TitleAndLoad.test.ts`; confirm RED.

### GREEN — minimum implementation

- [x] Add `src/prototype/screens/TitleScreen.svelte`.
- [x] Add `src/prototype/screens/LoadScreen.svelte`.
- [x] Add reusable prototype-only confirm dialog if tests require it.
- [x] Connect screens to pure prototype reducer.
- [x] Add provisional title composition.
- [x] Keep version/prototype marker secondary.
- [x] Place initial focus on primary action.
- [x] Implement empty/incompatible/corrupt load examples as mock states.
- [x] Re-run component test; confirm GREEN.

### Refactor and validation

- [x] Remove duplicated action/focus code introduced in section.
- [x] Run `npm run check`.
- [x] Keyboard-test New Game, Load, Delete confirmation, Back.
- [x] Defer commit until `/commit`; gate passes.

---

## Section 5 — Narrative presentation and meaningful choice

**Suggested commit:** `feat(prototype): add narrative and choice experience`

### RED — tests first

- [x] Add `tests/component/prototype/NarrativeScreen.test.ts`.
- [x] Test narration, named dialogue, protagonist thought.
- [x] Test one-character and two-character compositions.
- [x] Test expression change and character exit.
- [x] Test background change.
- [x] Test short, long, and multiline dialogue.
- [x] Test `Enter`, `Space`, click, and tap-equivalent advance one beat only.
- [x] Test focused control blocks global advance shortcut.
- [x] Test choice input cannot be accidentally selected by prior advance key.
- [x] Test choice focus and selected semantics.
- [x] Test immediate response changes by choice.
- [x] Test Hide UI preserves narrative cursor.
- [x] Test missing sprite/background fallback.
- [x] Test complete dialogue line is exposed without character-by-character live-region spam.
- [x] Run `npx vitest run tests/component/prototype/NarrativeScreen.test.ts`; confirm RED.

### GREEN — minimum implementation

- [x] Add `src/prototype/screens/NarrativeScreen.svelte`.
- [x] Add focused components only where independently testable: background, character layer, dialogue box, choice list, utility controls.
- [x] Add replaceable local placeholder backgrounds/sprites with provenance note.
- [x] Implement speaker, narration, thought, expression, enter/exit, background state.
- [x] Implement visible advance cue.
- [x] Implement keyboard/click/touch advance guard.
- [x] Implement choice state and immediate acknowledgment.
- [x] Implement Hide UI and restore action.
- [x] Implement deterministic missing-asset fallback.
- [x] Add restrained default transitions.
- [x] Re-run narrative component test; confirm GREEN.

### Refactor and validation

- [x] Remove duplicated speaker/asset mapping.
- [x] Verify UI remains usable with animations disabled.
- [x] Run `npm run check`.
- [x] Complete narrative-to-choice path by keyboard only.
- [x] Defer commit until `/commit`; gate passes.

---

## Section 6 — History, Settings, Pause, Save/Load overlays

**Suggested commit:** `feat(prototype): add narrative utility overlays`

### RED — tests first

- [x] Add `tests/component/prototype/PrototypeOverlays.test.ts`.
- [x] Test History lists current-scene entries in declared order.
- [x] Test empty History state.
- [x] Test Settings exposes text speed, auto speed, transition preference, disabled audio notice, fullscreen support state, reset.
- [x] Test changed Settings state and reset.
- [x] Test close restores invoking control.
- [x] Test `Escape` closes only top overlay.
- [x] Test Pause supports Resume, Save, Load, Settings, Return to Title.
- [x] Test unsaved progress requires Return to Title confirmation.
- [x] Test Save success, overwrite, and simulated failure states.
- [x] Test Auto and Skip are marked experimental, not fully functional.
- [x] Run `npx vitest run tests/component/prototype/PrototypeOverlays.test.ts`; confirm RED.

### GREEN — minimum implementation

- [x] Add `src/prototype/overlays/HistoryOverlay.svelte`.
- [x] Add `src/prototype/overlays/SettingsOverlay.svelte`.
- [x] Add `src/prototype/overlays/PauseOverlay.svelte`.
- [x] Add `src/prototype/overlays/SaveLoadOverlay.svelte` or reuse tested Load surface where simpler.
- [x] Use semantic dialog behavior with explicit label and bounded scroll.
- [x] Implement focus placement, trap, close, and restoration.
- [x] Implement prototype settings in local component/state model only.
- [x] Keep audio controls disabled with explicit prototype copy.
- [x] Implement Save feedback without production persistence contracts.
- [x] Re-run overlay component test; confirm GREEN.

### Refactor and validation

- [x] Consolidate only genuinely repeated dialog behavior.
- [x] Avoid modal nesting beyond one tested confirmation layer.
- [x] Run `npm run check`.
- [x] Keyboard-test overlay open/close/focus paths.
- [x] Defer commit until `/commit`; gate passes.

---

## Section 7 — Illustrated map hub

**Suggested commit:** `feat(prototype): add illustrated map navigation`

**Fixed decision:** illustrated map is primary chapter navigation. No chapter-menu variant.

### RED — tests first

- [x] Add `tests/component/prototype/IllustratedMap.test.ts`.
- [x] Test illustrated map, objective, hotspot layer, marker states, location list.
- [x] Test hotspot and list expose same location IDs.
- [x] Test focusing/selecting hotspot synchronizes list detail.
- [x] Test focusing/selecting list synchronizes hotspot detail.
- [x] Test available location navigates to destination.
- [x] Test locked location remains visible, explains reason, cannot activate.
- [x] Test hidden location appears in neither hotspot nor list.
- [x] Test completed styling remains separate from access.
- [x] Test available-completed location remains selectable.
- [x] Test authored order controls keyboard order, not absolute coordinates.
- [x] Test Back renders only when state allows it.
- [x] Test every interactive map target has accessible name/state/marker description.
- [x] Run `npx vitest run tests/component/prototype/IllustratedMap.test.ts`; confirm RED.

### GREEN — minimum implementation

- [x] Add `src/prototype/screens/IllustratedMapScreen.svelte`.
- [x] Add one replaceable illustrated map asset.
- [x] Add percentage-positioned hotspot buttons.
- [x] Add always-present equivalent location list.
- [x] Add objective panel.
- [x] Add available, locked, hidden, completed, available-completed presentation.
- [x] Add synchronized selection/detail preview.
- [x] Add marker styles for story, battle, locked, completed.
- [x] Add clear locked reason.
- [x] Connect available location to pre-battle/story destination.
- [x] Re-run illustrated-map component test; confirm GREEN.

### Refactor and validation

- [x] Keep map evaluation as mock view state; do not build production condition engine.
- [x] Verify no chapter menu was added.
- [x] Run `npm run check`.
- [x] Test map by keyboard, pointer, and 375px touch viewport.
- [x] Defer commit until `/commit`; gate passes.

---

## Section 8 — Pre-battle briefing and mock battle boundary

**Suggested commit:** `feat(prototype): add mock battle handoff`

### RED — tests first

- [x] Add `tests/component/prototype/BattleHandoff.test.ts`.
- [x] Test briefing shows opponent, stakes, deck labels, objective/format.
- [x] Test Start Duel enters battle handoff once.
- [x] Test Return to Map appears only when allowed.
- [x] Test mock pre-battle save confirmation appears.
- [x] Test reviewer controls simulate win, loss, abort, technical failure.
- [x] Test reviewer controls are clearly labeled non-player tooling.
- [x] Test win and loss produce distinct normalized prototype outcomes.
- [x] Test abort offers retry/return without progression.
- [x] Test technical failure offers retry/return without story defeat.
- [x] Test no mock action imports or invokes real Worker.
- [x] Run `npx vitest run tests/component/prototype/BattleHandoff.test.ts`; confirm RED.

### GREEN — minimum implementation

- [x] Add `src/prototype/screens/PreBattleScreen.svelte`.
- [x] Add `src/prototype/screens/BattleHandoffScreen.svelte`.
- [x] Add one strong but reduced-motion-safe battle transition.
- [x] Frame current duel experience as placeholder without reproducing duel field.
- [x] Add reviewer-only outcome selector.
- [x] Route win/loss/abort/failure through pure reducer.
- [x] Keep technical failure visually and semantically separate from authored loss.
- [x] Re-run battle-handoff component test; confirm GREEN.

### Refactor and validation

- [x] Remove any accidental duel-domain import.
- [x] Re-run prototype boundary unit test.
- [x] Run `npm run check`.
- [x] Confirm network log shows no duel runtime/WASM fetch on prototype flow.
- [x] Defer commit until `/commit`; gate passes.

---

## Section 9 — Outcome, reward, progression, prototype persistence

**Suggested commit:** `feat(prototype): add outcomes and progression feedback`

### RED — tests first

- [x] Add `tests/component/prototype/OutcomeProgression.test.ts`.
- [x] Test player win renders win-specific scene.
- [x] Test player loss renders loss-specific scene.
- [x] Test both resolved branches can continue.
- [x] Test abort/failure recovery never renders reward.
- [x] Test reward/flag reveal occurs once.
- [x] Test objective copy changes after resolved battle.
- [x] Test illustrated-map completed/available state changes after reward acknowledgment.
- [x] Test autosave indicator appears only at stable boundary.
- [x] Test manual Save writes mock state.
- [x] Test storage failure preserves playable in-memory state.
- [x] Add `tests/unit/prototype/prototype-storage.test.ts`.
- [x] Test localStorage adapter exact parsing, missing value, invalid value, reset.
- [x] Test adapter never reads/writes production DB or snapshot keys.
- [x] Run focused component/unit tests; confirm RED.

### GREEN — minimum implementation

- [x] Add `src/prototype/screens/OutcomeScreen.svelte`.
- [x] Add `src/prototype/screens/RewardScreen.svelte`.
- [x] Add `src/prototype/storage/prototype-storage.ts` using namespaced `localStorage` key.
- [x] Add one compact reward/progression treatment.
- [x] Add explicit objective update.
- [x] Update illustrated-map mock state after resolved outcome.
- [x] Add non-blocking autosave feedback.
- [x] Add manual Save success, overwrite, and failure feedback.
- [x] Keep `Continue Without Saving` available after simulated failure.
- [x] Re-run focused tests; confirm GREEN.

### Refactor and validation

- [x] Keep serialization shape local and disposable.
- [x] Confirm no IndexedDB/save-domain abstraction was introduced.
- [x] Run `npm run check`.
- [x] Reload browser and verify mock Continue/Load behavior.
- [x] Defer commit until `/commit`; gate passes.

---

## Section 10 — Reviewer launcher, state controls, shareable links

**Suggested commit:** `feat(prototype): add reviewer state tooling`

### RED — tests first

- [x] Add `tests/component/prototype/ReviewerTools.test.ts`.
- [x] Test every state-matrix entry is reachable within two actions from launcher/review drawer.
- [x] Test jump-to-screen.
- [x] Test set choice result.
- [x] Test map available/locked/hidden/completed/available-completed controls.
- [x] Test battle result selector.
- [x] Test missing-asset toggle.
- [x] Test save/storage-failure toggle.
- [x] Test reduced-motion preview toggle.
- [x] Test reset.
- [x] Test readable current-state JSON.
- [x] Test reviewer controls remain clearly separate from player UI.
- [x] Add `tests/unit/prototype/review-link.test.ts`.
- [x] Test supported state serializes into bounded URL query.
- [x] Test malformed/unknown query values fall back safely.
- [x] Test copied link restores same supported review state.
- [x] Run focused tests; confirm RED.

### GREEN — minimum implementation

- [x] Add `src/prototype/review/ReviewLauncher.svelte`.
- [x] Add `src/prototype/review/ReviewDrawer.svelte`.
- [x] Add `src/prototype/review/review-link.ts`.
- [x] Expose all required state-matrix variants.
- [x] Add state JSON view.
- [x] Add reset action.
- [x] Add bounded shareable review link.
- [x] Ignore unknown/unsafe query data.
- [x] Add persistent `Reviewer tools` label/chrome distinct from player UI.
- [x] Re-run focused tests; confirm GREEN.

### Refactor and validation

- [x] Remove duplicate state-construction logic; reuse tested prototype fixtures.
- [x] Confirm reviewer query does not contain arbitrary JSON/code.
- [x] Run `npm run check`.
- [x] Manually verify every matrix state in at most two actions.
- [x] Defer commit until `/commit`; gate passes.

---

## Section 11 — Responsive, accessibility, motion hardening

**Suggested commit:** `fix(prototype): harden responsive and accessible UX`

### RED — tests first

- [x] Add `tests/unit/prototype/contrast.test.ts`.
- [x] Test normal text token pairs meet 4.5:1.
- [x] Test large text/non-text state pairs meet required contrast.
- [x] Extend component tests for heading hierarchy, dialog labels, button names, state text, and focus restoration.
- [x] Add `e2e/prototype-accessibility.spec.ts`.
- [x] Test full core flow by keyboard only.
- [x] Test no horizontal document overflow at 1280 × 720.
- [x] Test no horizontal document overflow at 768 × 1024.
- [x] Test no horizontal document overflow at 375 × 667.
- [x] Test no horizontal document overflow at 667 × 375.
- [x] Test 44 × 44 minimum interactive map/control targets at touch viewports.
- [x] Test overlays remain inside viewport and scroll internally.
- [x] Test long dialogue and location names do not clip.
- [x] Test 200% text zoom retains core actions.
- [x] Test reduced-motion media query removes movement-dependent transitions.
- [x] Test screen changes place focus on meaningful heading/action.
- [x] Run focused tests; confirm RED for current gaps.

### GREEN — minimum implementation

- [x] Fix scoped prototype tokens until contrast tests pass.
- [x] Add structural responsive breakpoints for narrative, map, overlays, launcher.
- [x] Add safe-area padding.
- [x] Ensure map location list remains visible on mobile.
- [x] Ensure dialogue/choice controls remain readable above mobile viewport controls.
- [x] Ensure all touch targets meet minimum size.
- [x] Add `prefers-reduced-motion` alternatives.
- [x] Fix heading/focus order and overlay restoration gaps.
- [x] Add textual locked/completed/error state cues independent of color.
- [x] Re-run focused unit/component/E2E tests; confirm GREEN.

### Refactor and validation

- [x] Remove one-off responsive overrides made obsolete by structural layout.
- [x] Run `npm run check`.
- [x] Manually inspect desktop, tablet, mobile portrait, mobile landscape.
- [x] Manually inspect with OS/browser reduced motion enabled.
- [x] Defer commit until `/commit`; gate passes.

---

## Section 12 — Full-flow E2E, docs, review handoff

**Suggested commit:** `test(prototype): complete review-ready flow`

### RED — tests first

- [x] Add `e2e/prototype-flow.spec.ts`.
- [x] Test launcher → New Game → narrative → choice → illustrated map → briefing → win → reward → updated map → save → end.
- [x] Test Load path reaches narrative.
- [x] Test loss path reaches distinct outcome and continues.
- [x] Test abort path offers retry/return without reward.
- [x] Test technical-failure path offers recovery without loss semantics.
- [x] Test hotspot path.
- [x] Test equivalent location-list path.
- [x] Test missing-asset fallback path.
- [x] Test save failure plus Continue Without Saving.
- [x] Test reset returns pristine launcher/title state.
- [x] Test root direct-duel entry remains unchanged.
- [x] Run `npx playwright test e2e/prototype-flow.spec.ts --project=chromium`; confirm RED for unfinished flow/docs markers.

### GREEN — completion work

- [x] Fix only missing end-to-end wiring exposed by RED tests.
- [x] Add `src/prototype/README.md`.
- [x] Document launch command, `/prototype.html` URL, reset method, reviewer tools, known limits.
- [x] Add `docs/card-game-vn-handoff/prototype-review-notes.md` template.
- [x] Include accepted, rejected, unresolved, evidence, next-round sections.
- [x] Add placeholder-asset provenance notes.
- [x] Ensure Auto/Skip/audio limitations are explicit.
- [x] Ensure real duel integration remains listed as optional next round.
- [x] Re-run full-flow E2E; confirm GREEN.

### Final validation

- [x] Run `npm run format`.
- [x] Run `npm run format:check`.
- [x] Run `npm run lint`.
- [x] Run `npm run typecheck`.
- [x] Run `npm test`.
- [x] Run `npm run build`.
- [x] Run `npm run build:reproducible`.
- [x] Run `npm run test:e2e`.
- [x] Run `npm run check`.
- [x] Confirm production package remains private-only.
- [x] Confirm prototype page performs no Worker/WASM/runtime fetch.
- [x] Confirm every scope acceptance criterion has automated or recorded manual evidence.
- [x] Confirm all required review states are reachable within two actions.
- [x] Defer final commit until `/commit`; all gates pass.

---

## 4. Expected file map

This map is guidance, not permission to create unused abstractions.

```text
prototype.html
src/prototype/
├── main.ts
├── PrototypeApp.svelte
├── styles.css
├── README.md
├── assets/
├── content/
│   └── prologue.ts
├── model/
│   ├── prototype-state.ts
│   └── prototype-reducer.ts
├── storage/
│   └── prototype-storage.ts
├── review/
│   ├── ReviewLauncher.svelte
│   ├── ReviewDrawer.svelte
│   └── review-link.ts
├── screens/
│   ├── TitleScreen.svelte
│   ├── LoadScreen.svelte
│   ├── NarrativeScreen.svelte
│   ├── IllustratedMapScreen.svelte
│   ├── PreBattleScreen.svelte
│   ├── BattleHandoffScreen.svelte
│   ├── OutcomeScreen.svelte
│   └── RewardScreen.svelte
├── overlays/
│   ├── HistoryOverlay.svelte
│   ├── SettingsOverlay.svelte
│   ├── PauseOverlay.svelte
│   └── SaveLoadOverlay.svelte
└── components/
    └── VisualDirectionBoards.svelte

tests/unit/prototype/
tests/component/prototype/
e2e/
├── prototype-entry.spec.ts
├── prototype-accessibility.spec.ts
└── prototype-flow.spec.ts
```

- [x] Create file only when owning section first needs it.
- [x] Keep tiny private helpers beside sole consumer.
- [x] Remove files/components rendered unnecessary by simpler implementation.

## 5. Final definition of done

- [x] All 13 sections completed in order.
- [x] Every behavior started from observed RED test.
- [x] Every section ended with focused GREEN plus full `npm run check`.
- [x] Each implementation section has a standalone deferred commit boundary; no commit created by `/ship`.
- [x] Illustrated map is primary chapter navigation.
- [x] Accessible location list remains equivalent selection surface.
- [x] Full prototype flow has no dead ends.
- [x] Win/loss/abort/failure semantics remain distinct.
- [x] Reviewer tooling exposes complete state matrix.
- [x] Desktop/mobile/keyboard/touch/reduced-motion paths pass.
- [x] Existing direct-duel app and runtime remain unchanged.
- [x] Prototype stays private, isolated, disposable.
- [x] Review notes capture product decisions before production architecture work begins.

## 6. Implementation validation record

- Completed: 2026-07-24
- Branch: `main`
- Runtime snapshot: `a562f5ad6794e377157d91adba6a51d73960d5384a00b25fd8bf1236b0f69fb2`
- RED/GREEN working logs: `.agentsystem/evidence/section-*-red.log`, `.agentsystem/evidence/section-*-green.log`
- Focused prototype suite: 64 unit/component tests passed.
- Full repo suites: 21 legacy, 257 unit, 91 component, 18 integration tests passed.
- Browser suite: 80 tests passed across Chromium plus direct-duel Firefox/WebKit smoke.
- Reviewer matrix: all 43 allowlisted presets browser-tested.
- Build: private multi-page package verified; reproducibility verified (122 files).
- Runtime isolation: verifier plus browser test confirm prototype initial closure creates no Worker and requests no runtime/WASM assets.
- Canonical gate: `npm run check` passed. Evidence: `.agentsystem/evidence/final-canonical-check.log`.
- Git status: commits intentionally deferred. `/ship` stops before git; use `/commit` to apply documented section boundaries.
