import { runPrune } from "./lib/asset-delivery/prune-cli.ts";

process.exitCode = await runPrune(process.cwd(), process.argv.slice(2));
