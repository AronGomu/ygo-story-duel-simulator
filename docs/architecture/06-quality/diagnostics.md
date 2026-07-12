# Diagnostics and Reproducibility

> Status: accepted

A failed duel must leave enough evidence to reproduce it.

## Run metadata

Record application/build/browser version, preset duel ID, seed, snapshot ID, and engine/catalog/script/string/image revisions.

## Ordered trace

Record bounded process statuses, parsed message types, projected events, prompt choices, encoded responses, opponent decision reasons, last successful message, and pending prompt. Development traces may retain raw bytes for unsupported/malformed messages.

## Results

Use structured variants such as `completed`, `surrendered`, `unsupported`, and `engine_error`, with winner/reason where available. Error and result surfaces provide JSON trace download.

## Safety

- Keep traces serializable and schema-versioned.
- Bound memory usage.
- Redact hidden identities unless explicitly required by an authorized local debug replay; mark sensitive traces clearly.
- Preserve behavior when logging fails and never replace the original error.
