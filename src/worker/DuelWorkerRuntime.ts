import { assertNever } from "../duel/contracts/assert-never.ts";
import {
  DuelCommandValidationError,
  type DuelCommand,
} from "../duel/contracts/duel-command.ts";
import type { DuelDiagnosticTrace } from "../duel/contracts/duel-diagnostics.ts";
import {
  duelOperationError,
  type DuelError,
} from "../duel/contracts/duel-error.ts";
import type { DuelWorkerEvent } from "../duel/contracts/duel-worker-event.ts";
import type { SnapshotId } from "../duel/contracts/ids.ts";
import type { MvpPreset } from "../duel/presets/mvp-preset.ts";
import type { ActiveDuelDependencies } from "./assets/active-duel-dependencies.ts";
import {
  BoundedDuelTrace,
  type DuelTrace,
  type DuelTraceEntry,
} from "./diagnostics/duel-trace.ts";
import { DuelSession } from "./engine/DuelSession.ts";
import { createProductionSeed } from "./engine/duel-seed.ts";
import type { OcgCoreAdapter } from "./engine/OcgCoreAdapter.ts";
import {
  HeadlessDuelController,
  type DuelAdvance,
} from "./HeadlessDuelController.ts";
import { toDuelError } from "./duel-errors.ts";
import {
  safeWorkerLogger,
  workerLog,
  type WorkerLogger,
} from "./diagnostics/worker-log.ts";

const DEFAULT_MAXIMUM_QUEUED_COMMANDS = 128;
const MAXIMUM_RUNTIME_ID_LENGTH = 128;

type QueuedDuelCommand = Exclude<DuelCommand, { readonly type: "dispose" }>;

export { toDuelError };

export interface DuelRuntimeRevisionMetadata {
  readonly babelCdb: string;
  readonly cardScripts: string;
  readonly distribution: string;
  readonly activeImageManifestSha256: string;
}

export interface DuelRuntimeResources {
  readonly adapter: OcgCoreAdapter;
  readonly dependencies: ActiveDuelDependencies;
  readonly preset: MvpPreset;
  readonly snapshotId: SnapshotId;
  readonly revisions?: DuelRuntimeRevisionMetadata;
}

export type DuelRuntimeInitializer = (
  progress: (stage: string, value?: number) => void,
  signal: AbortSignal,
) => Promise<DuelRuntimeResources>;

export type DuelRuntimeProgressSink = (
  event: Extract<DuelWorkerEvent, { readonly type: "loading" }>,
) => void;

export interface DuelRuntimeFailureContext {
  readonly commandType: DuelCommand["type"];
  readonly code: DuelError["code"];
  readonly runtimeId: string;
  readonly traceMetadata?: Pick<DuelTrace, "presetId" | "snapshotId">;
  readonly traceTail?: readonly DuelTraceEntry[];
}

export type DuelRuntimeFailureSink = (
  error: unknown,
  context: DuelRuntimeFailureContext,
) => void;

export interface DuelWorkerRuntimeOptions {
  readonly maximumQueuedCommands?: number;
  readonly runtimeId?: string;
  readonly logger?: WorkerLogger;
}

export class DuelWorkerRuntime {
  readonly #initializeResources: DuelRuntimeInitializer;
  #resources: DuelRuntimeResources | null = null;
  #initializationFailure: { readonly error: unknown } | null = null;
  #initializationAbortController: AbortController | null = null;
  #controller: HeadlessDuelController | null = null;
  #lastTrace: DuelTrace | null = null;
  #commandQueue: Promise<void> = Promise.resolve();
  readonly #maximumQueuedCommands: number;
  readonly #runtimeId: string;
  readonly #logger: WorkerLogger;
  #pendingCommands = 0;
  #nextDuelSequence = 0;
  #activeCommandDepth = 0;
  #deferredControllerDisposal: HeadlessDuelController | null = null;
  #disposed = false;

  constructor(
    initializeResources: DuelRuntimeInitializer,
    options: DuelWorkerRuntimeOptions = {},
  ) {
    this.#initializeResources = initializeResources;
    this.#maximumQueuedCommands =
      options.maximumQueuedCommands ?? DEFAULT_MAXIMUM_QUEUED_COMMANDS;
    this.#runtimeId = options.runtimeId ?? globalThis.crypto.randomUUID();
    this.#logger = safeWorkerLogger(options.logger ?? workerLog);
    if (
      !Number.isSafeInteger(this.#maximumQueuedCommands) ||
      this.#maximumQueuedCommands <= 0
    ) {
      throw new Error(
        `Invalid Worker command queue limit: ${this.#maximumQueuedCommands}`,
      );
    }
    if (
      this.#runtimeId.trim().length === 0 ||
      this.#runtimeId.length > MAXIMUM_RUNTIME_ID_LENGTH
    ) {
      throw new Error("Invalid Worker runtime ID");
    }
  }

  handle(
    command: DuelCommand,
    progressSink?: DuelRuntimeProgressSink,
    failureSink?: DuelRuntimeFailureSink,
  ): Promise<readonly DuelWorkerEvent[]> {
    if (command.type === "dispose") {
      this.dispose();
      return Promise.resolve([]);
    }
    if (this.#disposed) return Promise.resolve([]);
    if (this.#pendingCommands >= this.#maximumQueuedCommands) {
      const error = new DuelCommandValidationError(
        `Worker command queue limit of ${this.#maximumQueuedCommands} was reached`,
      );
      const duelError = toDuelError(error);
      this.#reportFailure(
        error,
        {
          commandType: command.type,
          code: duelError.code,
          runtimeId: this.#runtimeId,
        },
        failureSink,
      );
      if (this.#disposed) return Promise.resolve([]);
      return Promise.resolve([{ type: "error", error: duelError }]);
    }

    this.#pendingCommands += 1;
    const operation = this.#commandQueue.then(async () => {
      if (this.#disposed) return [];
      this.#activeCommandDepth += 1;
      try {
        return await this.#handleCommand(command, progressSink, failureSink);
      } finally {
        this.#activeCommandDepth -= 1;
        if (this.#activeCommandDepth === 0) this.#flushDeferredDisposal();
      }
    });
    const trackedOperation = operation.finally(() => {
      this.#pendingCommands -= 1;
    });
    this.#commandQueue = trackedOperation.then(
      () => undefined,
      () => undefined,
    );
    return trackedOperation;
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    this.#initializationAbortController?.abort();
    this.#initializationAbortController = null;
    const controller = this.#controller;
    this.#controller = null;
    this.#resources = null;
    this.#initializationFailure = null;
    if (controller === null) return;
    if (this.#activeCommandDepth > 0) {
      this.#deferredControllerDisposal = controller;
      return;
    }
    this.#disposeController(controller, "runtime_disposed");
  }

  async #handleCommand(
    command: QueuedDuelCommand,
    progressSink?: DuelRuntimeProgressSink,
    failureSink?: DuelRuntimeFailureSink,
  ): Promise<readonly DuelWorkerEvent[]> {
    const events: DuelWorkerEvent[] = [];
    try {
      switch (command.type) {
        case "initialize": {
          await this.#initialize(events, progressSink);
          if (this.#disposed) return [];
          const resources = this.#requireResources();
          events.push({
            type: "ready",
            coreVersion: resources.adapter.getVersion(),
            snapshotId: resources.snapshotId,
            ...(resources.revisions?.activeImageManifestSha256 === undefined
              ? {}
              : {
                  activeImageManifestSha256:
                    resources.revisions.activeImageManifestSha256,
                }),
          });
          break;
        }
        case "startDuel":
          this.#startDuel(command.duelId, events);
          break;
        case "respond": {
          const controller = this.#requireController();
          this.#recordAdvance(
            controller,
            controller.respond(command.promptId, command.choiceIds),
            events,
          );
          break;
        }
        case "surrender": {
          const controller = this.#requireController();
          this.#recordAdvance(controller, controller.surrender(), events);
          break;
        }
        case "requestDiagnostics":
          events.push({ type: "diagnostics", trace: this.#diagnosticTrace() });
          break;
        default:
          assertNever(command);
      }
    } catch (error) {
      if (this.#disposed) return [];
      const controller = this.#controller;
      const trace = controller?.trace();
      if (trace !== undefined) this.#lastTrace = trace;
      const traceTail = trace?.entries.slice(-20);
      const terminal = controller?.disposed === true;
      if (terminal) this.#controller = null;
      const duelError = toDuelError(error, { terminal });
      this.#reportFailure(
        error,
        {
          commandType: command.type,
          code: duelError.code,
          runtimeId: this.#runtimeId,
          ...(trace === undefined
            ? {}
            : {
                traceMetadata: {
                  presetId: trace.presetId,
                  snapshotId: trace.snapshotId,
                },
              }),
          ...(traceTail === undefined || traceTail.length === 0
            ? {}
            : { traceTail }),
        },
        failureSink,
      );
      events.push({ type: "error", error: duelError });
    }
    return this.#disposed ? [] : events;
  }

  async #initialize(
    events: DuelWorkerEvent[],
    progressSink?: DuelRuntimeProgressSink,
  ): Promise<void> {
    if (this.#resources !== null) return;
    if (this.#initializationFailure !== null) {
      throw this.#initializationFailure.error;
    }

    const abortController = new AbortController();
    this.#initializationAbortController = abortController;
    try {
      const resources = await this.#initializeResources((stage, progress) => {
        if (this.#disposed) return;
        const event = {
          type: "loading" as const,
          stage,
          ...(progress === undefined ? {} : { progress }),
        };
        if (progressSink === undefined) events.push(event);
        else progressSink(event);
      }, abortController.signal);
      if (!this.#disposed) this.#resources = resources;
    } catch (error) {
      if (!this.#disposed) this.#initializationFailure = { error };
      throw error;
    } finally {
      if (this.#initializationAbortController === abortController) {
        this.#initializationAbortController = null;
      }
    }
  }

  #startDuel(duelId: string, events: DuelWorkerEvent[]): void {
    const resources = this.#requireResources();
    if (this.#controller !== null) {
      throw duelOperationError(
        "duel_already_active",
        "A duel session is already active",
      );
    }
    if (duelId !== resources.preset.id) {
      throw duelOperationError(
        "invalid_command",
        `Unknown preset duel: ${duelId}`,
      );
    }
    const seed = createProductionSeed();
    const trace = new BoundedDuelTrace(
      resources.preset.id,
      resources.snapshotId,
      seed,
    );
    trace.record({ kind: "lifecycle", detail: "session creation started" });
    this.#lastTrace = trace.snapshot();
    let session: DuelSession;
    try {
      session = DuelSession.create({
        adapter: resources.adapter,
        dependencies: resources.dependencies,
        playerDeck: resources.preset.player,
        opponentDeck: resources.preset.opponent,
        configuration: { mode: "production", seed },
        onEngineDiagnostic: ({ type, message, error }) =>
          this.#logger.warn({
            event: "duel.worker.engine.session.diagnostic",
            runtimeId: this.#runtimeId,
            duelId,
            diagnosticType: type,
            message,
            ...(error === undefined ? {} : { err: error }),
          }),
      });
    } catch (error) {
      trace.record({
        kind: "error",
        detail:
          error instanceof Error ? error.message : "Session creation failed",
      });
      this.#lastTrace = trace.snapshot();
      throw error;
    }
    if (this.#disposed) {
      try {
        session.dispose();
      } catch (error) {
        this.#logger.error({
          event: "duel.worker.session.cleanup.failed",
          runtimeId: this.#runtimeId,
          duelId,
          reason: "runtime_disposed_during_creation",
          err: error,
        });
      }
      return;
    }
    let controller: HeadlessDuelController | null = null;
    try {
      controller = new HeadlessDuelController({
        session,
        dependencies: resources.dependencies,
        snapshotId: resources.snapshotId,
        presetId: resources.preset.id,
        deckCounts: [
          resources.preset.player.main.length,
          resources.preset.opponent.main.length,
        ],
        extraDeckCounts: [
          resources.preset.player.extra.length,
          resources.preset.opponent.extra.length,
        ],
        promptIdNamespace: `${this.#runtimeId}-duel-${++this.#nextDuelSequence}`,
        trace,
      });
      this.#controller = controller;
      this.#recordAdvance(controller, controller.advance(), events);
    } catch (error) {
      try {
        if (controller === null) session.dispose();
        else controller.dispose();
      } catch (cleanupError) {
        throw new AggregateError(
          [error, cleanupError],
          "Duel start failed and session cleanup also failed",
          { cause: error },
        );
      }
      throw error;
    }
  }

  #recordAdvance(
    controller: HeadlessDuelController,
    advance: DuelAdvance,
    events: DuelWorkerEvent[],
  ): void {
    events.push(...advanceEvents(advance));
    if (advance.result !== undefined || controller.disposed) {
      this.#lastTrace = controller.trace();
      this.#controller = null;
    }
  }

  #flushDeferredDisposal(): void {
    const controller = this.#deferredControllerDisposal;
    this.#deferredControllerDisposal = null;
    if (controller !== null)
      this.#disposeController(controller, "deferred_runtime_disposal");
  }

  #disposeController(controller: HeadlessDuelController, reason: string): void {
    try {
      controller.dispose();
    } catch (error) {
      this.#logger.error({
        event: "duel.worker.session.cleanup.failed",
        runtimeId: this.#runtimeId,
        reason,
        err: error,
      });
      throw error;
    }
  }

  #reportFailure(
    error: unknown,
    context: DuelRuntimeFailureContext,
    failureSink?: DuelRuntimeFailureSink,
  ): void {
    if (failureSink !== undefined) {
      failureSink(error, context);
      return;
    }
    this.#logger.error({
      event: "duel.worker.command.failed",
      commandType: context.commandType,
      code: context.code,
      runtimeId: context.runtimeId,
      ...(context.traceMetadata === undefined
        ? {}
        : { traceMetadata: context.traceMetadata }),
      ...(context.traceTail === undefined
        ? {}
        : { traceTail: context.traceTail }),
      err: error,
    });
  }

  #diagnosticTrace(): DuelDiagnosticTrace {
    const resources = this.#requireResources();
    const trace = this.#controller?.trace() ?? this.#lastTrace;
    if (trace === null)
      throw duelOperationError(
        "duel_not_active",
        "No duel diagnostics are available yet",
      );
    const lastMessageType = [...trace.entries]
      .reverse()
      .find(
        ({ kind, messageType }) =>
          kind === "message" && messageType !== undefined,
      )?.messageType;
    const lastPrompt = [...trace.entries]
      .reverse()
      .find(
        ({ kind, promptId }) => kind === "prompt" && promptId !== undefined,
      );
    const promptAnswered =
      lastPrompt?.promptId === undefined
        ? true
        : trace.entries.some(
            ({ sequence, kind, promptId }) =>
              sequence > lastPrompt.sequence &&
              kind === "response" &&
              promptId === lastPrompt.promptId,
          );
    return Object.freeze({
      schemaVersion: 1,
      sensitivity: "contains-production-seed",
      presetId: trace.presetId,
      snapshotId: trace.snapshotId,
      seed: trace.seed,
      coreVersion: resources.adapter.getVersion(),
      revisions: Object.freeze({
        enginePackage: "ocgcore-wasm",
        engineVersion: "0.1.2",
        babelCdb: resources.revisions?.babelCdb ?? "identified-by-snapshot",
        cardScripts:
          resources.revisions?.cardScripts ?? "identified-by-snapshot",
        distribution:
          resources.revisions?.distribution ?? "identified-by-snapshot",
        activeImageManifestSha256:
          resources.revisions?.activeImageManifestSha256 ??
          "identified-by-snapshot",
      }),
      entries: trace.entries,
      ...(lastMessageType === undefined ? {} : { lastMessageType }),
      ...(lastPrompt?.promptId === undefined || promptAnswered
        ? {}
        : { pendingPromptId: lastPrompt.promptId }),
    });
  }

  #requireResources(): DuelRuntimeResources {
    if (this.#resources === null) {
      throw duelOperationError(
        "engine_initialization_failed",
        "Worker must be initialized before starting a duel",
      );
    }
    return this.#resources;
  }

  #requireController(): HeadlessDuelController {
    if (this.#controller === null) {
      throw duelOperationError("duel_not_active", "No active duel session");
    }
    return this.#controller;
  }
}

function advanceEvents(advance: DuelAdvance): DuelWorkerEvent[] {
  const events: DuelWorkerEvent[] = advance.events.map((event) => ({
    type: "event",
    event,
  }));
  events.push({ type: "state", state: advance.state });
  if (advance.prompt !== undefined)
    events.push({ type: "prompt", prompt: advance.prompt });
  if (advance.result !== undefined)
    events.push({ type: "result", result: advance.result });
  return events;
}
