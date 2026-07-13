import { parentPort, type MessagePort } from "node:worker_threads";
import type { DuelWorkerRuntime } from "./DuelWorkerRuntime.ts";
import { createNodeDuelWorkerRuntime } from "./create-node-runtime.ts";
import {
  safeWorkerLogger,
  workerLog,
  type WorkerLogger,
} from "./diagnostics/worker-log.ts";
import { attachDuelWorker, type DuelWorkerScope } from "./duel.worker.ts";

export function runNodeDuelWorker(projectRoot: string): void {
  const logger = safeWorkerLogger(workerLog);
  try {
    if (parentPort === null) {
      throw new Error("The Node duel Worker entry requires a parent port");
    }
    attachNodeWorkerPort(
      parentPort,
      createNodeDuelWorkerRuntime(projectRoot, logger),
      logger,
    );
  } catch (error) {
    logger.error({ event: "duel.worker.node.bootstrap.failed", err: error });
    throw error;
  }
}

export function attachNodeWorkerPort(
  port: MessagePort,
  runtime: DuelWorkerRuntime,
  logger: WorkerLogger = workerLog,
): void {
  logger = safeWorkerLogger(logger);
  const scope: DuelWorkerScope = {
    onmessage: null,
    postMessage: (message) => port.postMessage(message),
  };
  let closed = false;

  const receive = (data: unknown): void => {
    scope.onmessage?.(new MessageEvent("message", { data }));
  };
  const receiveError = (error: Error): void => {
    logger.error({ event: "duel.worker.node.message.failed", err: error });
    close(error);
  };

  function close(observedFailure: unknown | null = null): void {
    if (closed) return;
    closed = true;
    port.off("message", receive);
    port.off("messageerror", receiveError);
    const cleanupFailure = detach();
    const failures = [observedFailure, cleanupFailure].filter(
      (failure) => failure !== null,
    );
    if (failures.length > 0) {
      const error =
        failures.length === 1
          ? failures[0]
          : new AggregateError(failures, "Duel Worker shutdown failed");
      logger.error({ event: "duel.worker.node.shutdown.failed", err: error });
      process.exitCode = 1;
    }
    port.close();
  }

  const detach = attachDuelWorker(scope, runtime, logger, close, close);
  port.on("message", receive);
  port.on("messageerror", receiveError);
  port.once("close", close);
}
