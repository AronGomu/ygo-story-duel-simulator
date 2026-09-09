import { assetCli, parseFlags } from "./cli.ts";
import { fail } from "./failure.ts";
import { parseProfileId } from "./asset-profile.ts";
import { promoteAssets } from "./promote.ts";

export async function runPromotion(
  root: string,
  args: readonly string[],
): Promise<number> {
  return assetCli("promote", async (progress) => {
    const flags = parseFlags(
      args,
      ["--help", "--apply", "--all"],
      ["--profile", "--files-from", "--from", "--logical-prefix"],
    );
    if (
      flags.has("--files-from") &&
      (flags.has("--from") ||
        flags.has("--all") ||
        flags.has("--logical-prefix"))
    )
      fail("ASSET_ARGUMENT_INVALID");
    if (flags.has("--help")) {
      progress(
        "help: assets:promote --profile <id> (--files-from <list> | --from <tree> --all [--logical-prefix <path>]) [--apply]",
      );
      return;
    }
    if (!flags.has("--profile")) fail("ASSET_ARGUMENT_INVALID");
    const preview = await promoteAssets(root, {
      profile: parseProfileId(flags.get("--profile")),
      filesFrom: flags.get("--files-from") as string | undefined,
      from: flags.get("--from") as string | undefined,
      logicalPrefix: flags.get("--logical-prefix") as string | undefined,
      all: flags.has("--all"),
      apply: flags.has("--apply"),
    });
    for (const change of preview.changes)
      progress(
        `proposed:${change.profile}:${change.kind}:${change.logicalPath}`,
        change.path,
      );
    progress(
      flags.has("--apply") ? "applied" : "preview",
      `asset-profiles/${preview.after.id}.json`,
    );
  });
}
