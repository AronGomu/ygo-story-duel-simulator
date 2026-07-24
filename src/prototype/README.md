# Visual novel experience prototype

Private, isolated, disposable UX prototype. Not production campaign architecture.

## Run

```bash
npm run dev
```

Open `http://localhost:5173/prototype.html`. Production-like review uses `npm run build` then `npm run preview` and the same `/prototype.html` path.

## Review

- **Start full flow**: launcher → title → narrative/choice → illustrated map → briefing → mock battle → outcome → reward → updated map → save → end.
- **Jump to screen or state**: opens launcher jumps. Persistent **Reviewer tools** drawer sets screen, choice, map, battle result, missing assets, storage failure, and reduced motion.
- **Share state**: use **Copy review link**. Query values are allowlisted; arbitrary JSON is ignored.
- **Reset**: use **Reset prototype** in launcher/reviewer drawer. This removes only `ygo-vn-prototype:review-state:v1` from `localStorage`.

## Known limits

- Battle is explicit reviewer mock; no Worker, WASM, or real duel integration.
- Save data is one disposable namespaced `localStorage` record, not production save schema.
- Auto and Skip are labeled experiments, not functional automation.
- Audio is absent; disabled controls reserve evaluation space only.
- Story, names, visuals, title, rewards, and state are provisional English-only samples.
- Real duel integration remains optional next-round work after experience direction approval.

## Placeholder asset provenance

`assets/city-map-placeholder.svg` and CSS-rendered character/background/reward art were authored in-repo for this private prototype. No third-party media, fonts, music, card art, or redistribution rights are implied. Replace or delete all prototype assets before public use.
