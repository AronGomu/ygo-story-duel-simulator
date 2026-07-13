import type { DuelPresentationEvent } from "../../duel/contracts/duel-presentation-event.ts";
import type { PlayerPrompt } from "../../duel/contracts/player-prompt.ts";
import type { PublicDuelState } from "../../duel/contracts/public-duel-state.ts";

/**
 * Main-thread presentation seam reserved for the later Phaser field.
 * Implementations consume domain state only and never talk to the Worker.
 */
export interface DuelPresentationBridge {
  applySnapshot(snapshot: PublicDuelState): void;
  applyPrompt(prompt: PlayerPrompt | null): void;
  present(event: DuelPresentationEvent): void;
  reset(): void;
  dispose(): void;
}
