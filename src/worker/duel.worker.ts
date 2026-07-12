import type { DuelCommand } from "../duel/contracts/duel-command.ts";
import type { DuelWorkerEvent } from "../duel/contracts/duel-worker-event.ts";
import type { DuelWorkerRuntime } from "./DuelWorkerRuntime.ts";

export interface DuelWorkerScope {
  onmessage: ((event: MessageEvent<DuelCommand>) => void) | null;
  postMessage(message: DuelWorkerEvent): void;
}

export function attachDuelWorker(
  scope: DuelWorkerScope,
  runtime: DuelWorkerRuntime,
): () => void {
  let disposed = false;
  scope.onmessage = (event) => {
    void runtime.handle(event.data).then((messages) => {
      if (disposed) return;
      for (const message of messages) scope.postMessage(message);
    });
  };
  return () => {
    disposed = true;
    scope.onmessage = null;
    runtime.dispose();
  };
}
