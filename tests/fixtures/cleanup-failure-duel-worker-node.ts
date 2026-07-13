import { parentPort } from "node:worker_threads";
import { DuelWorkerRuntime } from "../../src/worker/DuelWorkerRuntime.ts";
import { attachNodeWorkerPort } from "../../src/worker/worker-thread-bridge-node.ts";

if (parentPort === null) {
  throw new Error("Cleanup-failure Worker fixture requires a parent port");
}

class CleanupFailureRuntime extends DuelWorkerRuntime {
  constructor() {
    super(async () => {
      throw new Error("initializer should not run");
    });
  }

  override dispose(): never {
    throw new Error("intentional cleanup failure");
  }
}

attachNodeWorkerPort(parentPort, new CleanupFailureRuntime());
