# Worker Contract

> Status: accepted

## Commands

```ts
type DuelCommand =
  | { type: "initialize" }
  | { type: "startDuel"; duelId: string }
  | { type: "respond"; promptId: string; choiceIds: readonly string[] }
  | { type: "surrender" }
  | { type: "requestDiagnostics" }
  | { type: "dispose" };
```

## Events

```ts
type DuelWorkerEvent =
  | { type: "ready"; coreVersion: readonly [number, number]; snapshotId?: string; activeImageManifestSha256?: string }
  | { type: "loading"; stage: string; progress?: number }
  | { type: "state"; state: PublicDuelState }
  | { type: "event"; event: DuelPresentationEvent }
  | { type: "prompt"; prompt: PlayerPrompt }
  | { type: "result"; result: DuelResult }
  | { type: "diagnostics"; trace: DuelDiagnosticTrace }
  | { type: "error"; error: DuelError }
  | { type: "disposed"; clean: boolean };
```

## Contract rules

- Put each public discriminated union/interface in its own focused contract file unless two tiny private types are inseparable.
- Contract values must survive structured cloning; no functions, raw `bigint`, engine objects, or handles.
- Prompt and choice IDs are opaque and namespaced per duel session. Raw response indexes stay in a Worker-private lookup.
- Only the current prompt can be answered; reject stale, duplicate, unknown, and previous-session IDs.
- Untrusted Worker commands are runtime-validated and size-bounded before dispatch.
- Public commands cannot provide seeds, deck order, startup scripts, or programmed mode; those seams are internal to headless tests/authorized diagnostics.
- Commands execute in arrival order through a bounded queue; initialization is single-flight.
- `dispose` invalidates queued work, aborts cooperative initialization, suppresses late events, and is idempotent.
- Commands and events are exhaustive unions with `assertNever` consumers.
- Every incoming event is detached with `structuredClone`, exact-key and dense-array validated, recursively bounded, and checked for public-state/prompt privacy before it reaches the store.
- Diagnostics requests are single-flight, timeout-bounded, and accepted only for inactive sessions.
- Every shape has serialization and boundary tests; real Node and browser Worker integration proves production state, prompt, result, diagnostics, and error events cross an actual structured-clone boundary.
- Worker bootstrap and detailed filesystem/WASM failures stay in structured Worker logs; public initialization errors use stable sanitized messages.
