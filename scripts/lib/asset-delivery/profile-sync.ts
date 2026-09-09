import {
  checkAssetProfiles,
  scanAssetProfiles,
  EMPTY_RETAINED_METADATA,
} from "./scan-assets.ts";
import { loadSelection } from "./profile-set.ts";
import { replaceMetadata } from "./atomic-metadata.ts";
import { acquireAssetDeliveryLock } from "./local-lock.ts";
import { assetCli, parseFlags } from "./cli.ts";

export async function runProfileSync(
  root: string,
  args: readonly string[],
): Promise<number> {
  const operation = args.includes("--check") ? "check" : "scan";
  return assetCli(operation, async (progress) => {
    const flags = parseFlags(args, ["--help", "--check"]);
    if (flags.has("--help")) {
      progress("help: assets:profiles:sync [--check]; no profile edits");
      return;
    }
    const release = flags.has("--check")
      ? null
      : await acquireAssetDeliveryLock(root);
    try {
      const report = flags.has("--check")
        ? await checkAssetProfiles(root)
        : await scanAssetProfiles(
            root,
            await loadSelection(root),
            EMPTY_RETAINED_METADATA,
            null,
          );
      for (const diagnostic of report.diagnostics)
        progress(diagnostic.phase, diagnostic.path, diagnostic.bytes);
      if (!flags.has("--check"))
        await replaceMetadata(
          root,
          "generated/asset-delivery/inventory.json",
          report.inventory,
        );
      progress(
        "complete",
        null,
        report.inventory.files.reduce((n, f) => n + f.bytes, 0),
      );
    } finally {
      if (release) await release();
    }
  });
}
