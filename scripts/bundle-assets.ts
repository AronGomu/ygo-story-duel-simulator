import path from "node:path";
import { fileURLToPath } from "node:url";
import { runBundle } from "./lib/asset-delivery/bundle-cli.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
process.exitCode = await runBundle(root, process.argv.slice(2));
