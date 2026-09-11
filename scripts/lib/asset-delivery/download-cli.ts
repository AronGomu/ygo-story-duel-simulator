import { assetCli, parseFlags } from "./cli.ts";
import { downloadAssets, type DownloadDependencies } from "./download.ts";
import { defaultDownloadDependencies } from "./download-transport.ts";
import { fail } from "./failure.ts";

export async function runDownload(
  root: string,
  args: readonly string[],
  dependencies: DownloadDependencies = defaultDownloadDependencies,
  stdout: (line: string) => void = console.log,
  stderr: (line: string) => void = console.error,
): Promise<number> {
  return assetCli(
    "download",
    async (progress) => {
      const flags = parseFlags(args, ["--help"], ["--version"]);
      if (flags.has("--help")) {
        if (flags.size !== 1) fail("ASSET_ARGUMENT_INVALID");
        progress("help: assets:download [--version <exact-version>]");
        return;
      }
      const version = flags.get("--version");
      const result = await downloadAssets(
        root,
        typeof version === "string"
          ? { kind: "release", version }
          : { kind: "nightly" },
        { ...dependencies, progress },
      );
      if (result.status === "failed") throw new Error(result.code);
      return result.snapshotSha256 ?? undefined;
    },
    stdout,
    stderr,
  );
}
