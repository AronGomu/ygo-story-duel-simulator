import path from "node:path";
import { fileURLToPath } from "node:url";
import { runMigration } from "./lib/asset-delivery/migration-cli.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
process.exitCode = await runMigration(root, process.argv.slice(2));
