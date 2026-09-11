import { runPublish } from "./lib/asset-delivery/publish-cli.ts";

process.exitCode = await runPublish(process.cwd(), process.argv.slice(2));
