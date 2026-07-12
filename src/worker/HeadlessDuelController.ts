import type { ChoiceId, PromptId, SnapshotId } from "../duel/contracts/ids.ts";
import type { DuelPresentationEvent } from "../duel/contracts/duel-presentation-event.ts";
import type { DuelResult } from "../duel/contracts/duel-result.ts";
import type { PlayerPrompt } from "../duel/contracts/player-prompt.ts";
import type { PublicDuelState } from "../duel/contracts/public-duel-state.ts";
import type { ActiveDuelDependencies } from "./assets/active-duel-dependencies.ts";
import { BoundedDuelTrace, type DuelTrace } from "./diagnostics/duel-trace.ts";
import type { DuelSession } from "./engine/DuelSession.ts";
import {
  BasicOpponentPolicy,
  type OpponentPolicy,
} from "./opponent/OpponentPolicy.ts";
import { DuelStateProjector } from "./projection/DuelStateProjector.ts";
import { PromptRegistry } from "./protocol/PromptRegistry.ts";

export interface DuelAdvance {
  readonly state: PublicDuelState;
  readonly events: readonly DuelPresentationEvent[];
  readonly prompt?: PlayerPrompt;
  readonly result?: DuelResult;
}

export interface HeadlessDuelControllerOptions {
  readonly session: DuelSession;
  readonly dependencies: ActiveDuelDependencies;
  readonly snapshotId: SnapshotId;
  readonly presetId: string;
  readonly deckCounts: readonly [number, number];
  readonly extraDeckCounts: readonly [number, number];
  readonly opponentPolicy?: OpponentPolicy;
  readonly maximumAutomaticResponses?: number;
}

export class HeadlessDuelController {
  readonly #session: DuelSession;
  readonly #projector: DuelStateProjector;
  readonly #prompts: PromptRegistry;
  readonly #opponent: OpponentPolicy;
  readonly #trace: BoundedDuelTrace;
  readonly #maximumAutomaticResponses: number;
  #result: DuelResult | null = null;

  constructor(options: HeadlessDuelControllerOptions) {
    this.#session = options.session;
    this.#projector = new DuelStateProjector(
      options.snapshotId,
      options.deckCounts,
      options.extraDeckCounts,
    );
    this.#prompts = new PromptRegistry(options.dependencies);
    this.#opponent =
      options.opponentPolicy ?? new BasicOpponentPolicy(options.dependencies);
    this.#trace = new BoundedDuelTrace(
      options.presetId,
      options.snapshotId,
      options.session.seed,
    );
    this.#maximumAutomaticResponses =
      options.maximumAutomaticResponses ?? 1_000;
  }

  advance(): DuelAdvance {
    this.#assertActive();
    const events: DuelPresentationEvent[] = [];

    for (
      let automaticResponses = 0;
      automaticResponses <= this.#maximumAutomaticResponses;
      automaticResponses += 1
    ) {
      const boundary = this.#session.processUntilBoundary();
      this.#trace.record({
        kind: "process",
        status: boundary.status === "waiting" ? 1 : 0,
        detail: `${boundary.iterations} iteration(s)`,
      });
      let answeredOpponent = false;

      for (const message of boundary.messages) {
        this.#trace.record({ kind: "message", messageType: message.type });
        const update = this.#projector.apply(message);
        events.push(...update.events);
        if (update.result !== undefined) {
          this.#result = update.result;
          this.#trace.record({
            kind: "result",
            detail: JSON.stringify(update.result),
          });
        }

        const prompt = this.#prompts.publish(message);
        if (prompt === null) continue;
        this.#trace.record({
          kind: "prompt",
          promptId: prompt.id,
          player: prompt.player,
        });
        if (prompt.player === 0) {
          return { state: this.#projector.snapshot(), events, prompt };
        }

        const decision = this.#opponent.choose(
          prompt,
          this.#projector.snapshot(),
        );
        const response = this.#prompts.respond(prompt.id, decision.choiceIds);
        this.#trace.record({
          kind: "response",
          promptId: prompt.id,
          choiceIds: decision.choiceIds,
          player: 1,
          opponentReason: decision.reason,
        });
        this.#session.respond(response);
        answeredOpponent = true;
      }

      if (this.#result !== null) {
        return {
          state: this.#projector.snapshot(),
          events,
          result: this.#result,
        };
      }
      if (boundary.status === "ended") {
        throw new Error("ocgcore ended without emitting a duel result");
      }
      if (!answeredOpponent) {
        throw new Error(
          "ocgcore is waiting but emitted no supported player prompt",
        );
      }
    }

    throw new Error(
      `Opponent exceeded ${this.#maximumAutomaticResponses} automatic responses without reaching the human`,
    );
  }

  respond(promptId: PromptId, choiceIds: readonly ChoiceId[]): DuelAdvance {
    this.#assertActive();
    const prompt = this.#prompts.current;
    if (prompt?.player !== 0)
      throw new Error("No human prompt is awaiting a response");
    const response = this.#prompts.respond(promptId, choiceIds);
    this.#trace.record({ kind: "response", promptId, choiceIds, player: 0 });
    this.#session.respond(response);
    return this.advance();
  }

  surrender(): DuelAdvance {
    this.#assertActive();
    this.#result = { type: "surrendered", winner: 1, loser: 0 };
    this.#trace.record({
      kind: "result",
      detail: JSON.stringify(this.#result),
    });
    this.#session.dispose();
    this.#prompts.clear();
    return {
      state: this.#projector.snapshot(),
      events: [],
      result: this.#result,
    };
  }

  dispose(): void {
    this.#prompts.clear();
    this.#session.dispose();
  }

  trace(): DuelTrace {
    return this.#trace.snapshot();
  }

  #assertActive(): void {
    if (this.#result !== null) throw new Error("Duel has already completed");
    if (this.#session.disposed) throw new Error("Duel has been disposed");
  }
}
