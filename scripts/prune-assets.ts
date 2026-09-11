import path from "node:path";
import { fileURLToPath } from "node:url";
import { runPrune } from "./lib/asset-delivery/prune-cli.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
process.exitCode = await runPrune(root, process.argv.slice(2));
