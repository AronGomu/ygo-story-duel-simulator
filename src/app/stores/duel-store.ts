import { writable, type Readable } from "svelte/store";
import type { DuelDiagnosticTrace } from "../../duel/contracts/duel-diagnostics.ts";
import type { DuelError } from "../../duel/contracts/duel-error.ts";
import type { DuelPresentationEvent } from "../../duel/contracts/duel-presentation-event.ts";
import type { DuelResult } from "../../duel/contracts/duel-result.ts";
import type { PlayerPrompt } from "../../duel/contracts/player-prompt.ts";
import type { PublicDuelState } from "../../duel/contracts/public-duel-state.ts";
import { MVP_PRESET_ID } from "../../duel/presets/mvp-preset.ts";
import type {
  DuelClient,
  DuelClientContext,
  DuelClientEvent,
} from "../DuelWorkerClient.ts";
import { validatePromptSelection } from "../prompts/prompt-selection.ts";
import type { ChoiceId, SnapshotId } from "../../duel/contracts/ids.ts";

const MAXIMUM_PRESENTATION_EVENTS = 100;

export type DuelStatus =
  | "idle"
  | "initializing"
  | "loading"
  | "active"
  | "awaiting-input"
  | "completed"
  | "failed";

export interface DuelLoadingState {
  readonly stage: string;
  readonly progress?: number;
}

export interface SequencedPresentationEvent {
  readonly sequence: number;
  readonly event: DuelPresentationEvent;
}

export interface DuelViewState {
  readonly context: DuelClientContext;
  readonly status: DuelStatus;
  readonly coreVersion: readonly [number, number] | null;
  readonly runtimeSnapshotId: SnapshotId | null;
  readonly activeImageManifestSha256: string | null;
  readonly loading: DuelLoadingState | null;
  readonly snapshot: PublicDuelState | null;
  readonly prompt: PlayerPrompt | null;
  readonly result: DuelResult | null;
  readonly error: DuelError | null;
  readonly diagnostics: DuelDiagnosticTrace | null;
  readonly events: readonly DuelPresentationEvent[];
  readonly presentationEvents: readonly SequencedPresentationEvent[];
  readonly responsePending: boolean;
}

export interface DuelStore extends Readable<DuelViewState> {
  initialize(): boolean;
  start(): boolean;
  respond(choiceIds: readonly ChoiceId[]): boolean;
  surrender(): boolean;
  requestDiagnostics(): boolean;
  retry(): Promise<boolean>;
  restart(): Promise<boolean>;
  clearError(): void;
  destroy(): Promise<void>;
}

export function createInitialDuelViewState(
  context: DuelClientContext,
): DuelViewState {
  return Object.freeze({
    context: Object.freeze({ ...context }),
    status: "idle",
    coreVersion: null,
    runtimeSnapshotId: null,
    activeImageManifestSha256: null,
    loading: null,
    snapshot: null,
    prompt: null,
    result: null,
    error: null,
    diagnostics: null,
    events: Object.freeze([]),
    presentationEvents: Object.freeze([]),
    responsePending: false,
  });
}

export function reduceDuelViewState(
  state: DuelViewState,
  received: DuelClientEvent,
): DuelViewState {
  if (!sameContext(state.context, received.context)) return state;
  const event = received.event;
  switch (event.type) {
    case "ready":
      return freezeState({
        ...state,
        status: "idle",
        coreVersion: event.coreVersion,
        runtimeSnapshotId: event.snapshotId ?? null,
        activeImageManifestSha256: event.activeImageManifestSha256 ?? null,
        loading: null,
        error: null,
      });
    case "loading":
      return freezeState({
        ...state,
        status: "loading",
        loading: {
          stage: event.stage,
          ...(event.progress === undefined ? {} : { progress: event.progress }),
        },
      });
    case "state":
      return freezeState({
        ...state,
        status: "active",
        snapshot: event.state,
        prompt: state.responsePending ? state.prompt : null,
        responsePending: state.responsePending,
      });
    case "event": {
      const sequence = (state.presentationEvents.at(-1)?.sequence ?? 0) + 1;
      return freezeState({
        ...state,
        events: Object.freeze(
          [...state.events, event.event].slice(-MAXIMUM_PRESENTATION_EVENTS),
        ),
        presentationEvents: Object.freeze(
          [
            ...state.presentationEvents,
            Object.freeze({ sequence, event: event.event }),
          ].slice(-MAXIMUM_PRESENTATION_EVENTS),
        ),
      });
    }
    case "prompt":
      return freezeState({
        ...state,
        status: "awaiting-input",
        prompt: event.prompt,
        error: state.error?.recoverable === true ? null : state.error,
        responsePending: false,
      });
    case "diagnostics":
      return freezeState({ ...state, diagnostics: event.trace });
    case "result":
      return freezeState({
        ...state,
        status: "completed",
        prompt: null,
        result: event.result,
        error: null,
        loading: null,
        responsePending: false,
      });
    case "error":
      return event.error.code === "invalid_response" && state.prompt !== null
        ? freezeState({
            ...state,
            status: "awaiting-input",
            error: event.error,
            responsePending: false,
          })
        : freezeState({
            ...state,
            status: "failed",
            prompt: null,
            result: null,
            error: event.error,
            loading: null,
            responsePending: false,
          });
    case "disposed":
      return state;
  }
}

export function createDuelStore(client: DuelClient): DuelStore {
  let current = createInitialDuelViewState(client.context);
  const state = writable(current);
  const set = (next: DuelViewState): void => {
    current = next;
    state.set(next);
  };
  const unsubscribeClient = client.subscribe((event) => {
    set(reduceDuelViewState(current, event));
  });
  let replacementOperation: Promise<boolean> | null = null;
  const startCurrentDuel = (): boolean => {
    const context = client.startDuel(MVP_PRESET_ID);
    if (context === null) return false;
    set(
      freezeState({
        ...createInitialDuelViewState(context),
        status: "active",
        coreVersion: current.coreVersion,
        runtimeSnapshotId: current.runtimeSnapshotId,
        activeImageManifestSha256: current.activeImageManifestSha256,
      }),
    );
    return true;
  };
  const replaceAndInitialize = (): Promise<boolean> => {
    if (replacementOperation !== null) return replacementOperation;
    set(
      freezeState({
        ...current,
        status: "initializing",
        loading: { stage: "replacing-worker" },
        error: null,
        prompt: null,
        snapshot: null,
        result: null,
        diagnostics: null,
        events: Object.freeze([]),
        presentationEvents: Object.freeze([]),
        responsePending: true,
      }),
    );
    replacementOperation = (async () => {
      try {
        await client.replace();
        const next = freezeState({
          ...createInitialDuelViewState(client.context),
          status: "initializing" as const,
        });
        set(next);
        if (client.initialize()) return true;
        set(
          freezeState({
            ...next,
            status: "failed",
            error: {
              code: "worker_error",
              message: "Unable to initialize a replacement Duel Worker",
              recoverable: false,
            },
          }),
        );
      } catch (error) {
        set(
          freezeState({
            ...createInitialDuelViewState(client.context),
            status: "failed",
            error: {
              code: "worker_error",
              message:
                error instanceof Error
                  ? `Unable to replace the Duel Worker: ${error.message}`
                  : "Unable to replace the Duel Worker",
              recoverable: false,
            },
          }),
        );
      }
      return false;
    })().finally(() => {
      replacementOperation = null;
    });
    return replacementOperation;
  };

  return {
    subscribe: state.subscribe,
    initialize: () => {
      if (!client.initialize()) return false;
      set(
        freezeState({
          ...createInitialDuelViewState(client.context),
          status: "initializing",
        }),
      );
      return true;
    },
    start: startCurrentDuel,
    respond: (choiceIds) => {
      const prompt = current.prompt;
      if (
        prompt === null ||
        current.status !== "awaiting-input" ||
        current.responsePending
      ) {
        return false;
      }
      const validation = validatePromptSelection(prompt, choiceIds);
      if (!validation.valid) {
        set(
          freezeState({
            ...current,
            error: {
              code: "invalid_response",
              message: validation.message,
              recoverable: true,
            },
          }),
        );
        return false;
      }
      if (!client.respond(prompt.id, choiceIds)) {
        if ((current as DuelViewState).status === "failed") return false;
        set(
          freezeState({
            ...current,
            error: {
              code: "stale_prompt",
              message: "That prompt is no longer active",
              recoverable: true,
            },
          }),
        );
        return false;
      }
      set(
        freezeState({
          ...current,
          status: "active",
          responsePending: true,
          error: null,
        }),
      );
      return true;
    },
    surrender: () => {
      if (current.responsePending || !client.surrender()) return false;
      set(
        freezeState({
          ...current,
          status: "active",
          prompt: null,
          responsePending: true,
          error: null,
        }),
      );
      return true;
    },
    requestDiagnostics: () => client.requestDiagnostics(),
    retry: replaceAndInitialize,
    restart: replaceAndInitialize,
    clearError: () => {
      if (current.error?.recoverable !== true) return;
      set(freezeState({ ...current, error: null }));
    },
    destroy: async () => {
      unsubscribeClient();
      await client.dispose();
    },
  };
}

function sameContext(
  left: DuelClientContext,
  right: DuelClientContext,
): boolean {
  return (
    left.workerGeneration === right.workerGeneration &&
    left.sessionGeneration === right.sessionGeneration
  );
}

function freezeState(state: DuelViewState): DuelViewState {
  return Object.freeze(state);
}
