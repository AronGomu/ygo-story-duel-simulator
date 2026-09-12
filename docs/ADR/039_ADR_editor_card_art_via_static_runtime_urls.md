# ADR-039: Editor Card Art via Static Runtime URLs

> Status: accepted; planned
> Decided: 2026-08-16
> Owners: decks data architecture
> Relates: ADR-036 (shared preview panel)
> Amended by [ADR-078](078_ADR_installed_visible_media_leases.md): §§1–3 use cache-only installed media leases in planned PWA mode; explicit private profile remains separate.
> Amended by [ADR-043](043_ADR_runtime_catalog_whole_card_database.md): art is a URL by convention for **every** code, not only manifest-listed ones, and the `missing-art` warning is deleted; the parenthesis in §1 is superseded.

## Context

The duel resolves card art through `CardImageCache`: hash-verified downloads, Cache Storage, object-URL leases, decode validation. The deck editor showed letter-glyph placeholders because `packagedCatalogRecords` never received image URLs. Feedback 9 wants real art in catalog, deck and preview "same as the duel simulator". The verified pipeline is battle-internal, sized for a duel session's lifecycle, and overkill for an editor grid that renders hundreds of `<img>` tags the browser can cache natively.

## Decision

1. `activeCatalog()` derives, per code present in `__ACTIVE_IMAGE_MANIFEST__.files`, a plain URL `{BASE_URL}runtime/images/{code}.jpg` and threads it through `packagedCatalog` into `DeckBuilderCardView.imageUrl`. Codes in `missing` stay `null` (the `missing-art` validation warning keeps working).
2. The editor (tiles + shared preview via `staticImageUrl`) renders those URLs directly; browser HTTP caching is the cache.
3. The duel's verified lease pipeline is untouched and remains the only path used inside a duel. Same bytes, same manifest, two access disciplines: adversarial-verified where the engine's snapshot activation demands it, plain where a broken image is just a broken `<img>`.

## Alternatives rejected

- Reuse `CardImageCache` in the editor: requires the manifest digest handshake and preloading ~all images up front; the editor needs lazy per-tile loading, and the class is battle-internal by boundary.
- Ship art URLs inside the card-data manifest at build time: couples two generated manifests; deriving at read time keeps the image manifest the single source for which codes have art.
