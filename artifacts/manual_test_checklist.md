# Manual test checklist

## Chapter 1 bundled deck prerequisites

These checks cover bundled defaults and new grants only. Existing saved-deck Chapter 1 display/start/restore policy and installed/offline acceptance remain downstream work. No browser checks in this section have been run.

- [ ] M1. In a fresh private browser profile, open free play. Verify only Chapter 1 Starter and Chapter 1 Practice bundled tiles appear. Practice Bot defaults to Chapter 1 Practice.
- [ ] M2. Select each of Practice Bot, Blaze Circuit, and Vault Warden. Verify the named persona remains distinct; each assigns Chapter 1 Practice. The shared practice tile must show Bundled without a Locked persona label. Override the opponent deck with Chapter 1 Starter; verify the persona remains selected. Select Blaze Circuit again; verify the opponent returns to Chapter 1 Practice.
- [ ] M3. Start a duel with the default pair. Verify 40 Main cards per seat, no Extra/Side cards, normal AI turns, no missing-card/script/protocol error.
- [ ] M4. Start a new story game in a disposable profile. Verify Chapter 1 Starter is granted with exactly its 40 owned copies, 1000 DP, no Extra/Side cards. Open a fresh free-play library; verify the same starter is created once and set as default.
- [ ] M5. Using exported copies of test saves only, open a legacy v1/v2 save twice. Verify the historical Starter Deck payload and maximum-count inventory top-up remain identical between reads; wallet and checkpoint remain unchanged. Verify reads do not rewrite the stored record.
- [ ] M6. Open copies of existing v3/v4 saves and nonempty free-play libraries, including a custom-only library with no default. Verify decks, revisions, inventory, currency, default choice, and checkpoint remain unchanged. Existing decks are not retroactively replaced with Chapter 1 cards.
- [ ] M7. Open the admin test-deck action in a disposable profile. Verify its explicitly requested new deck uses Chapter 1 Starter cards. Do not reset an existing personal library.

## Assumptions

A1. Repository checkout contained no prior manual checklist; this file records only this prerequisite slice.
A2. Private local assets and automated headless engine evidence do not grant publication rights or establish installed/offline readiness.
