# ADR-074: End Turn intent resumes across prompts

> Status: accepted; implemented
> Decided: 2026-09-04
> Implemented: 2026-09-04 — `reduceEndTurnAutomation()` dedupes keyed exits, pauses on decisions, and resets on lifecycle boundaries
> Owners: prompt architecture, browser presentation architecture
> Relates: ADR-009 (conservative automatic prompt resolution), ADR-010 (engine-owned phase choices), ADR-073 (End Turn field placement)

## Context

OcgCore exposes phase exits as prompt choices. One click can answer only current prompt; later phase exits arrive under new prompt ids after core accepts prior response. Current End Turn control therefore advances one offered exit, not whole turn.

A player asking to end turn intends to cross remaining legal phase boundaries. Core may interrupt that path with real decisions. Automatically answering those decisions would violate engine authority and ADR-009's line between formalities and choices.

Owner review on 2026-09-04 requires one End Turn press to continue until opponent turn while pausing for mandatory decisions.

## Decision

1. End Turn press arms in-memory intent for current Duel session generation.
2. Armed intent submits only current engine-offered choice whose action is `endPhase`.
3. Each `InteractionKey` is submitted at most once. Pending response emits nothing.
4. A prompt without `endPhase` receives no automatic answer. Intent remains armed while player resolves that prompt.
5. After player response produces next prompt, armed intent resumes and submits next offered `endPhase` choice.
6. Intent clears on opponent turn, duel result/disposal/restart, or Duel session-generation change.
7. Automation lives on browser presentation side and dispatches ordinary keyed interaction action through existing store. Worker/core contract stays unchanged.

## Consequences

- One click may produce several ordinary core responses over time.
- End Turn can remain armed while player reads and answers intervening prompt; UI must make pending intent visible enough to avoid surprise.
- A prompt sequence that never reaches opponent turn keeps intent armed until lifecycle reset. This is preferable to fabricating transition or silently declaring success.
- Pure reducer/state-machine tests become required because reactive UI evaluation could otherwise submit same prompt twice.

## Alternatives rejected

- **Submit only one phase exit per press.** Rejected: preserves current repeated-click burden and fails requested behavior.
- **Auto-answer every intervening prompt.** Rejected: chooses cards/options/chains for player and violates core-authoritative interaction model.
- **Mutate phase directly in UI or Worker wrapper.** Rejected: bypasses OcgCore legality and has no valid response contract.
- **Clear intent on first non-transition prompt.** Rejected: turns pause into cancellation and forces second End Turn press after required decision.
- **Move policy into Worker.** Rejected: this is user-interface intent, not rules authority; existing keyed UI dispatch already provides stale/pending guards.
