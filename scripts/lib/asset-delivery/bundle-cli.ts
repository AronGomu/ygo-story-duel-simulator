import { createHash } from "node:crypto";
import { assetCli, parseFlags } from "./cli.ts";
import { bundleAlreadyLocked } from "./bundle-locked.ts";
import { acquireAssetDeliveryLock } from "./local-lock.ts";
import { EMPTY_RETAINED_METADATA } from "./scan-assets.ts";
import { parseRetainedMetadata } from "./retained-metadata.ts";
import {
  parsePreparedPlayerMetadata,
  type PreparedPlayerMetadata,
} from "./prepared-player-metadata.ts";
import { readSourceJson, sourceStat } from "./source-files.ts";
import { canonicalBytes } from "./canonical-json.ts";
import { AssetDeliveryError, fail } from "./failure.ts";

export async function runBundle(
  root: string,
  args: readonly string[],
): Promise<number> {
  return assetCli("bundle", async (progress) => {
    const flags = parseFlags(
      args,
      ["--help", "--empty-history"],
      ["--target", "--version", "--retained-metadata", "--player-metadata"],
    );
    if (flags.has("--empty-history") && flags.has("--retained-metadata"))
      fail("ASSET_ARGUMENT_INVALID");
    if (flags.has("--help")) {
      progress(
        "help: assets:bundle --target dev|prod|all [--version <package-version>] [--retained-metadata <path>|--empty-history] [--player-metadata <path>]; retained object bytes: generated/asset-delivery/retained/objects/<key>",
      );
      return;
    }
    const target = flags.get("--target");
    if (target !== "dev" && target !== "prod" && target !== "all")
      fail("ASSET_ARGUMENT_INVALID");
    if (
      target === "dev" &&
      (flags.has("--retained-metadata") ||
        flags.has("--empty-history") ||
        flags.has("--player-metadata"))
    )
      fail("ASSET_ARGUMENT_INVALID");
    if (
      target !== "dev" &&
      !flags.has("--retained-metadata") &&
      !flags.has("--empty-history")
    )
      fail("ASSET_ARGUMENT_INVALID");
    const metadataPath =
      (flags.get("--player-metadata") as string | undefined) ??
      "generated/asset-delivery/prepared-player.json";
    if (target !== "dev" && !(await sourceStat(root, metadataPath)))
      fail("ASSET_TARGET_UNAVAILABLE", metadataPath);
    let player: PreparedPlayerMetadata | null = null;
    if (target !== "dev") {
      try {
        player = parsePreparedPlayerMetadata(
          await readSourceJson(root, metadataPath),
        );
      } catch (error) {
        if (
          error instanceof AssetDeliveryError &&
          error.code === "ASSET_CONFIG_INVALID"
        )
          fail("ASSET_TARGET_UNAVAILABLE", metadataPath);
        throw error;
      }
    }
    const history = flags.has("--retained-metadata")
      ? parseRetainedMetadata(
          await readSourceJson(
            root,
            flags.get("--retained-metadata") as string,
          ),
        )
      : EMPTY_RETAINED_METADATA;
    progress("scan-freeze");
    const release = await acquireAssetDeliveryLock(root);
    try {
      const candidate = await bundleAlreadyLocked(
        root,
        target,
        flags.has("--version")
          ? { kind: "release", version: flags.get("--version") as string }
          : { kind: "nightly" },
        history,
        player,
      );
      const report = (await readSourceJson(
        root,
        `${candidate.run}/omissions.json`,
      )) as { diagnostics: { phase: string; path: string; bytes: number }[] };
      for (const entry of report.diagnostics)
        if (entry.phase !== "dev-only")
          progress(entry.phase, entry.path, entry.bytes);
      progress("complete", candidate.run);
      return createHash("sha256")
        .update(canonicalBytes(candidate.snapshot))
        .digest("hex");
    } finally {
      await release();
    }
  });
}
