import type { ChoiceId, PromptId, SnapshotId } from "./ids.ts";
import type { PlayerIndex } from "./public-duel-state.ts";

export interface PublicDuelTraceEntry {
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
  readonly opponentReason?: string;
  readonly detail?: string;
}

export interface DuelDiagnosticTrace {
  readonly schemaVersion: 1;
  readonly sensitivity: "contains-production-seed";
  readonly presetId: string;
  readonly snapshotId: SnapshotId;
  readonly seed: readonly [string, string, string, string];
  readonly coreVersion: readonly [number, number];
  readonly revisions: {
    readonly enginePackage: "ocgcore-wasm";
    readonly engineVersion: "0.1.2";
    readonly babelCdb: string;
    readonly cardScripts: string;
    readonly distribution: string;
    readonly activeImageManifestSha256: string;
  };
  readonly entries: readonly PublicDuelTraceEntry[];
  readonly lastMessageType?: number;
  readonly pendingPromptId?: PromptId;
}

export interface DownloadableDuelDiagnostics {
  readonly schemaVersion: 1;
  readonly sensitivity: "contains-production-seed";
  readonly generatedAt: string;
  readonly application: {
    readonly buildId: string;
    readonly userAgent: string;
    readonly language: string;
    readonly activeSnapshotId: SnapshotId | null;
    readonly fallbackSnapshotId: SnapshotId | null;
    readonly imageCache: {
      readonly provider: string;
      readonly snapshotId: SnapshotId | null;
      readonly verified: boolean;
      readonly cacheHits: number;
      readonly cacheMisses: number;
      readonly missing: number;
      readonly invalid: number;
    };
  };
  readonly trace: DuelDiagnosticTrace;
}
