import path from "node:path";
import { fileURLToPath } from "node:url";
import { runContentSetup } from "./lib/content-setup-files.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
process.exitCode = await runContentSetup(
  root,
  process.argv.slice(2),
  process.env,
);
