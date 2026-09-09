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


## Asset roots and profiles (T2 local candidate)

No hosted upload, upstream refresh, or owner-original cleanup belongs to these checks. Use a disposable checkout for mutations.

- [ ] A1. Run `npm run assets:migrate -- --plan`; inspect exact source/destination/size/SHA entries. Verify no source changes. Apply only in the disposable checkout; verify receipt hashes, all originals preserved. Run again with identical inputs; verify same-byte adoption.
- [ ] A2. Place different destination bytes before apply. Verify `ASSET_LOCAL_CONFLICT`, original/destination unchanged, no other planned destination copied.
- [ ] A3. Add unused `.psd` under a managed root; run `npm run assets:profiles:sync`. Verify inventory includes bytes as dev-only regardless Git ignore state. Remove only the disposable test input afterward.
- [ ] A4. Preview exact-file and tree promotions to an authored target profile. Apply, repeat; verify stable profile bytes, no asset moves, no silent reassignment. Add a tree child; verify next scan includes it.
- [ ] A5. Run `npm run assets:profiles:sync -- --check`. Deleting an explicitly declared file must produce `ASSET_REFERENCE_MISSING`. Initial profile selects extant optional media only; absent optional art must not be fabricated or made mandatory from gameplay metadata.
- [ ] A6. Build at `/ygo-story-duel/`; verify fonts, full/cropped cards, card back, runtime manifests, frozen Worker/WASM retain their browser URLs. Verify original source/provenance paths cannot be fetched through direct or Vite `@fs` source paths. Automated Chromium URL/hash/font + real-Worker smoke covers this path.
- [ ] A7. Repeat migration fault/retry fixtures on Windows/macOS filesystems. Unsupported hardlinks must fail `ASSET_LOCAL_CONFLICT`, never fall back to overwriting rename. After real process interruption, confirm process exit before removing only the exact stale lock; retry the original plan. Verify full-copy/link recovery matches clean-run inventory with no UUID temp bytes. Partial/mismatched/unowned temps must remain untouched behind `ASSET_RECOVERY_REQUIRED`; normal inventory/profile/common-lock writers stay blocked. Preserve pending marker and affected files for owner inspection, never bypass the gate by deleting metadata.
- [ ] A8. In disposable fixtures, verify empty-directory case/Unicode aliases fail before any migration copy; long valid basenames succeed with independent short temps; derived paths exceeding 512 bytes fail preview before copying. Remove only fixture-owned inputs afterward.
