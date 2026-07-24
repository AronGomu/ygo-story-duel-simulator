# Visual Novel Experience Prototype Scope

> Status: draft for review  
> Purpose: decide what game should feel like before production implementation  
> Related target: [`01-product-scope.md`](01-product-scope.md) and [`04-narrative-and-map-design.md`](04-narrative-and-map-design.md)  
> TDD plan: [`10-experience-prototype-implementation-plan.md`](10-experience-prototype-implementation-plan.md)

## 1. Prototype goal

Build a disposable, interactive visual-novel prototype around the existing duel product. It should make intended player experience concrete enough to review, compare, reject, or refine before campaign architecture is implemented.

Prototype must answer:

1. Does moving among narrative, map, and battle feel like one game?
2. Is dialogue presentation readable, expressive, and fast enough?
3. Does player choice feel meaningful without implying unsupported branching depth?
4. Does illustrated map hub make location, access, objective, and progression state clear?
5. Which navigation and quality-of-life controls feel essential?
6. How much progression feedback should appear between story beats?
7. Does experience work on desktop, mobile, keyboard, touch, and reduced motion?
8. Which visual direction should guide production UI?

This prototype validates experience, information architecture, visual direction, pacing, and interaction. It does not validate production campaign, content-pack, save-migration, PWA, or duel-engine architecture.

## 2. Proposed prototype shape

| Dimension     | Scope                                                                                  |
| ------------- | -------------------------------------------------------------------------------------- |
| Fidelity      | Mid-fidelity interactive flow with polished key screens                                |
| Breadth       | One short prologue covering complete narrative → map → battle → outcome loop           |
| Runtime       | Isolated prototype entry; existing direct-duel app remains unchanged                   |
| Data          | Local mocked content and state                                                         |
| Persistence   | Lightweight local prototype state only; no production save schema                      |
| Battle        | Battle handoff mock with explicit outcome selector; existing duel UI is not redesigned |
| Platforms     | Desktop web plus 375px mobile treatment                                                |
| Review intent | Fast iteration; prototype code may be discarded                                        |

### Isolation proposal

Use a separate prototype entry rather than modifying current direct-duel flow. Proposed URL: `/prototype.html`.

Prototype may reuse existing colors, typography, button rules, and card imagery where useful. It must not import Worker internals, alter duel contracts, create production campaign abstractions, or become an accidental first implementation of future architecture.

## 3. Representative player flow

```text
Prototype launcher
→ Title screen
→ New Game or Load mock save
→ Prologue narrative
→ Meaningful choice
→ Choice consequence acknowledgment
→ Illustrated map hub
→ Inspect locked location
→ Select available story location
→ Pre-battle briefing
→ Battle handoff mock
→ Select simulated player win or player loss
→ Matching outcome scene
→ Reward / progression feedback
→ Updated map state
→ Save confirmation
→ Prototype end / replay / jump to review state
```

Both win and loss branches must be reviewable without replaying full flow.

## 4. Screens and surfaces

### 4.1 Prototype launcher

Purpose: explain prototype status and make review efficient.

Cover:

- short notice that content, names, art, and state are provisional;
- Start Full Flow;
- Jump to Screen/State;
- Reset Prototype;
- viewport hint for desktop/mobile review;
- direct access to visual-direction comparisons.

### 4.2 Title screen

Cover:

- game title treatment;
- New Game as primary action;
- Continue when mock progress exists;
- Load;
- Settings;
- clear private/prototype marker;
- version/build label kept visually secondary;
- keyboard focus entering on primary action.

Questions to validate:

- cinematic title screen vs compact game menu;
- amount of Yu-Gi-Oh!-specific visual language;
- whether chapter context belongs on Continue.

### 4.3 New Game entry

Cover:

- immediate start vs prologue summary/confirmation;
- optional player-name placeholder only if naming is being considered;
- clear transition into first story beat;
- return to title before progress is created.

Default: start immediately. Character creation, difficulty, deck selection, and campaign selection remain absent.

### 4.4 Load screen

Cover:

- one occupied manual slot;
- one autosave;
- one empty slot;
- chapter/location, playtime, timestamp, and small preview image;
- Load, Delete, and Back actions;
- overwrite/delete confirmation treatment;
- no-save empty state;
- incompatible/corrupt save example reachable from review launcher.

This validates save UX only. Data may use `localStorage`; no production persistence contract.

### 4.5 Narrative screen

Required layers:

```text
NarrativeScreen
├── Background
├── Character sprites
├── optional foreground/effect layer
├── speaker name
├── dialogue or narration box
├── advance affordance
├── choice area when paused
└── utility controls
```

Cover:

- narration with no speaker;
- named speaker dialogue;
- protagonist/internal thought treatment;
- one character, then two-character composition;
- speaker change;
- two expressions for one character;
- character enter, expression change, and exit;
- background change;
- long line, short line, and multi-line text;
- click/tap/keyboard advance;
- visible end-of-line advance cue;
- deterministic missing-background and missing-sprite fallback;
- dialogue UI hidden/revealed without losing place.

Utility controls to prototype:

- History;
- Auto;
- Skip;
- Hide UI;
- Save;
- Load;
- Settings;
- Return to Title.

Only History, Hide UI, Save, Load, Settings, and Return need complete shallow interactions. Auto and Skip may be visibly marked experimental; prototype should test whether players expect them before production scope is expanded.

### 4.6 Choice state

Cover:

- one choice with 2–3 concise options;
- keyboard and touch selection;
- obvious selected/focus state;
- no accidental selection from dialogue advance input;
- one immediate reaction line per option;
- one later acknowledgment or map-state difference proving choice was retained;
- revisiting choice through review launcher.

Choice should test tone or relationship—not imply a large story branch. Branches reconverge before map.

### 4.7 Dialogue history

Cover:

- current-scene entries only;
- speaker + text;
- clear newest/oldest order;
- keyboard-close and focus return;
- empty history state;
- no replay/voice controls unless audio becomes approved scope.

Goal: decide whether history is essential for first production slice.

### 4.8 Settings overlay/screen

Cover only settings relevant to experience review:

- text speed;
- auto-advance speed;
- transitions on/off or reduced;
- music volume placeholder;
- sound volume placeholder;
- fullscreen when browser supports it;
- reset to defaults;
- Back with unsaved-change behavior made explicit.

Audio controls may be disabled with “Audio not included in this prototype.” No audio implementation required.

### 4.9 Illustrated map hub

Required structure:

```text
MapScreen
├── illustrated map background
├── objective
├── hotspot layer
├── marker/status layer
├── always-present location list
└── navigation/help
```

Cover exactly two main locations plus one hidden-state example available through review launcher:

1. available required story/battle location;
2. visible locked location with reason;
3. hidden location state for review only;
4. completed state after outcome;
5. available-completed state to prove completion and access are independent.

Interactions:

- hotspot hover/focus/select;
- list hover/focus/select;
- hotspot and list synchronize selection;
- locked location explains requirement;
- objective remains visible;
- location details appear before navigation;
- Back exists only where story context allows it;
- mobile uses same map plus usable list, not map-only interaction.

Approved direction:

- illustrated map is primary chapter-navigation surface;
- chapter menu is not a competing primary-navigation option;
- always-present accessible location list remains equivalent selection surface.

Questions to validate:

- marker style and density;
- whether location preview needs character, reward, battle, or difficulty info;
- whether locked locations should remain visible.

### 4.10 Pre-battle briefing

Cover:

- opponent identity;
- short narrative stakes;
- player and opponent deck labels without deck editing;
- objective/format summary;
- Start Duel;
- Return to Map when allowed;
- mock pre-battle save confirmation;
- transition language connecting VN presentation to existing duel UI.

No deck editor, deck selection, card ownership, or rules configuration.

### 4.11 Battle handoff mock

Purpose: validate transition and return contract without duplicating or embedding duel runtime.

Cover:

- transition into battle;
- framed placeholder referencing existing duel experience;
- Simulate Player Win;
- Simulate Player Loss;
- Simulate Abort;
- Simulate Technical Failure;
- transition back to narrative;
- technical failure recovery kept separate from authored loss.

Mock controls belong only to prototype/reviewer mode. They must not resemble player-facing production actions.

Optional later experiment: launch current real duel from prototype after story direction is approved. Not required for prototype acceptance.

### 4.12 Outcome scenes

Cover separate authored beats for:

- player win;
- player loss;
- aborted battle recovery;
- technical failure recovery.

Requirements:

- win and loss produce different dialogue;
- neither branch dead-ends;
- abort offers retry or return without progression;
- technical failure offers retry/return and never presents as story defeat;
- branch label remains visible in reviewer tooling, not player UI.

### 4.13 Reward and progression feedback

Cover one reward or persistent flag:

- compact reveal after resolved battle;
- plain-language explanation of what changed;
- Continue action;
- map marker/state update;
- chapter objective update;
- reward does not imply card-ownership restrictions.

Questions to validate:

- modal reveal vs inline narrative acknowledgment;
- amount of celebration;
- whether objective and reward should appear together.

### 4.14 Save feedback

Cover:

- autosave indicator at stable story boundary;
- manual Save action;
- successful confirmation that does not interrupt flow;
- overwrite confirmation;
- simulated storage failure with Retry and Continue Without Saving;
- pre-battle checkpoint explanation in player language, not architecture terms.

### 4.15 Pause/return flow

Cover:

- pause/utility menu reachable from narrative and map;
- resume;
- save/load;
- settings;
- return to title confirmation when progress since last save exists;
- predictable focus return to invoking control.

## 5. Sample content inventory

Prototype needs enough authored content to judge pacing, not final canon.

### Story content

- 5–8 minute prologue;
- 25–40 dialogue/narration beats;
- 2 speaking characters plus protagonist voice;
- 1 meaningful 2–3 option choice;
- 1 immediate choice reaction;
- 1 later choice acknowledgment;
- 1 map objective;
- 2 map locations;
- 1 pre-battle briefing;
- 1 win scene;
- 1 loss scene;
- 1 abort recovery message;
- 1 technical-failure recovery message;
- 1 reward/progression beat.

### Visual assets

Use replaceable project-local placeholders with source notes.

- 1 title/key-art composition;
- 3–4 backgrounds: arrival, interior, map, arena/duel transition;
- 1 illustrated map;
- 2 character sprites;
- 2–3 expressions for primary speaking character;
- marker icons for story, battle, locked, and completed;
- 1 reward icon;
- deterministic missing-asset placeholders;
- optional card-back motif or existing approved local card assets.

No asset should imply redistribution approval. Prototype remains private.

### Audio

No audio required. Prototype should reserve visual space for music/sound controls without sourcing unapproved media. One later audio experiment may be added only after visual/pacing review shows it is needed.

## 6. Visual-direction exploration

Before one direction is treated as preferred, prototype should compare three small direction boards using same title, dialogue beat, and map state.

### Direction A — Existing client continuity

- dark navy base;
- teal interaction accent;
- restrained product UI around art-led story layers;
- strongest continuity with current duel client.

### Direction B — Duel-anime broadcast

- stronger framing, status motifs, and scene transitions;
- more visible chapter/objective energy;
- risk: noisy, generic anime-game UI.

### Direction C — Cinematic visual novel

- image-dominant composition;
- quieter chrome;
- dialogue typography and character staging carry mood;
- risk: transition into dense duel UI may feel abrupt.

Review should select one direction or a specific hybrid. Palette swaps alone do not count as distinct directions.

### Physical scene

Player sits at a desktop or holds a phone in a dim room, exploring story at an unhurried pace before shifting into a focused, information-dense duel. Dark-first treatment is proposed because it supports both ambient context and continuity with current client.

## 7. Interaction requirements

### Input

- Mouse, keyboard, and touch complete core flow.
- `Enter`/`Space`: advance dialogue when focus is not on another actionable control.
- Choice options use normal buttons and arrow/tab navigation.
- `Escape`: close top overlay, then restore invoking control.
- No global shortcut triggers while typing or while confirmation dialog is open.
- Double activation cannot advance twice or dispatch duplicate transitions.

### Feedback

- Every action gets immediate visual response.
- Current speaker and active selection remain obvious.
- Transitions explain mode changes; they never hide loading indefinitely.
- Save, load, choice, map selection, and battle result show explicit completion.
- Reviewer-only state controls remain visually separate from player UI.

### Motion

- 150–300 ms for UI state transitions;
- restrained fades/slides for character and background changes;
- one stronger transition entering battle;
- no bounce/elastic motion;
- `prefers-reduced-motion` replaces movement with crossfade or instant change;
- content visible without waiting for entrance animation.

## 8. Responsive requirements

Review at minimum:

- 1280 × 720 desktop;
- 768 × 1024 tablet portrait;
- 375 × 667 mobile portrait;
- 667 × 375 mobile landscape.

Required behavior:

- dialogue never covers speaker identity or choice controls;
- text remains readable without horizontal scrolling;
- map stays contained;
- location list remains available;
- touch targets are at least 44 × 44 CSS pixels;
- overlays fit viewport and scroll internally when necessary;
- safe-area insets do not hide controls;
- long location names and dialogue wrap without clipping;
- mobile does not become compressed desktop chrome.

## 9. Accessibility requirements

Target WCAG 2.2 AA behavior for prototype surfaces.

Cover:

- semantic headings, buttons, lists, and dialogs;
- visible focus;
- logical focus order;
- focus placement after screen transitions;
- focus restoration after overlays;
- labels independent of icon/color;
- dialogue, choices, objective, map state, save status, and errors available to screen readers;
- no automatic live-region reading of every animated text fragment;
- full dialogue line exposed once, with user-controlled advance;
- map hotspots paired with always-present location list;
- locked/completed states conveyed through text and semantics, not color alone;
- 4.5:1 normal-text contrast;
- reduced-motion support;
- text scaling to 200% without loss of core actions;
- deterministic alt/fallback treatment for missing art.

## 10. State coverage matrix

| Surface        | States prototype must expose                                                            |
| -------------- | --------------------------------------------------------------------------------------- |
| Launcher       | fresh, progress exists                                                                  |
| Title          | new player, continue available                                                          |
| Load           | occupied, autosave, empty, incompatible/corrupt example                                 |
| Narrative      | narration, speaker dialogue, thought, one sprite, two sprites, long text, missing asset |
| Choice         | default, focus/selected, resolved                                                       |
| History        | entries, empty                                                                          |
| Settings       | unchanged, changed, reset, audio unavailable                                            |
| Map            | available, locked, hidden, completed, available-completed                               |
| Pre-battle     | ready, return allowed, save warning                                                     |
| Battle handoff | ready, win, loss, abort, technical failure                                              |
| Outcome        | win branch, loss branch, recovery branch                                                |
| Reward         | new reward/flag, acknowledged                                                           |
| Save           | idle, saving, success, overwrite, failure                                               |
| Responsive     | desktop, tablet, mobile portrait, mobile landscape                                      |
| Motion         | default, reduced motion                                                                 |

Review launcher must make every state reachable in at most two actions.

## 11. Reviewer tooling

Prototype should include a clearly labeled review drawer or launcher, excluded from any future production path.

Functions:

- jump to screen;
- set choice result;
- set map access/completion state;
- simulate battle result;
- toggle missing assets;
- toggle save/storage failure;
- toggle reduced-motion preview;
- reset all state;
- show current prototype state as readable JSON;
- copy current review-state link when practical.

Goal: reviewers compare states without replaying 5–8 minute flow.

## 12. Explicit non-goals

Prototype will not include:

- production campaign reducer/interpreter;
- validated content packs or migration logic;
- real save envelopes, autosave rotation, or IndexedDB schema;
- service worker, installation, offline guarantees, or update coordination;
- real duel Worker integration;
- duel UI redesign;
- deck editor, deck selection, YDK import/export, or card ownership;
- multiple chapters;
- shops, quests, relationships, tournaments, or free movement;
- chapter menu as primary navigation;
- localization system;
- voice acting, final music, cinematics, or final artwork;
- public deployment;
- final story canon;
- architecture changes under `src/duel`, `src/worker`, `src/field`, or `src/storage`.

## 13. Prototype deliverables

1. Isolated interactive web prototype.
2. Full representative flow.
3. Review launcher covering state matrix.
4. Three visual-direction boards.
5. Desktop and mobile layouts.
6. Replaceable mock content/assets with provenance notes.
7. Short README containing launch command, prototype URL, reset method, and known limitations.
8. Review notes file recording accepted, rejected, and unresolved decisions.

## 14. Acceptance criteria

Prototype is ready for review when:

- full representative flow completes without dead ends;
- New Game and Load both reach narrative;
- choice creates immediate and later visible acknowledgment;
- map hotspot and list select same location;
- locked, hidden, completed, and available-completed states are inspectable;
- win and loss return to distinct outcome scenes;
- abort and technical failure never masquerade as loss;
- reward/progression updates visible map or objective state;
- save success and failure treatments are inspectable;
- all state-matrix entries are reachable through reviewer tooling;
- core flow works by keyboard, mouse, and touch;
- desktop and required mobile viewports remain usable;
- reduced-motion mode remains understandable;
- current direct-duel entry and runtime remain unchanged;
- no prototype mock is represented as production architecture.

## 15. Review checklist

Reviewer should record answers, not only visual preferences.

### Product

- [ ] Core narrative → map → duel loop feels coherent.
- [ ] Prologue pacing is too short / right / too long.
- [ ] Choice consequence feels sufficient for first slice.
- [ ] Illustrated map makes location access, objective, and progression state clear.
- [ ] Reward/progression feedback is understandable.
- [ ] Win and loss both encourage continuation.

### Visual direction

- [ ] Preferred direction: A / B / C / hybrid.
- [ ] Story UI and duel UI feel related enough.
- [ ] Dialogue box density is comfortable.
- [ ] Character/background framing supports story focus.
- [ ] Map markers and state language are clear.
- [ ] Motion energy is too low / right / too high.

### Controls

- [ ] History needed in first production slice.
- [ ] Auto needed in first production slice.
- [ ] Skip needed in first production slice.
- [ ] Hide UI needed in first production slice.
- [ ] Save access belongs in narrative controls / pause menu / both.
- [ ] Settings scope is sufficient.

### Scope decisions

- [ ] Real duel integration needed in next prototype round.
- [ ] Audio experiment needed before implementation.
- [ ] Mobile layout acceptable for first production slice.
- [ ] Prototype direction ready to convert into implementation plan.

## 16. Decisions and assumptions

Approved decision:

- illustrated map is primary chapter-navigation surface; accessible location list provides equivalent selection, not a competing chapter menu.

Remaining proposed defaults:

- interactive mid-fidelity prototype;
- one 5–8 minute prologue;
- isolated `/prototype.html` entry;
- mocked state and persistence;
- mocked battle boundary with win/loss/abort/failure selector;
- three visual directions, dark-first;
- desktop plus mobile coverage;
- English-only;
- no audio;
- existing direct-duel runtime untouched.

Review may approve, replace, or remove any assumption before prototype implementation starts.
