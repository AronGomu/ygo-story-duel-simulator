# Diagnostics and Reproducibility

> Status: accepted

A failed duel must leave enough evidence to reproduce it.

## Run metadata

Record application/build/browser version, preset duel ID, seed, snapshot ID, engine/catalog/script/string/image revisions, and a bounded main-thread image-cache hit/miss/failure summary.

## Ordered trace

Record bounded process statuses, parsed message types, projected events, prompt choices, encoded responses, opponent decision reasons, last successful message, and pending prompt. Development traces may retain raw bytes for unsupported/malformed messages.

## Results

Use structured variants such as `completed`, `surrendered`, `unsupported`, and `engine_error`, with winner/reason where available. Error and result surfaces provide JSON trace download.

## Safety

- Keep traces serializable, schema-versioned, exact-key validated, and aggregate-size bounded.
- Production traces contain the production seed and are explicitly labeled `contains-production-seed`; the UI warns before download and only permits requests after a session becomes inactive.
- Routine Worker failure logs never include the production seed.
- Redact hidden identities from public trace fields; raw private replay material is restricted to an authorized local workflow.
- Preserve behavior when logging fails and never replace the original error.
