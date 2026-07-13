# ocgcore-wasm 0.1.2 provenance

- npm package: `ocgcore-wasm@0.1.2`
- package URL: <https://registry.npmjs.org/ocgcore-wasm/-/ocgcore-wasm-0.1.2.tgz>
- npm integrity: `sha512-Zgjx2xIf2RJf1gjvHGR8lvcLRfw54Cq48QFMOrOxtt3SeAf+/h58IbVNoYpZbK7O5O23GCwLeNqS4T6zODHpWA==`
- npm tarball SHA-1: `5ef0f1ce4a277f688f0e8511ce277f384aa8c794`
- upstream package revision: `9f36452f2a2464f057f7fd6e2273aa5ab589401e`
- embedded Project Ignis core revision: `8e5f4e4f0ab6b8ca750e8e1c91c1a58f407e3272`
- exposed core version: `11.0`
- license: MIT; `LICENSE` copied from the upstream package revision because the npm tarball declares MIT but omits the license file

The payload was extracted from the integrity-verified npm tarball already acquired by `scripts/sync-engine.ts`. The asynchronous JSPI binaries under `lib/` were intentionally omitted; this application permits only `lib/ocgcore.sync.mjs` and `lib/ocgcore.sync.wasm`.

Two reviewed adapter corrections are applied to `dist/index.js` and its source map:

1. Backport upstream commit [`1dabded`](https://github.com/n1xx1/ocgcore-wasm/commit/1dabded283959f44a2c34494b5575434911b2c02), which parses `MSG_SELECT_SUM` mandatory/optional cards in core wire order and includes each card's complete location/position record; align the bundled declaration with that record.
2. Remove the spurious count byte from `SORT_CARD` responses. The embedded core reads one order byte per card directly; prefixing `order.length` makes every non-empty sort response invalid and produces `MSG_RETRY`.

The package version and embedded WASM remain unchanged. `vendor-manifest.json` records both patches and every vendored payload file except itself. Updating any payload requires replacing this directory from a newly integrity-verified package, re-evaluating these patches and running the complete headless integration suite.
