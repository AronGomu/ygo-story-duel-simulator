import type {
  ChoiceId,
  PromptId,
  SnapshotId,
} from "../../duel/contracts/ids.ts";
import type { PlayerIndex } from "../../duel/contracts/public-duel-state.ts";
import type { DuelSeed } from "../engine/duel-seed.ts";
import type { OpponentDecisionReason } from "../opponent/OpponentPolicy.ts";

export interface DuelTraceEntry {
  readonly sequence: number;
  readonly kind:
    "process" | "message" | "prompt" | "response" | "result" | "error";
  readonly status?: number;
  readonly messageType?: number;
  readonly promptId?: PromptId;
  readonly choiceIds?: readonly ChoiceId[];
  readonly player?: PlayerIndex;
  readonly opponentReason?: OpponentDecisionReason;
  readonly detail?: string;
}

export interface DuelTrace {
  readonly schemaVersion: 1;
  readonly presetId: string;
  readonly snapshotId: SnapshotId;
  readonly seed: readonly [string, string, string, string];
  readonly entries: readonly DuelTraceEntry[];
}

export class BoundedDuelTrace {
  readonly #presetId: string;
  readonly #snapshotId: SnapshotId;
  readonly #seed: DuelSeed;
  readonly #maximumEntries: number;
  readonly #entries: DuelTraceEntry[] = [];
  #nextSequence = 1;

  constructor(
    presetId: string,
    snapshotId: SnapshotId,
    seed: DuelSeed,
    maximumEntries = 10_000,
  ) {
    this.#presetId = presetId;
    this.#snapshotId = snapshotId;
    this.#seed = seed;
    this.#maximumEntries = maximumEntries;
  }

  record(entry: Omit<DuelTraceEntry, "sequence">): void {
    if (this.#entries.length >= this.#maximumEntries) this.#entries.shift();
    this.#entries.push(
      Object.freeze({ sequence: this.#nextSequence++, ...entry }),
    );
  }

  snapshot(): DuelTrace {
    return Object.freeze({
      schemaVersion: 1,
      presetId: this.#presetId,
      snapshotId: this.#snapshotId,
      seed: this.#seed.map(String) as [string, string, string, string],
      entries: Object.freeze([...this.#entries]),
    });
  }
}
