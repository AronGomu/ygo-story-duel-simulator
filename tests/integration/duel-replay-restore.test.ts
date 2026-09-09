import { ASSET_SOURCES } from "../../scripts/lib/asset-roots.ts";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import type { DuelWorkerEvent } from "../../src/battle/duel/contracts/duel-worker-event.ts";
import { duelId, snapshotId } from "../../src/battle/duel/contracts/ids.ts";
import type { PlayerPrompt } from "../../src/battle/duel/contracts/player-prompt.ts";
import type { PublicDuelState } from "../../src/battle/duel/contracts/public-duel-state.ts";
import { uniqueDeckCodes } from "../../src/battle/duel/presets/deck-parser.ts";
import { loadDeckSources } from "../../src/battle/duel/presets/deck-sources-node.ts";
import {
  createDuelPreset,
  type DuelPreset,
} from "../../src/battle/duel/presets/duel-preset.ts";
import type { ActiveDuelDependencies } from "../../src/battle/worker/assets/active-duel-dependencies.ts";
import { loadActiveDuelDependenciesNode } from "../../src/battle/worker/assets/active-duel-dependencies-node.ts";
import type { DuelDiagnosticTrace } from "../../src/battle/duel/contracts/duel-diagnostics.ts";
import { DuelWorkerRuntime } from "../../src/battle/worker/DuelWorkerRuntime.ts";
import type { OcgCoreAdapter } from "../../src/battle/worker/engine/OcgCoreAdapter.ts";
import { loadVendoredCoreNode } from "../../src/battle/worker/engine/load-vendored-core-node.ts";
import {
  BasicOpponentPolicy,
  toOpponentVisibleState,
} from "../../src/battle/worker/opponent/OpponentPolicy.ts";

const DUEL_ID = duelId(
  "bundled-v1:chapter-one-starter:vs:chapter-one-practice",
);
const PLAYER = { kind: "preset", deckId: "chapter-one-starter" } as const;
const OPPONENT = { kind: "preset", deckId: "chapter-one-practice" } as const;

let adapter: OcgCoreAdapter;
let dependencies: ActiveDuelDependencies;
let preset: DuelPreset;

beforeAll(async () => {
  adapter = await loadVendoredCoreNode();
  const deckSources = await loadDeckSources();
  preset = createDuelPreset(
    "chapter-one-starter",
    "chapter-one-practice",
    deckSources,
  );
  dependencies = await loadActiveDuelDependenciesNode(
    path.resolve(ASSET_SOURCES.data.source),
    uniqueDeckCodes(preset.player, preset.opponent),
  );
});

/** The vendored core never fails on demand, so the only way to reach the
    Worker's fatal-error path from a test is to make one call into the engine
    throw. Everything else delegates to the real core, so the duel either side
    of the injected failure is a real duel. */
interface InjectableCore {
  readonly adapter: OcgCoreAdapter;
  failNextProcess: boolean;
  refuseNextDuel: boolean;
}

function injectableCore(): InjectableCore {
  const injectable = {
    failNextProcess: false,
    refuseNextDuel: false,
  } as InjectableCore;
  const proxy = new Proxy(adapter, {
    get(target, property, receiver) {
      if (property === "process" && injectable.failNextProcess) {
        injectable.failNextProcess = false;
        return () => {
          throw new Error("injected core failure");
        };
      }
      if (property === "createDuel" && injectable.refuseNextDuel) {
        injectable.refuseNextDuel = false;
        return () => null;
      }
      const value: unknown = Reflect.get(target, property, receiver);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
  return Object.defineProperty(injectable, "adapter", {
    value: proxy,
    enumerable: true,
  });
}

function createRuntime(core: InjectableCore): DuelWorkerRuntime {
  return new DuelWorkerRuntime(async () => ({
    adapter: core.adapter,
    dependencies,
    createPreset: () => preset,
    snapshotId: snapshotId("a".repeat(64)),
  }));
}

interface ForwardDuel {
  readonly promptIds: readonly string[];
  readonly lastPrompt: PlayerPrompt;
  readonly lastState: PublicDuelState;
  readonly failure: Extract<DuelWorkerEvent, { readonly type: "error" }>;
}

/** Plays the player's seat with the same policy the opponent uses, so the
    duel reaches a genuine mid-duel position without a scripted transcript,
    then breaks the core on the last response. */
async function playUntilFailure(
  runtime: DuelWorkerRuntime,
  core: InjectableCore,
  humanResponses: number,
): Promise<ForwardDuel> {
  const policy = new BasicOpponentPolicy(dependencies);
  const promptIds: string[] = [];
  let prompt: PlayerPrompt | null = null;
  let state: PublicDuelState | null = null;
  let breaking = false;
  let events = await runtime.handle({
    type: "startDuel",
    duelId: DUEL_ID,
    player: PLAYER,
    opponent: OPPONENT,
  });
  for (;;) {
    for (const event of events) {
      if (event.type === "state") state = event.state;
      if (event.type === "prompt") prompt = event.prompt;
      if (event.type === "error") {
        if (!breaking)
          throw new Error(`Duel failed early: ${event.error.message}`);
        if (prompt === null || state === null)
          throw new Error("Duel failed before reaching a prompt");
        return {
          promptIds: Object.freeze([...promptIds]),
          lastPrompt: prompt,
          lastState: state,
          failure: event,
        };
      }
    }
    if (prompt === null || state === null)
      throw new Error("Duel stopped without a prompt");
    promptIds.push(prompt.id);
    if (promptIds.length > humanResponses) {
      core.failNextProcess = true;
      breaking = true;
    }
    const decision = policy.choose(prompt, toOpponentVisibleState(state));
    events = await runtime.handle({
      type: "respond",
      promptId: prompt.id,
      choiceIds: decision.choiceIds,
    });
  }
}

function responseEntries(
  trace: DuelDiagnosticTrace,
): readonly Readonly<Record<string, unknown>>[] {
  return trace.entries.flatMap((entry) =>
    entry.kind === "response"
      ? [
          {
            promptId: entry.promptId,
            choiceIds: entry.choiceIds,
            player: entry.player,
            opponentReason: entry.opponentReason,
          },
        ]
      : [],
  );
}

async function diagnostics(
  runtime: DuelWorkerRuntime,
): Promise<DuelDiagnosticTrace> {
  const events = await runtime.handle({ type: "requestDiagnostics" });
  const diagnosticsEvent = events.find((event) => event.type === "diagnostics");
  if (diagnosticsEvent?.type !== "diagnostics")
    throw new Error("Runtime returned no diagnostics");
  return diagnosticsEvent.trace;
}

describe("replay-based duel recovery", () => {
  it("restores to the prompt the last human response answered", async () => {
    const core = injectableCore();
    const runtime = createRuntime(core);
    try {
      await runtime.handle({ type: "initialize" });
      const forward = await playUntilFailure(runtime, core, 3);
      expect(forward.failure.canRestore).toBe(true);
      const before = await diagnostics(runtime);

      const restored = await runtime.handle({ type: "restore" });
      expect(restored.map((event) => event.type)).toEqual([
        "restored",
        "state",
        "prompt",
      ]);
      const prompt = restored.find((event) => event.type === "prompt");
      const state = restored.find((event) => event.type === "state");
      if (prompt?.type !== "prompt" || state?.type !== "state")
        throw new Error("Restore published no live prompt");
      expect(prompt.prompt.id).toBe(forward.lastPrompt.id);
      expect(prompt.prompt).toEqual(forward.lastPrompt);
      /* The rebuilt position is the one the player left, not merely a duel
         that stopped at a prompt with the same name. */
      expect(state.state).toEqual(forward.lastState);

      /* Every answer the replay fed back is the recorded one, opponent
         included: the policy never re-decided a turn the log already held. */
      const after = await diagnostics(runtime);
      expect(responseEntries(after)).toEqual(
        responseEntries(before).slice(0, -1),
      );
      expect(after.seed).toEqual(before.seed);
    } finally {
      runtime.dispose();
    }
  });

  it("reports canRestore false and refuses to restore with no human response", async () => {
    const core = injectableCore();
    const runtime = createRuntime(core);
    try {
      await runtime.handle({ type: "initialize" });
      core.failNextProcess = true;
      const started = await runtime.handle({
        type: "startDuel",
        duelId: DUEL_ID,
        player: PLAYER,
        opponent: OPPONENT,
      });
      const failure = started.find((event) => event.type === "error");
      if (failure?.type !== "error")
        throw new Error("Injected failure did not reach the caller");
      /* No offer at all, rather than an offer the Worker would refuse. */
      expect(failure.canRestore).toBeUndefined();

      expect(await runtime.handle({ type: "restore" })).toEqual([
        { type: "restore_failed", reason: "no_restore_point" },
      ]);
    } finally {
      runtime.dispose();
    }
  });

  it("keeps the original failure downloadable when the replay itself fails", async () => {
    const core = injectableCore();
    const runtime = createRuntime(core);
    try {
      await runtime.handle({ type: "initialize" });
      const forward = await playUntilFailure(runtime, core, 2);
      const before = await diagnostics(runtime);

      core.refuseNextDuel = true;
      const failed = await runtime.handle({ type: "restore" });
      expect(failed).toEqual([
        {
          type: "restore_failed",
          reason: "replay_failed",
          detail: "ocgcore refused to create a duel handle",
        },
      ]);
      /* The error the player is looking at, and the report they can still
         download, are the ones the failed duel produced. */
      expect(await diagnostics(runtime)).toEqual(before);

      const restored = await runtime.handle({ type: "restore" });
      const prompt = restored.find((event) => event.type === "prompt");
      if (prompt?.type !== "prompt")
        throw new Error("A healthy retry did not restore the duel");
      expect(prompt.prompt.id).toBe(forward.lastPrompt.id);
    } finally {
      runtime.dispose();
    }
  });

  it("plays on from the restored prompt", async () => {
    const core = injectableCore();
    const runtime = createRuntime(core);
    try {
      await runtime.handle({ type: "initialize" });
      const forward = await playUntilFailure(runtime, core, 2);
      const restored = await runtime.handle({ type: "restore" });
      const prompt = restored.find((event) => event.type === "prompt");
      if (prompt?.type !== "prompt")
        throw new Error("Restore published no live prompt");

      /* A restored duel is an ordinary duel: the same seat answers the same
         prompt through the same command, and the opponent decides again. */
      const policy = new BasicOpponentPolicy(dependencies);
      const decision = policy.choose(
        prompt.prompt,
        toOpponentVisibleState(forward.lastState),
      );
      const continued = await runtime.handle({
        type: "respond",
        promptId: prompt.prompt.id,
        choiceIds: decision.choiceIds,
      });
      expect(continued.some((event) => event.type === "error")).toBe(false);
      expect(continued.some((event) => event.type === "state")).toBe(true);
    } finally {
      runtime.dispose();
    }
  });
});
