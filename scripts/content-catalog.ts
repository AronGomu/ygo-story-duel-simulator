import path from "node:path";
import { fileURLToPath } from "node:url";
import { assetCli, parseFlags } from "./lib/asset-delivery/cli.ts";
import { preparePlayerMetadata } from "./lib/asset-delivery/prepare-player.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
process.exitCode = await assetCli("scan", async (progress) => {
  const flags = parseFlags(process.argv.slice(2), ["--help"]);
  if (flags.has("--help")) {
    progress(
      "help: content:catalog; explicit authoring preparation, no packaging or publication",
    );
    return;
  }
  await preparePlayerMetadata(root, progress);
});
