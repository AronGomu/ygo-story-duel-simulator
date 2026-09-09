import path from "node:path";
import { fileURLToPath } from "node:url";
import { runPromotion } from "./lib/asset-delivery/promotion-cli.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
process.exitCode = await runPromotion(root, process.argv.slice(2));
