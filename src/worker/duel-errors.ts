import {
  DuelOperationError,
  type DuelError,
} from "../duel/contracts/duel-error.ts";

export function toDuelError(
  error: unknown,
  options: { readonly terminal?: boolean } = {},
): DuelError {
  const duelError =
    error instanceof DuelOperationError
      ? error.duelError
      : fallbackEngineError(error);
  if (options.terminal !== true || !duelError.recoverable) return duelError;
  return {
    ...duelError,
    code: "engine_error",
    recoverable: false,
  };
}

function fallbackEngineError(error: unknown): DuelError {
  const message = error instanceof Error ? error.message : String(error);
  const code = "engine_error" as const;
  return {
    code,
    message,
    detail: { cause: message },
    recoverable: false,
  };
}
