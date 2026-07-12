# ocgcore-wasm 0.1.2 provenance

- npm package: `ocgcore-wasm@0.1.2`
- package URL: <https://registry.npmjs.org/ocgcore-wasm/-/ocgcore-wasm-0.1.2.tgz>
- npm integrity: `sha512-Zgjx2xIf2RJf1gjvHGR8lvcLRfw54Cq48QFMOrOxtt3SeAf+/h58IbVNoYpZbK7O5O23GCwLeNqS4T6zODHpWA==`
- npm tarball SHA-1: `5ef0f1ce4a277f688f0e8511ce277f384aa8c794`
- upstream package revision: `9f36452f2a2464f057f7fd6e2273aa5ab589401e`
- embedded Project Ignis core revision: `8e5f4e4f0ab6b8ca750e8e1c91c1a58f407e3272`
- exposed core version: `11.0`
- license: MIT; `LICENSE` copied from the upstream package revision because the npm tarball declares MIT but omits the license file

The payload was extracted from the integrity-verified npm tarball already acquired by `scripts/sync-engine.ts`. The asynchronous JSPI binaries under `lib/` were intentionally omitted; this application permits only `lib/ocgcore.sync.mjs` and `lib/ocgcore.sync.wasm`. The distributed `dist/` directory is retained unchanged because its public adapter and declarations are the supported API.

No local patches have been applied. `vendor-manifest.json` records every vendored payload file except itself. Updating any payload requires replacing this directory from a newly integrity-verified package and running the complete headless integration suite.
