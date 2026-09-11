import { assetCli, parseFlags } from "./cli.ts";
import { fail } from "./failure.ts";
import { applyPrune, previewPrune, resumePrune } from "./prune.ts";
import { parsePrunePlan } from "./prune-plan.ts";
import { readSourceJson } from "./source-files.ts";

export async function runPrune(
  root: string,
  args: readonly string[],
  environment: Readonly<Record<string, string | undefined>> = process.env,
): Promise<number> {
  return assetCli("prune", async (progress) => {
    const flags = parseFlags(
      args,
      ["--help", "--local", "--remote", "--resume"],
      ["--apply"],
    );
    if (flags.has("--help")) {
      if (args.length !== 1) fail("ASSET_ARGUMENT_INVALID");
      progress(
        "help: assets:prune --remote | --apply <plan-path> | --resume --remote",
      );
      return;
    }
    if (flags.has("--resume")) {
      if (args.length !== 2 || !flags.has("--remote"))
        fail("ASSET_ARGUMENT_INVALID");
      progress("resume");
      await resumePrune(root, "remote", environment);
      return;
    }
    if (flags.has("--apply")) {
      if (args.length !== 2) fail("ASSET_ARGUMENT_INVALID");
      const plan = parsePrunePlan(
        await readSourceJson(root, flags.get("--apply") as string),
      );
      progress("apply", flags.get("--apply") as string);
      await applyPrune(root, plan, environment);
      return;
    }
    if (args.length !== 1 || (!flags.has("--remote") && !flags.has("--local")))
      fail("ASSET_ARGUMENT_INVALID");
    if (flags.has("--local")) fail("ASSET_TARGET_UNAVAILABLE");
    progress("preview");
    const plan = await previewPrune(root, "remote", environment);
    progress(
      "complete",
      "generated/asset-delivery/prune-remote.json",
      plan.candidates.reduce((sum, item) => sum + item.bytes, 0),
    );
  });
}
