import type { DuelWorkerEvent } from "../duel/contracts/duel-worker-event.ts";
import { createBrowserDuelWorkerRuntime } from "./create-browser-runtime.ts";
import { toDuelError } from "./duel-errors.ts";
import {
  safeWorkerLogger,
  workerLog,
  type WorkerLogEntry,
} from "./diagnostics/worker-log.ts";
import { attachDuelWorker, type DuelWorkerScope } from "./duel.worker.ts";

interface BrowserWorkerGlobal extends DuelWorkerScope {
  close(): void;
}

const workerGlobal = globalThis as unknown as BrowserWorkerGlobal;
const logger = safeWorkerLogger({
  debug: (entry) => workerLog.debug(redactSensitiveTrace(entry)),
  info: (entry) => workerLog.info(redactSensitiveTrace(entry)),
  warn: (entry) => workerLog.warn(redactSensitiveTrace(entry)),
  error: (entry) => workerLog.error(redactSensitiveTrace(entry)),
});

try {
  attachDuelWorker(
    workerGlobal,
    createBrowserDuelWorkerRuntime({ logger }),
    logger,
    (failure) => {
      try {
        if (failure !== null) {
          workerGlobal.postMessage({
            type: "error",
            error: toDuelError(failure, { terminal: true }),
          });
        }
        workerGlobal.postMessage({ type: "disposed", clean: failure === null });
      } finally {
        workerGlobal.close();
      }
    },
    (failure) => closeAfterBoundaryFailure(failure, { notify: false }),
  );
} catch (error) {
  closeAfterBoundaryFailure(error, { notify: true });
}

function redactSensitiveTrace(entry: WorkerLogEntry): WorkerLogEntry {
  const metadata = entry.traceMetadata;
  if (
    typeof metadata !== "object" ||
    metadata === null ||
    Array.isArray(metadata)
  )
    return entry;
  const safeMetadata = {
    ...(metadata as Readonly<Record<string, unknown>>),
  };
  delete safeMetadata.seed;
  return { ...entry, traceMetadata: safeMetadata };
}

function closeAfterBoundaryFailure(
  failure: unknown,
  options: { readonly notify: boolean },
): void {
  logger.error({
    event: options.notify
      ? "duel.worker.browser.bootstrap.failed"
      : "duel.worker.browser.boundary.failed",
    err: failure,
  });
  if (options.notify) {
    try {
      const event: DuelWorkerEvent = {
        type: "error",
        error: toDuelError(failure, { terminal: true }),
      };
      workerGlobal.postMessage(event);
    } catch (deliveryError) {
      logger.error({
        event: "duel.worker.browser.failure-notification.failed",
        err: deliveryError,
        originalError: failure,
      });
    }
  }
  workerGlobal.close();
}
