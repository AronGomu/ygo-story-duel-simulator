import { assetCli, parseFlags } from "./cli.ts";
import { runBundle } from "./bundle-cli.ts";
import { verifyBundle } from "./verify-bundle.ts";
import { readSourceJson } from "./source-files.ts";
import { canonicalBytes } from "./canonical-json.ts";
import { createHash } from "node:crypto";
import { fail } from "./failure.ts";
import { object, version } from "./schema.ts";
import { assertSafePath } from "./path-guards.ts";
import { objectRefIn } from "./object-ref.ts";
import { objectRef } from "./bundle-objects.ts";

export async function runContent(
  root: string,
  operation: "pack" | "verify",
  args: readonly string[],
): Promise<number> {
  if (operation === "pack")
    return runBundle(root, ["--target", "prod", ...args]);
  return assetCli(
    operation === "verify" ? "check" : "scan",
    async (progress) => {
      const flags = parseFlags(
        args,
        ["--help"],
        operation === "verify" ? ["--run"] : [],
      );
      if (flags.has("--help")) {
        progress(
          `help: content:${operation}${operation === "verify" ? " [--run generated/asset-delivery/runs/<uuid>]" : ""}`,
        );
        return;
      }
      const explicit = flags.get("--run") as string | undefined;
      const pointer =
        explicit === undefined
          ? object(
              await readSourceJson(
                root,
                "generated/asset-delivery/current.json",
              ),
              {
                schemaVersion: version,
                run: assertSafePath,
                snapshot: objectRefIn("snapshots"),
              },
            )
          : null;
      const current = explicit ?? pointer!.run;
      const snapshot = await verifyBundle(root, current);
      const bytes = canonicalBytes(snapshot);
      const sha256 = createHash("sha256").update(bytes).digest("hex");
      if (
        pointer &&
        !Buffer.from(canonicalBytes(pointer.snapshot)).equals(
          Buffer.from(
            canonicalBytes(
              objectRef("snapshots", { bytes: bytes.length, sha256 }),
            ),
          ),
        )
      )
        fail("ASSET_INTEGRITY_FAILED");
      progress("verified", current);
      return sha256;
    },
  );
}
