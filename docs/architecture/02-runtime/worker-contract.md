# Worker Contract

> Status: accepted

## Commands

```ts
type DuelCommand =
  | { type: "initialize" }
  | { type: "startDuel"; duelId: string }
  | { type: "respond"; promptId: string; choiceId: string }
  | { type: "surrender" }
  | { type: "dispose" };
```

## Events

```ts
type DuelWorkerEvent =
  | { type: "ready"; coreVersion: readonly [number, number] }
  | { type: "loading"; stage: string; progress?: number }
  | { type: "state"; state: PublicDuelState }
  | { type: "event"; event: DuelPresentationEvent }
  | { type: "prompt"; prompt: PlayerPrompt }
  | { type: "result"; result: DuelResult }
  | { type: "error"; error: DuelError };
```

## Contract rules

- Put each public discriminated union/interface in its own focused contract file unless two tiny private types are inseparable.
- Contract values must survive structured cloning; no functions, raw `bigint`, engine objects, or handles.
- Prompt and choice IDs are opaque. Raw response indexes stay in a Worker-private lookup.
- Only the current prompt can be answered; reject stale, duplicate, and unknown IDs.
- Commands and events are exhaustive unions with `assertNever` consumers.
- Every shape has serialization and boundary tests.
