import { assetCli, parseFlags } from "./cli.ts";
import { fail } from "./failure.ts";
import { publishAssets } from "./publish.ts";
import { parseSetupOrigin } from "./setup-options.ts";

export async function runPublish(
  root: string,
  args: readonly string[],
  environment: Readonly<Record<string, string | undefined>> = process.env,
): Promise<number> {
  return assetCli("publish", async (progress) => {
    const flags = parseFlags(
      args,
      ["--help"],
      ["--target", "--version", "--origin"],
    );
    if (flags.has("--help")) {
      if (args.length !== 1) fail("ASSET_ARGUMENT_INVALID");
      progress(
        "help: assets:publish --target dev|prod|all --origin <exact-app-origin> [--version <package-version>]",
      );
      return;
    }
    const target = flags.get("--target");
    if (target !== "dev" && target !== "prod" && target !== "all")
      fail("ASSET_ARGUMENT_INVALID");
    const origin = parseSetupOrigin(flags.get("--origin"));
    progress("lock-freeze-upload");
    const result = await publishAssets(
      root,
      target,
      flags.has("--version")
        ? { kind: "release", version: flags.get("--version") as string }
        : { kind: "nightly" },
      origin,
      environment,
    );
    if (result.status === "failed") fail(result.code, result.path);
    progress("complete");
    return result.snapshotSha256 ?? undefined;
  });
}
