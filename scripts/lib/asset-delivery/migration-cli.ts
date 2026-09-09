import { assetCli, parseFlags } from "./cli.ts";
import { fail } from "./failure.ts";
import { applyMigration, planMigration } from "./migrate.ts";
import { parseMigrationPlan } from "./migration-plan.ts";
import { readSourceJson } from "./source-files.ts";
import { assertSourcePath } from "./path-guards.ts";

export async function runMigration(
  root: string,
  args: readonly string[],
): Promise<number> {
  return assetCli("migrate", async (progress) => {
    const flags = parseFlags(args, ["--help", "--plan"], ["--apply"]);
    if (flags.has("--plan") && flags.has("--apply"))
      fail("ASSET_ARGUMENT_INVALID");
    if (flags.has("--help")) {
      progress(
        "help: assets:migrate (--plan | --apply <plan-path>); copy-only; originals preserved",
      );
      return;
    }
    if (flags.has("--plan") === flags.has("--apply"))
      fail("ASSET_ARGUMENT_INVALID");
    if (flags.has("--plan")) {
      const plan = await planMigration(root);
      for (const file of plan.files)
        progress(`copy:${file.to}:${file.sha256}`, file.from, file.bytes);
    } else {
      const relative = assertSourcePath(flags.get("--apply"));
      const receipt = await applyMigration(
        root,
        parseMigrationPlan(await readSourceJson(root, relative)),
      );
      for (const file of receipt.completed)
        progress(`verified:${file.sha256}`, file.path, file.bytes);
    }
  });
}
