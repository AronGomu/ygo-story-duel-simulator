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

## Deterministic local bundles (T3 candidate)

No publish/install/remote commands. These checks do not certify gameplay or distribution rights.

- [ ] B1. Run `npm run assets:bundle -- --target dev`. Verify final JSON snapshot SHA; `npm run content:verify` must pass. Inspect pinned DevManifest: every safe managed-root original appears, including unclassified bytes.
- [ ] B2. Run same command with a different `TZ`; verify identical snapshot/archive SHA. In a disposable fixture, change only file modes/insertion order; verify byte identity.
- [ ] B3. Run `npm run content:catalog`. Unmapped selected set names must fail explicitly; never invent IDs or drop duplicate-membership sets to pass. With complete fixture input, inspect exact source digest records and chapter IDs.
- [ ] B4. With explicit prepared fixture, run `npm run content:pack -- --empty-history`; inspect core exclusion, chapter policy set IDs, runtime dependency, bounded part refs. `content:verify` must validate all objects. Missing history input must fail; retained release objects must remain byte-identical.
- [ ] B5. Only on an approved disk, run `node tests/fixtures/asset-delivery-large.ts --directory /approved-disk/new-fixture --bytes 4294967297`. Record stdout with peak RSS/archive hashes/disk requirement. 10 GiB variant uses `--bytes 10737418240`, requires at least 50.5 GiB free. Actual >4 GiB proof remains pending until this runs; small ZIP64 fixtures are not equivalent.

## Atomic R2 publication and remote prune (T4)

These commands can upload or delete public remote bytes. Run them only after completing owner prerequisites O1–O11 in `docs/assets/asset-delivery-setup.md`, confirming current R2 pricing/budget, checking exact bucket/prefix, and backing up `channels/index.json`. Never delete a stale lock until confirming no publisher/pruner is active.

- [ ] C1. Run `npm run assets:publish -- --target all --origin https://app.example` with approved rights evidence and an actual configured app origin. Interrupt before final state PUT in a disposable namespace; verify prior `channels/index.json` remains byte-identical and candidate objects are unadvertised. Remove approval; verify denial occurs before `_control/write-lock.json` or any other remote PUT.
- [ ] C2. Publish release `npm run assets:publish -- --target all --origin https://app.example --version 0.1.0`; retry identical inputs after publishing a later fixture version. Verify original pointer remains byte-identical. Change source bytes; verify `ASSET_RELEASE_EXISTS` and no overwrite.
- [ ] C3. Start two publishers, then publisher versus remote-prune preview. Verify one owns `_control/write-lock.json`; others return `ASSET_BUSY`. After forced process termination, inspect exact lock owner before removing only `_control/write-lock.json` in R2 console.
- [ ] C4. Run `npm run assets:prune -- --remote`; inspect exact old-retired candidates, basis SHA, 24-hour cutoff, and release exclusions. Apply only reviewed plan with `npm run assets:prune -- --apply generated/asset-delivery/prune-remote.json`; changed state/object must fail `ASSET_PRUNE_STALE` before deletion.
- [ ] C5. Interrupt prune after durable intent. After exact stale-lock recovery, run `npm run assets:prune -- --resume --remote`; verify journal-guided completion, final retired state, immutable release availability, anonymous HTTPS GET hash/length, exact-origin browser CORS.
