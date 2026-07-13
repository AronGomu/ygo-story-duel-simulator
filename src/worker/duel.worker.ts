import { parseDuelCommand } from "../duel/contracts/duel-command.ts";
import type { DuelWorkerEvent } from "../duel/contracts/duel-worker-event.ts";
import { toDuelError, type DuelWorkerRuntime } from "./DuelWorkerRuntime.ts";
import {
  safeWorkerLogger,
  workerLog,
  type WorkerLogger,
} from "./diagnostics/worker-log.ts";

export interface DuelWorkerScope {
  onmessage: ((event: MessageEvent<unknown>) => void) | null;
  postMessage(message: DuelWorkerEvent): void;
}

export type DuelWorkerDetachObserver = (failure: unknown | null) => void;
export type DuelWorkerBoundaryFailureObserver = (failure: unknown) => void;

export function attachDuelWorker(
  scope: DuelWorkerScope,
  runtime: DuelWorkerRuntime,
  logger: WorkerLogger = workerLog,
  onDetach?: DuelWorkerDetachObserver,
  onBoundaryFailure?: DuelWorkerBoundaryFailureObserver,
): () => unknown | null {
  if (scope.onmessage !== null) {
    throw new Error("Duel Worker scope already has a message handler");
  }

  logger = safeWorkerLogger(logger);
  let disposed = false;
  const handler = (event: MessageEvent<unknown>): void => {
    let command;
    try {
      command = parseDuelCommand(event.data);
    } catch (error) {
      logger.warn({ event: "duel.worker.command.rejected", err: error });
      post({ type: "error", error: toDuelError(error) });
      return;
    }
    logger.debug({
      event: "duel.worker.command.received",
      commandType: command.type,
    });
    if (command.type === "dispose") {
      const error = detach();
      if (error === null) {
        logger.info({
          event: "duel.worker.command.completed",
          commandType: command.type,
        });
      } else {
        logger.error({
          event: "duel.worker.command.failed",
          commandType: command.type,
          err: error,
        });
      }
      return;
    }
    void runtime
      .handle(command, post, (error, context) => {
        logger.error({
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
      })
      .then((messages) => {
        if (messages.length === 0) {
          logger.debug({
            event: "duel.worker.command.skipped",
            commandType: command.type,
            reason: "runtime_invalidated",
          });
        }
        for (const message of messages) {
          if (message.type === "result") {
            logger.info({
              event: "duel.worker.command.completed",
              commandType: command.type,
              resultType: message.result.type,
            });
          }
          post(message);
        }
      })
      .catch((error: unknown) => {
        logger.error({
          event: "duel.worker.command.failed",
          commandType: command.type,
          err: error,
        });
        post({ type: "error", error: toDuelError(error) });
      });
  };
  function post(message: DuelWorkerEvent): void {
    if (disposed || scope.onmessage !== handler) {
      logger.debug({
        event: "duel.worker.event.skipped",
        eventType: message.type,
        reason: disposed ? "attachment_disposed" : "handler_replaced",
      });
      return;
    }
    try {
      scope.postMessage(message);
      logger.debug({
        event: "duel.worker.event.dispatched",
        eventType: message.type,
      });
    } catch (error) {
      logger.error({
        event: "duel.worker.event.failed",
        eventType: message.type,
        err: error,
      });
      try {
        onBoundaryFailure?.(error);
      } catch (observerError) {
        logger.error({
          event: "duel.worker.boundary.observer.failed",
          err: new AggregateError(
            [error, observerError],
            "Worker event dispatch and failure observation both failed",
          ),
        });
      }
    }
  }
  function detach(): unknown | null {
    if (disposed) return null;
    disposed = true;
    const ownedHandler = scope.onmessage === handler;
    if (ownedHandler) scope.onmessage = null;
    let failure: unknown | null = null;
    try {
      runtime.dispose();
    } catch (error) {
      failure = error;
      logger.error({ event: "duel.worker.detach.failed", err: error });
    }
    logger.info({
      event: "duel.worker.detached",
      ownedHandler,
    });
    try {
      onDetach?.(failure);
    } catch (error) {
      logger.error({ event: "duel.worker.detach.observer.failed", err: error });
      failure =
        failure === null
          ? error
          : new AggregateError(
              [failure, error],
              "Runtime cleanup and detach observation both failed",
            );
    }
    return failure;
  }
  scope.onmessage = handler;

  return detach;
}
