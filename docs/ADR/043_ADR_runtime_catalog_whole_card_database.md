# ADR-043: Whole Card Database as a Fetched Runtime Catalog

> Status: accepted; planned
> Decided: 2026-08-20
> Owners: decks data architecture
> Relates: ADR-011 (deck registry and derived card pool), ADR-039 (editor card art via static runtime URLs), ADR-025 (validated card-list duel start)
> Amended by [ADR-075](075_ADR_static_pwa_chapter_zip_delivery.md) (§§1,3 transport) and [ADR-078](078_ADR_installed_visible_media_leases.md) (§4 art): planned PWA mode installs full runtime manually, resolves art cache-only; full-catalog scope remains.
> Feedback: [`../../feedback-decks.md`](../../feedback-decks.md) — Deck Builder 13, 14

## Context

The editor's catalog is `activeCatalog()`, read from the Vite `define` globals `__ACTIVE_CARD_DATA__` / `__ACTIVE_CARD_TEXTS__`. `vite.config.ts` cuts those from the art-backed codes of the six bundled decks — roughly 120 cards. Feedback round 2 says: wire the entire card database, and make loading and searching fast.

Two constraints frame the answer. The packaged snapshot holds **14,794** cards: 2.7 MB of masks, 7.1 MB of text, 33 MB of card scripts, 451 declared files, ~45 MB total. Inlining masks and text into the deck-editor chunk is impossible — its budget is 201,250 bytes. And the build packages only the bundled-deck closure of runtime assets, so a deck built from arbitrary cards would be offered by the editor and then withheld by the duel picker (`supportedDuelCardCodes`), which is precisely the drift `src/battle/decks/selectable-decks.ts` exists to prevent.

Measured on this checkout: parsing all 128 catalog shards costs ~36 ms in Node; the shards gzip to ~1.6 MB together.

## Decision

1. **The catalog is fetched, not compiled.** `src/decks/catalog/runtime-catalog.ts` reads the 64 card shards and 64 text shards from `runtime/assets/current/catalog/…` — the same files, over the same middleware and the same `dist` layout the Worker already reads — joins them through the existing `packagedCatalog`, and memoizes the promise for the page.
2. **One catalog, two domains.** The editor and the duel await the same memoized promise. A build cannot offer a card in the editor that the picker withholds, because both derive their code set from one read. The editor narrows what it *offers* by one pure filter, `deckBuildableCards`: the database's 243 Tokens are cards a duel creates on the field and no deck may hold, so the editor offers **14,551** of the 14,794. The duel still reads all 14,794, because a Token on the field has to be nameable.
3. **The build ships the whole verified snapshot.** `copySnapshotAssets` copies every file the runtime manifest declares instead of the bundled-deck closure, and `verify-browser-build.ts` verifies the packaged tree against the full declared list. `dist` grows to ~66 MB (45 MB snapshot, 19 MB card art, the rest JavaScript). That is the price of "any deck you can build, you can play"; the app is an offline private build, not a bandwidth-billed site.
4. **Card art stays URL-by-convention.** Every code maps to `{BASE_URL}runtime/images/{code}.jpg` (ADR-039's discipline, widened from the manifest-listed subset). Dev serves ~14.5k local images; the production build still packages only manifest-backed art, and a tile whose image 404s falls back to the placeholder glyph.
5. **`missing-art` is deleted from validation.** Once the catalog is the whole database, art availability describes the build's image coverage, not a defect in the player's deck; keeping it would attach a warning to nearly every deck and teach players to ignore the validation panel.
6. **Search runs off an index.** `buildDeckCatalogIndex` pre-lowercases names once per card list; `filterDeckCatalogIndex` filters against it. Budgets for load, index build, filter and option derivation are asserted in `tests/unit/decks/deck-catalog-performance.test.ts` with the measurement recorded beside each.

## Consequences

- `supportedDuelCardCodes()` becomes async, and `src/battle/app/App.svelte` derives its card texts and validation catalog from the awaited catalog.
- Once no caller of `activeCatalog()` remains, the `__ACTIVE_CARD_DATA__` / `__ACTIVE_CARD_TEXTS__` defines and their build-time manifests can go; `__ACTIVE_IMAGE_MANIFEST__` stays, because the duel's verified image cache still reads it.
- First open of the editor now costs a fetch of ~1.6 MB gzipped. Bounded rendering (60 tiles per window) keeps the paint cheap regardless of catalog size.

## Alternatives rejected

- A build-time compact index file (`code`, `name`, masks) plus lazy per-shard descriptions: fastest first paint, but a third generated artifact to keep in sync with two that already exist, for a saving the measurement does not justify (~36 ms parse).
- Keeping the editor on the packaged define and letting the duel refuse unsupported decks: the editor would promise decks the picker silently drops — the exact failure ADR-011 and `selectable-decks.ts` were written against.
- Shipping the catalog but not the scripts: the Worker loads a card's script at duel start; a deck of unscripted cards would fail after the player chose it, not before.
- Streaming the catalog from IndexedDB after a one-time import: a second copy of data the build already ships, plus a migration, to save a fetch the browser caches anyway.
</content>
