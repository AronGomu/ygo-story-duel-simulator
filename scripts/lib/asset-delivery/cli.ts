import type { AssetSuccess } from "./asset-result.ts";
import { failureResult, fail } from "./failure.ts";

export type Progress = (
  phase: string,
  path?: string | null,
  bytes?: number,
) => void;
export function parseFlags(
  args: readonly string[],
  booleans: readonly string[],
  values: readonly string[] = [],
): Map<string, string | true> {
  const result = new Map<string, string | true>();
  for (let i = 0; i < args.length; i++) {
    const flag = args[i]!;
    if (result.has(flag)) fail("ASSET_ARGUMENT_INVALID");
    if (booleans.includes(flag)) result.set(flag, true);
    else if (values.includes(flag)) {
      const value = args[++i];
      if (!value || value.startsWith("--")) fail("ASSET_ARGUMENT_INVALID");
      result.set(flag, value);
    } else fail("ASSET_ARGUMENT_INVALID");
  }
  return result;
}
export async function assetCli(
  operation: AssetSuccess["operation"],
  action: (progress: Progress) => Promise<void | string>,
  stdout = console.log,
  stderr = console.error,
): Promise<number> {
  try {
    const snapshotSha256 = await action((phase, path = null, bytes = 0) =>
      stderr(JSON.stringify({ operation, phase, path, bytes })),
    );
    stdout(
      JSON.stringify({
        status: "ok",
        operation,
        snapshotSha256: snapshotSha256 ?? null,
      }),
    );
    return 0;
  } catch (error) {
    const code =
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      typeof error.code === "string"
        ? error.code
        : undefined;
    const expected =
      code === "ENOSPC"
        ? "ASSET_DISK_FULL"
        : ["EACCES", "EPERM", "EROFS"].includes(code ?? "")
          ? "ASSET_LOCAL_CONFLICT"
          : null;
    if (expected) {
      stdout(JSON.stringify({ status: "failed", code: expected, path: null }));
      return 2;
    }
    const failure = failureResult(error);
    stdout(JSON.stringify(failure.result));
    return failure.exitCode;
  }
}
