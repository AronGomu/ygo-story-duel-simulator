import path from "node:path";
import { fileURLToPath } from "node:url";
import { runContent } from "./lib/asset-delivery/content-cli.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
process.exitCode = await runContent(root, "pack", process.argv.slice(2));
