export interface WorkerLogEntry {
  readonly event: string;
  readonly [field: string]: unknown;
}

export interface WorkerLogger {
  debug(entry: WorkerLogEntry): void;
  info(entry: WorkerLogEntry): void;
  warn(entry: WorkerLogEntry): void;
  error(entry: WorkerLogEntry): void;
}

export const workerLog: WorkerLogger = Object.freeze({
  debug: () => undefined,
  info: (entry: WorkerLogEntry) => console.info(entry),
  warn: (entry: WorkerLogEntry) => console.warn(entry),
  error: (entry: WorkerLogEntry) => console.error(entry),
});

export function safeWorkerLogger(logger: WorkerLogger): WorkerLogger {
  const safe =
    (level: keyof WorkerLogger) =>
    (entry: WorkerLogEntry): void => {
      try {
        logger[level](entry);
      } catch (error) {
        try {
          console.error({
            event: "duel.worker.logging.failed",
            level,
            originalEvent: entry.event,
            error,
          });
        } catch {
          // No secondary observation path remains when the host console fails.
        }
      }
    };
  return {
    debug: safe("debug"),
    info: safe("info"),
    warn: safe("warn"),
    error: safe("error"),
  };
}
