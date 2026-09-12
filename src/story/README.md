# Visual novel domain

The narrative/map/campaign UI domain of the single app. Content is still the
authored prologue that started life as a disposable prototype; the code is now
a production domain of the shell, not a separate entry document.

## Run

```bash
npm run dev
```

Open the app and select **Visual novel** from the home hub, or go straight to
`#/story`. Production-like review uses `npm run build` then `npm run preview`
and the same `#/story` route.

## Boundaries

- Public contract is `index.ts`: the domain root component, `StoryState`,
  `EncounterId`, and the save store (`createStorySaveRepository` plus its
  types and the database name). Nothing outside `src/story/` deep-imports past
  it.
- The domain imports no production duel domain (`app`, `duel`, `field`,
  `storage`, `worker`); `tests/unit/story/story-boundaries.test.ts` enforces it.
- `styles.css` is scoped to `.story-app` so it cannot repaint the duel or deck
  editor that the shell mounts in the same document.
- Progress lives in the `ygo-story-saves` IndexedDB, one record per slot:
  `manual:1`–`manual:3`, `autosave`, and `checkpoint:pre-duel` for the duel
  handoff. Each record is a versioned envelope; a record this build cannot
  parse reads as "no save" instead of failing the mount. The developer console
  at `#/admin` resets the database. Prototype progress written under the old
  key is not migrated.

## Known limits

- Battle is an explicit mock boundary; no Worker, WASM, or real duel
  integration yet.
- The save screens still render fixed placeholder slot summaries; only the
  backing store is real.
- Auto and Skip are labeled experiments, not functional automation.
- Audio is absent; disabled controls reserve evaluation space only.
- Story, names, visuals, title, rewards, and state are provisional
  English-only samples.

## Placeholder asset provenance

`assets/story/chapter-01/city-map-placeholder.svg` and CSS-rendered character/background/reward
art were authored in-repo. No third-party media, fonts, music, card art, or
redistribution rights are implied. Replace or delete all placeholder assets
before public use.
