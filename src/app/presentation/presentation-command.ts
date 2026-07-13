import { assertNever } from "../../duel/contracts/assert-never.ts";
import type { DuelPresentationEvent } from "../../duel/contracts/duel-presentation-event.ts";

export type PresentationCommand =
  | {
      readonly kind: "card-move";
      readonly label: string;
      readonly durationMs: number;
    }
  | {
      readonly kind: "summon" | "set" | "position";
      readonly label: string;
      readonly durationMs: number;
    }
  | {
      readonly kind: "attack";
      readonly label: string;
      readonly durationMs: number;
    }
  | {
      readonly kind: "life-points";
      readonly label: string;
      readonly player: 0 | 1;
      readonly amount?: number;
      readonly durationMs: number;
    }
  | {
      readonly kind: "chain";
      readonly label: string;
      readonly size: number;
      readonly durationMs: number;
    }
  | {
      readonly kind: "notice";
      readonly label: string;
      readonly durationMs: number;
    };

export function presentationCommandForEvent(
  event: DuelPresentationEvent,
  reducedMotion = false,
): PresentationCommand {
  const durationMs = reducedMotion ? 0 : 420;
  switch (event.type) {
    case "cardMoved":
      return {
        kind: "card-move",
        label: `Card moved from ${event.from} to ${event.to}`,
        durationMs,
      };
    case "summon":
      return { kind: "summon", label: "Normal Summon", durationMs };
    case "specialSummon":
      return { kind: "summon", label: "Special Summon", durationMs };
    case "flipSummon":
      return { kind: "summon", label: "Flip Summon", durationMs };
    case "set":
      return { kind: "set", label: "Card set", durationMs };
    case "positionChanged":
      return { kind: "position", label: "Position changed", durationMs };
    case "attack":
      return {
        kind: "attack",
        label: event.direct ? "Direct attack" : "Attack declared",
        durationMs,
      };
    case "damage":
      return {
        kind: "life-points",
        label: `${event.amount} damage`,
        player: event.player,
        amount: -event.amount,
        durationMs,
      };
    case "recover":
      return {
        kind: "life-points",
        label: `${event.amount} LP recovered`,
        player: event.player,
        amount: event.amount,
        durationMs,
      };
    case "lifePointsChanged":
      return {
        kind: "life-points",
        label: `LP ${event.lifePoints}`,
        player: event.player,
        durationMs,
      };
    case "chainChanged":
      return {
        kind: "chain",
        label: event.size === 0 ? "Chain resolved" : `Chain Link ${event.size}`,
        size: event.size,
        durationMs,
      };
    case "duelStarted":
      return { kind: "notice", label: "Duel started", durationMs };
    case "turnStarted":
      return {
        kind: "notice",
        label: `${event.player === 0 ? "Your" : "Opponent's"} turn`,
        durationMs,
      };
    case "phaseChanged":
      return {
        kind: "notice",
        label: `${event.phase} phase`,
        durationMs,
      };
    case "cardDrawn":
      return {
        kind: "notice",
        label: `${event.player === 0 ? "You draw" : "Opponent draws"} ${event.count}`,
        durationMs,
      };
    case "cardsShuffled":
      return {
        kind: "notice",
        label: `${event.location} shuffled`,
        durationMs,
      };
    case "hint":
      return { kind: "notice", label: event.message, durationMs };
    default:
      return assertNever(event);
  }
}

export class PresentationScheduler {
  #generation = 0;

  run(
    command: PresentationCommand,
    present: (command: PresentationCommand) => void,
  ): void {
    const generation = this.#generation;
    queueMicrotask(() => {
      if (generation === this.#generation) present(command);
    });
  }

  cancel(): void {
    this.#generation += 1;
  }
}
