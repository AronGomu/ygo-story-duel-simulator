# Asset roots, profiles, migration

## Ownership

`assets/{battle,deck-editor,story,shared}` own asset bytes. `scripts/lib/asset-roots.ts:ASSET_SOURCES` is the sole build-tool source/browser/legacy mapping. Acquisition, validators, Node Worker inputs, Vite, migration, promotion consume it. Application code boundaries remain unchanged; the Node-only Worker factory imports the pure path map, not delivery I/O.

| Profile | Initial ownership |
| --- | --- |
| `core` | Core CSS-imported font files under `src/assets/fonts/`; excluded from asset-delivery inventory |
| `runtime` | Runtime manifest, data manifest, catalog/image-metadata/script/string trees, card back |
| `chapter-01` | Extant matching card/crop IDs from tracked chapter-one authoring, existing shop-set art, Chapter 1 map SVG; depends on `runtime` |
| `dev-only` | Everything else, including originals, acquired non-authoritative engine, set-image manifest, data checksum sidecar |

`asset-profiles/nightly.json` is a `PlayerSelection`, not a profile. Only core/runtime/chapter-01 initially selected. Additional profiles require explicit authoring/selection. Shared media has one owner; later chapters depend on that owner instead of claiming bytes twice. Declared dependencies are selected transitively; all declarations are checked for cycles/source/logical collisions, including unselected profiles.

The chapter rules come from `content/chapter-selections.json`, `content/authoring/card-set-source.json`, `public/story/shop-sets.v1.json`: 1,629 selected gameplay card IDs, 14 matching shop-set IDs, existing `city-map-placeholder.svg`. Initial profile selects only extant matching media (1,677 exact rules). Unavailable optional art does not become a mandatory file reference; gameplay metadata stays unchanged. Newly supplied optional art remains dev-only until explicit promotion. These rules do not certify source completeness, gameplay support, distribution rights, or PWA readiness. No `content:catalog` producer or hosted delivery command is introduced in this slice.

## Scan and promotion

```bash
npm run assets:profiles:sync -- --check
npm run assets:profiles:sync
npm run assets:promote -- --profile chapter-01 --files-from release-assets.txt
npm run assets:promote -- --profile chapter-01 --from assets/story/chapter-01 --all
npm run assets:promote -- --profile chapter-01 --from assets/story/chapter-01 --all --apply
```

- S1. Scan every regular file regardless Git ignore rules. No media decoding or source-code usage inference. Links, special files, credential names, unsafe/case/Unicode-colliding paths fail closed. Disappearance after root/file observation fails `ASSET_SOURCE_CHANGED`, not optional absence.
- S2. Check writes nothing. Missing explicit files fail `ASSET_REFERENCE_MISSING`; missing tree roots report `tree-missing-dev-only-empty`. Unclassified files are reported, not rejected. Initial optional-media omissions are not explicit references; deleting an actually declared file still fails check.
- S3. Sync without `--check` writes canonical `generated/asset-delivery/inventory.json`, reporting missing references separately. Pure `scanAssets` omits unavailable bytes; it never obtains upstream inputs.
- S4. File lists are UTF-8 repository-relative paths, one per line; blank lines ignored, no comments/globs. Exact rules remain exact. Tree rules include future files on subsequent scans. Default logical paths use longest canonical source prefix, never strip `assets/`. Unmapped trees need `--logical-prefix`; unmapped file-list entries fail `ASSET_CONFIG_INVALID`.
- S5. Promotion requires an existing target profile so dependency ownership stays explicit. Preview lists proposed source/logical/profile rules. Apply acquires the common lock, rescans source bytes/declarations, validates ownership, atomically replaces only that profile. Assets never move during promotion. Identical promotion preserves profile bytes.

All new CLIs accept `--help`, emit structured stderr progress plus one final stdout `AssetResult`, exit 0 success / 2 expected failure / 1 unexpected fault. Expected error messages equal stable `ASSET_*` codes; safe paths remain separate.

## Copy-only migration

Before switching a legacy worktree's consumers to canonical roots:

```bash
npm run assets:migrate -- --plan
npm run assets:migrate -- --apply generated/asset-delivery/migration-plan.json
```

- M1. Preview hashes exact M1–M9 mappings from `ASSET_SOURCES`, checks destination conflicts including empty-directory case/Unicode aliases, writes canonical plan. Derived sibling-temp paths must fit the 512-byte path/255-byte component limits before any copy. It does not copy or change source code.
- M2. Apply locks `generated/.locks/asset-delivery`, rescans membership, rehashes every source/destination before the first copy. Differing destinations fail `ASSET_LOCAL_CONFLICT`, changed plans/sources fail `ASSET_SOURCE_CHANGED`. Identical destinations are adopted, including after interrupted runs.
- M3. Before creating a temp, synced `generated/asset-delivery/migration-pending.json` records plan SHA, file index, exact sibling path. Exclusive `open(..., "wx")` creates short `.m-<uuid>` temp independently of destination basename; its inode identity is persisted before source copying. The exclusive handle stays open through copying: a bounded 1 MiB buffer, explicit short-write loop, and zero-progress rejection preserve partial bytes without reopening or truncating the path. Only that owned inode receives copied bytes. Verified temp installs through exclusive `link(temp, destination)`; original source inodes are never hardlinked. Node has no portable no-replace rename; unsupported hardlinks fail `ASSET_LOCAL_CONFLICT`, never an overwriting rename fallback. Local Linux filesystem verified; Windows/macOS filesystem acceptance remains required.
- M4. Final verified destination digests are recorded at `generated/asset-delivery/migration-receipt.json`. No original is deleted by migration. Same-plan retry verifies temp ownership plus complete planned hash before removing it, then rescans every source/destination. Full-copy/link crashes produce clean-run inventory membership after recovery. Partial/mismatched/unowned temps fail `ASSET_RECOVERY_REQUIRED` without deletion. When a disk/write error leaves an unsafe partial, recovery-required takes precedence over the underlying disk error code; the marker and partial remain for owner inspection. Failed cleanup remains observable; pending ownership keeps normal inventory, profile operations, and common-lock acquisition writers blocked.
- M5. Interrupted processes deliberately leave the common lock. Confirm the process has exited before removing that exact lock, then retry the exact original plan. Never remove the pending marker merely to bypass recovery. If retry reports `ASSET_RECOVERY_REQUIRED`, preserve the marker, plan, and affected files for owner inspection; no automatic partial-temp repair or hash invention is provided. Exact current/legacy UUID temp-shaped names without verified ownership also fail closed; they are never omitted or deleted by filename pattern. An ordinary original named `author.migration-tmp` remains inventory input. Temp/metadata files and affected parent directories are synced; process-crash tests are not a power-loss durability attestation.
- M6. Tracked fonts/story assets relocate only through separately authorized, hash-verified source changes. Vendor and `public/story/shop-sets.v1.json` never move. Once cut over, stale legacy sources are ignored; owner cleanup is separate. An earlier plan containing subsequently relocated tracked sources is stale: produce a new preview for any remaining legacy migration.

## Browser and acquisition boundaries

Vite bundles core fonts through CSS imports, serves the Chapter 1 map through its story chunk, declared runtime snapshot files, existing constrained runtime image/set URLs, frozen vendor engine URLs. Four roots are not mounted as recursive public directories; direct source paths and legacy paths are rejected, including Vite `@fs` spellings. Core font CSS URLs retain non-root deployment bases. Vite may report unresolved `/fonts/` URLs during its earlier CSS pass; the source plugin rewrites these before final CSS emission, verified by Chromium font loading and exact URL/hash checks.

Explicit legacy acquisition commands remain available, targeting canonical roots under the common delivery lock. They are never invoked by scan, migration, promotion, or private build. Download reports/status/cache remain operational `generated/` inputs for legacy acquisition diagnostics, not managed delivery assets. Strict upstream coverage/decoded-media checks remain separate; a hosted dev bundle is not proof that those legacy acquisition reports exist or that every selected asset is available.

## Producer seam

- T1. `scripts/lib/asset-delivery/scan-assets.ts:scanAssets(root, selection, retainedMetadata, playerMetadata): Promise<FrozenInventory>` — read-only, no lock acquisition. Producer holds the common lock across scan/freeze. Missing explicit bytes are omitted; structural conflicts fail.
- T2. `scanAssetProfiles(...)` returns `{ inventory, diagnostics }` for omission reporting; optional profile declarations are used by promotion to validate proposed ownership. `loadSelection(root)` reads tracked nightly selection. `EMPTY_RETAINED_METADATA` supplies explicit empty development history.
- T3. Null prepared metadata produces null runtime snapshot ID and empty vendor list, allowing dev-only scans without playable runtime. Prepared metadata enables exact frozen WASM/manifest inventory, checked against the tracked vendor manifest. The producer must pass prepared metadata for player targets and preserve diagnostics separately.
- T4. `ASSET_SOURCES` supplies canonical source/browser mappings. `acquireAssetDeliveryLock(root)` remains the sole public local writer lock, rejecting pending migration ownership. Only migration apply supplies its optional recovery-plan SHA to reconcile an exact matching intent under that same lock. Producers keep the one-argument call. No bundle/archive/publish/download/prune implementation is supplied here.
