import { assetCli, parseFlags } from "./cli.ts";
import { fail } from "./failure.ts";
import {
  applyLocalPrune,
  LOCAL_PRUNE_PLAN_PATH,
  planLocalPrune,
  resumeLocalPrune,
} from "./local-prune.ts";
import { parsePrunePlan } from "./prune-plan.ts";
import { readSourceJson } from "./source-files.ts";

export async function runPrune(
  root: string,
  args: readonly string[],
  stdout: (line: string) => void = console.log,
  stderr: (line: string) => void = console.error,
): Promise<number> {
  return assetCli(
    "prune",
    async (progress) => {
      const flags = parseFlags(
        args,
        ["--help", "--local", "--remote", "--resume"],
        ["--apply"],
      );
      if (flags.has("--help")) {
        if (args.length !== 1) fail("ASSET_ARGUMENT_INVALID");
        progress(
          "help: assets:prune --local | --apply <generated-plan> | --resume --local",
        );
        return;
      }
      if (flags.has("--remote")) fail("ASSET_TARGET_UNAVAILABLE");
      if (flags.has("--resume")) {
        if (!flags.has("--local") || flags.size !== 2)
          fail("ASSET_ARGUMENT_INVALID");
        progress("resume", "generated/asset-delivery/prune-journal.json");
        const result = await resumeLocalPrune(root);
        if (result.status === "failed") throw new Error(result.code);
        return result.snapshotSha256 ?? undefined;
      }
      if (flags.has("--apply")) {
        if (flags.size !== 1) fail("ASSET_ARGUMENT_INVALID");
        const planPath = flags.get("--apply") as string;
        progress("apply", planPath);
        const result = await applyLocalPrune(
          root,
          parsePrunePlan(await readSourceJson(root, planPath)),
        );
        if (result.status === "failed") throw new Error(result.code);
        return result.snapshotSha256 ?? undefined;
      }
      if (!flags.has("--local") || flags.size !== 1)
        fail("ASSET_ARGUMENT_INVALID");
      const plan = await planLocalPrune(root);
      progress("preview", LOCAL_PRUNE_PLAN_PATH, plan.candidates.length);
    },
    stdout,
    stderr,
  );
}
