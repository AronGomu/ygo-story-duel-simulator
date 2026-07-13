import { fileURLToPath } from "node:url";
import { runNodeDuelWorker } from "../../src/worker/worker-thread-bridge-node.ts";

runNodeDuelWorker(
  fileURLToPath(new URL("./missing-runtime-root", import.meta.url)),
);
