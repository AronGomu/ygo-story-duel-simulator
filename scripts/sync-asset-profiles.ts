import path from "node:path";
import { fileURLToPath } from "node:url";
import { runProfileSync } from "./lib/asset-delivery/profile-sync.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
process.exitCode = await runProfileSync(root, process.argv.slice(2));
