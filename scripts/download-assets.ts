import path from "node:path";
import { fileURLToPath } from "node:url";
import { runDownload } from "./lib/asset-delivery/download-cli.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
process.exitCode = await runDownload(root, process.argv.slice(2));
