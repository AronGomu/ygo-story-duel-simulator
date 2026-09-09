import type { AssetFailure, AssetFailureCode } from "./asset-result.ts";

export class AssetDeliveryError extends Error {
  readonly code: AssetFailureCode;
  readonly path: string | null;

  constructor(code: AssetFailureCode, safePath: string | null = null) {
    super(code);
    this.name = "AssetDeliveryError";
    this.code = code;
    this.path = safePath;
  }
}

export function fail(
  code: AssetFailureCode = "ASSET_CONFIG_INVALID",
  safePath: string | null = null,
): never {
  throw new AssetDeliveryError(code, safePath);
}

export function failureResult(error: unknown): {
  readonly result: AssetFailure;
  readonly exitCode: 1 | 2;
} {
  return {
    result: {
      status: "failed",
      code:
        error instanceof AssetDeliveryError
          ? error.code
          : "ASSET_CONFIG_INVALID",
      path: error instanceof AssetDeliveryError ? error.path : null,
    },
    exitCode: error instanceof AssetDeliveryError ? 2 : 1,
  };
}
