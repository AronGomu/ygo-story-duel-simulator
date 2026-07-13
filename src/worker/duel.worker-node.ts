import { fileURLToPath } from "node:url";
import { runNodeDuelWorker } from "./worker-thread-bridge-node.ts";

runNodeDuelWorker(fileURLToPath(new URL("../..", import.meta.url)));
