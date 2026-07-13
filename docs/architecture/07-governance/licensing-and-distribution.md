# Licensing and Distribution

> Status: accepted constraints; legal review remains required before public deployment

- `ocgcore-wasm` wrapper code is MIT, while embedded Project Ignis `ygopro-core` is AGPL-3.0-or-later.
- Project Ignis CardScripts are AGPL-covered; public distribution must satisfy applicable source-availability obligations.
- Verify BabelCDB redistribution terms separately.
- Yu-Gi-Oh! names, text, artwork, and characters involve separate Konami/Shueisha intellectual-property concerns.
- Project Ignis Distribution does not supply card images; image-provider technical access does not grant redistribution rights.
- Keep image source/provider and hosting policy configurable and recorded in snapshot provenance.
- Keep deployment private if source availability, database terms, or image/content permission remains unresolved. The current Vite package requires explicit `private` build mode, writes `PRIVATE_DEPLOYMENT_ONLY.txt`, and refuses an ordinary production build while the active-image manifest says redistribution is unapproved.
- Archive the exact source revision manifest with each release artifact.
