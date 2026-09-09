import { lstat } from "node:fs/promises";
import { S3Client } from "@aws-sdk/client-s3";
import { readBounded } from "../content-setup-io.ts";
import { parseAssetDeliveryConfig } from "./config.ts";
import { failureResult, fail } from "./failure.ts";
import { MAX_METADATA_BYTES, parseJsonBytes } from "./canonical-json.ts";
import { assertSafeParents } from "./path-guards.ts";
import { parsePublicationApproval } from "./publication-approval.ts";
import { probeAssetSetup } from "./setup-remote.ts";
import { parseSetupOptions } from "./setup-options.ts";

export const PUBLISHER_ENV_NAMES = [
  "ASSET_R2_ACCOUNT_ID",
  "ASSET_R2_ACCESS_KEY_ID",
  "ASSET_R2_SECRET_ACCESS_KEY",
] as const;
const CONFIG_PATH = "asset-delivery.config.json";
const APPROVAL_PATH = "content/asset-publication-approval.json";

async function localJson(
  root: string,
  relative: string,
  optional = false,
): Promise<unknown> {
  try {
    const file = await assertSafeParents(root, relative);
    const info = await lstat(file);
    if (!info.isFile()) fail("ASSET_PATH_UNSAFE");
    if (info.size > MAX_METADATA_BYTES) fail("ASSET_LIMIT_EXCEEDED", relative);
    const bytes = await readBounded(root, relative, MAX_METADATA_BYTES);
    if (bytes === null) fail("ASSET_SOURCE_CHANGED", relative);
    return parseJsonBytes(bytes);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      if (optional) return undefined;
      fail("ASSET_REFERENCE_MISSING", relative);
    }
    if (
      ["EACCES", "EPERM"].includes((error as NodeJS.ErrnoException).code ?? "")
    )
      fail("ASSET_CONFIG_INVALID", relative);
    throw error;
  }
}

export async function runAssetSetup(
  root: string,
  args: readonly string[],
  environment: Readonly<Record<string, string | undefined>>,
  stdout: (line: string) => void = console.log,
  stderr: (line: string) => void = console.error,
): Promise<number> {
  const progress = (phase: string, path: string | null = null) =>
    stderr(JSON.stringify({ operation: "setup", phase, path, bytes: 0 }));
  try {
    const options = parseSetupOptions(args);
    if (options.help) {
      progress(
        "help: assets:setup [--check] [--remote --origin <exact-origin> ...]; read-only; dev download needs no publisher credentials",
        "docs/assets/asset-delivery-setup.md",
      );
    } else {
      if (Number(process.versions.node.split(".")[0]) < 24)
        fail("ASSET_CONFIG_INVALID");
      progress("node-ready");
      const config = parseAssetDeliveryConfig(
        await localJson(root, CONFIG_PATH),
      );
      progress("config-ready", CONFIG_PATH);
      const present = PUBLISHER_ENV_NAMES.filter(
        (name) => (environment[name] ?? "").trim().length > 0,
      );
      progress(
        present.length === 3
          ? "publisher-credentials-present-not-verified"
          : "publisher-credentials-pending",
      );
      progress("dev-download-needs-no-publisher-credentials");
      const approval = await localJson(root, APPROVAL_PATH, true);
      if (approval !== undefined) parsePublicationApproval(approval);
      progress(
        approval === undefined
          ? "publication-approval-pending"
          : "publication-approval-schema-ready-evidence-hashes-unverified",
        APPROVAL_PATH,
      );
      progress(
        "owner-account-standard-bucket-domain-origins-budget-device-attestations-pending",
        "docs/assets/asset-delivery-setup.md",
      );
      progress(
        "existing-content-setup-separate-gameplay-gate",
        "content/setup-evidence.json",
      );
      if (options.remote) {
        if (
          present.length !== 3 ||
          !/^[a-f0-9]{32}$/.test(environment.ASSET_R2_ACCOUNT_ID!)
        )
          fail("ASSET_CONFIG_INVALID");
        const client = new S3Client({
          endpoint: `https://${environment.ASSET_R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
          region: "auto",
          credentials: {
            accessKeyId: environment.ASSET_R2_ACCESS_KEY_ID!,
            secretAccessKey: environment.ASSET_R2_SECRET_ACCESS_KEY!,
          },
          maxAttempts: 1,
          followRegionRedirects: false,
          requestHandler: { connectionTimeout: 10_000, requestTimeout: 15_000 },
        });
        progress("remote-read-probes-started");
        try {
          await probeAssetSetup(config, options.origins, fetch, (command) =>
            client.send(command, { abortSignal: AbortSignal.timeout(15_000) }),
          );
        } finally {
          client.destroy();
        }
        progress(
          "remote-read-probes-ready-owner-origin-completeness-unverified",
        );
      }
    }
    stdout(
      JSON.stringify({
        status: "ok",
        operation: "setup",
        snapshotSha256: null,
      }),
    );
    return 0;
  } catch (error) {
    const failure = failureResult(error);
    stdout(JSON.stringify(failure.result));
    return failure.exitCode;
  }
}
