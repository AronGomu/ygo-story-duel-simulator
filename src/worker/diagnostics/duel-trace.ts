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
    | "process"
    | "message"
    | "presentation"
    | "prompt"
    | "response"
    | "result"
    | "error"
    | "lifecycle";
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
  readonly #maximumTextUnits: number;
  readonly #entries: DuelTraceEntry[] = [];
  #nextSequence = 1;
  #textUnits = 0;

  constructor(
    presetId: string,
    snapshotId: SnapshotId,
    seed: DuelSeed,
    maximumEntries = 10_000,
    maximumTextUnits = 900_000,
  ) {
    this.#presetId = presetId;
    this.#snapshotId = snapshotId;
    this.#seed = seed;
    this.#maximumEntries = maximumEntries;
    this.#maximumTextUnits = maximumTextUnits;
  }

  record(entry: Omit<DuelTraceEntry, "sequence">): void {
    const value = Object.freeze({
      sequence: this.#nextSequence++,
      ...entry,
      ...(entry.detail === undefined
        ? {}
        : { detail: entry.detail.slice(0, 4_096) }),
      ...(entry.choiceIds === undefined
        ? {}
        : { choiceIds: Object.freeze([...entry.choiceIds]) }),
    });
    const units = traceEntryTextUnits(value);
    while (
      this.#entries.length > 0 &&
      (this.#entries.length >= this.#maximumEntries ||
        this.#textUnits + units > this.#maximumTextUnits)
    ) {
      const removed = this.#entries.shift();
      if (removed !== undefined)
        this.#textUnits -= traceEntryTextUnits(removed);
    }
    this.#entries.push(value);
    this.#textUnits += units;
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

function traceEntryTextUnits(entry: DuelTraceEntry): number {
  return (
    (entry.promptId?.length ?? 0) +
    (entry.opponentReason?.length ?? 0) +
    (entry.detail?.length ?? 0) +
    (entry.choiceIds?.reduce((total, id) => total + id.length, 0) ?? 0)
  );
}
