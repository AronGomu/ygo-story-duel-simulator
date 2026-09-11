import { assetCli, parseFlags } from "./cli.ts";
import { fail } from "./failure.ts";
import {
  applyLocalPrune,
  LOCAL_PRUNE_PLAN_PATH,
  planLocalPrune,
  resumeLocalPrune,
} from "./local-prune.ts";
import { applyPrune, previewPrune, resumePrune } from "./prune.ts";
import { parsePrunePlan } from "./prune-plan.ts";
import { readSourceJson } from "./source-files.ts";

type Environment = Readonly<Record<string, string | undefined>>;
type Output = (line: string) => void;

export async function runPrune(
  root: string,
  args: readonly string[],
  environmentOrStdout: Environment | Output = process.env,
  stderr: Output = console.error,
): Promise<number> {
  const environment =
    typeof environmentOrStdout === "function" ? process.env : environmentOrStdout;
  const stdout =
    typeof environmentOrStdout === "function"
      ? environmentOrStdout
      : console.log;

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
          "help: assets:prune --local | --remote | --apply <generated-plan> | --resume --local | --resume --remote",
        );
        return;
      }
      if (flags.has("--resume")) {
        if (
          flags.size !== 2 ||
          flags.has("--local") === flags.has("--remote")
        )
          fail("ASSET_ARGUMENT_INVALID");
        const scope = flags.has("--local") ? "local" : "remote";
        progress(
          "resume",
          scope === "local"
            ? "generated/asset-delivery/prune-journal.json"
            : "_control/prune-journal.json",
        );
        const result =
          scope === "local"
            ? await resumeLocalPrune(root)
            : await resumePrune(root, "remote", environment);
        if (result.status === "failed") fail(result.code, result.path ?? undefined);
        return result.snapshotSha256 ?? undefined;
      }
      if (flags.has("--apply")) {
        if (flags.size !== 1) fail("ASSET_ARGUMENT_INVALID");
        const planPath = flags.get("--apply") as string;
        const plan = parsePrunePlan(await readSourceJson(root, planPath));
        progress("apply", planPath);
        const result =
          plan.scope === "local"
            ? await applyLocalPrune(root, plan)
            : await applyPrune(root, plan, environment);
        if (result.status === "failed") fail(result.code, result.path ?? undefined);
        return result.snapshotSha256 ?? undefined;
      }
      if (
        flags.size !== 1 ||
        flags.has("--local") === flags.has("--remote")
      )
        fail("ASSET_ARGUMENT_INVALID");
      if (flags.has("--local")) {
        const plan = await planLocalPrune(root);
        progress("preview", LOCAL_PRUNE_PLAN_PATH, plan.candidates.length);
        return;
      }
      const plan = await previewPrune(root, "remote", environment);
      progress(
        "complete",
        "generated/asset-delivery/prune-remote.json",
        plan.candidates.reduce((sum, item) => sum + item.bytes, 0),
      );
    },
    stdout,
    stderr,
  );
}
