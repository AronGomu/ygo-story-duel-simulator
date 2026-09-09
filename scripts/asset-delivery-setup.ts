import path from "node:path";
import { fileURLToPath } from "node:url";
import { runAssetSetup } from "./lib/asset-delivery/setup.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
process.exitCode = await runAssetSetup(
  root,
  process.argv.slice(2),
  process.env,
);
