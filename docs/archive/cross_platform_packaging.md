---
date: 2026-06-09
title: YGO Story Duel Simulator - Cross Platform Packaging
tags:
  - technical-plan
  - electron
  - ygopro-core
  - packaging
---

# YGO Story Duel Simulator - Cross Platform Packaging

## Status

Historical desktop/Electron packaging research. The accepted static-browser MVP is described in [`../architecture/architecture.md`](../architecture/architecture.md).

## Summary

Using `ygopro-core` from a cross-platform wrapper is feasible, but it is **not** a pure JavaScript/web dependency. It is native C/C++ code and must be built/package-tested per target platform.

## Difficulty Split

| Scope | Difficulty | Notes |
|---|---:|---|
| Electron web UI wrapper | Low | React/Svelte/Vue UI, save files, story state, deck ownership. |
| Read/write `.ydk` files | Low | Text format. Easy in JS. |
| Read `.cdb` card database | Low/Medium | SQLite. Use a native SQLite package or WASM SQLite. |
| Launch native duel-runner skill | Medium | Need per-platform binary and skill/file contract. |
| Direct Node binding to `ygopro-core` | Medium/High | Requires N-API/native addon builds for Windows/macOS/Linux. |
| Full custom duel UI from `ygopro-core` messages | High | Core is not a UI. It emits prompts/messages; wrapper must implement all interactions. |
| Full EDOPro client fork | High | More dependencies, bigger build matrix, licensing complexity. |

## Recommended Integration For Prototype

Use Electron for the wrapper, but keep `ygopro-core` behind a separate native CLI skill:

```text
Electron wrapper
  -> writes duel_instance.json
  -> starts duel-runner native binary
  -> duel-runner links ygopro-core
  -> duel-runner reads CardScripts + BabelCDB
  -> duel-runner writes result.json / replay
  -> Electron reads result.json and updates story
```

Avoid direct Node bindings at first. A skill boundary is easier to debug, easier to replace, and avoids Electron ABI rebuild problems.

## Platform Packaging Reality

For each supported desktop platform, ship a matching native binary:

```text
resources/bin/win32-x64/duel-runner.exe
resources/bin/linux-x64/duel-runner
resources/bin/darwin-arm64/duel-runner
resources/bin/darwin-x64/duel-runner
```

Also package or locate:

- Lua/runtime dependency if not statically linked;
- `CardScripts` Lua files;
- `.cdb` database files from BabelCDB;
- banlists/config;
- optional card images/assets, subject to IP/licensing constraints.

## Important Warning

`ygopro-core` is a duel engine, not a complete game client.

It does not automatically provide:

- deck editor UI;
- card search UI;
- human duel interface;
- animations;
- AI opponent;
- story-mode launcher;
- win/loss JSON output.

Those must be built in the wrapper/duel-runner, borrowed from EDOPro, or added through a fork.

## Practical Recommendation

Start with:

1. Electron + Svelte/React for the story wrapper.
2. JS deck editor reading `.cdb` and writing `.ydk`.
3. Native `duel-runner` compiled per platform.
4. File contract: `duel_instance.json` in, `result.json` out.
5. CI build matrix for Windows, Linux, macOS.

Do not promise browser-only deployment until `ygopro-core` + Lua + scripts are proven in WebAssembly.
