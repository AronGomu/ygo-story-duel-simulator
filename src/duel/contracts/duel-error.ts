export type DuelErrorCode =
  | "engine_initialization_failed"
  | "snapshot_validation_failed"
  | "deck_validation_failed"
  | "dependency_resolution_failed"
  | "duel_already_active"
  | "duel_not_active"
  | "invalid_command"
  | "invalid_response"
  | "stale_prompt"
  | "unsupported_message"
  | "process_timeout"
  | "engine_error";

export interface DuelError {
  readonly code: DuelErrorCode;
  readonly message: string;
  readonly detail?: Readonly<Record<string, string | number | boolean | null>>;
  readonly recoverable: boolean;
}

const RECOVERABLE_DUEL_ERROR_CODES: ReadonlySet<DuelErrorCode> = new Set([
  "duel_already_active",
  "duel_not_active",
  "invalid_command",
  "invalid_response",
  "stale_prompt",
]);

export function isRecoverableDuelErrorCode(code: DuelErrorCode): boolean {
  return RECOVERABLE_DUEL_ERROR_CODES.has(code);
}

export class DuelOperationError extends Error {
  readonly duelError: DuelError;

  constructor(duelError: DuelError, cause?: unknown) {
    super(duelError.message, { cause });
    this.name = "DuelOperationError";
    this.duelError = duelError;
  }
}

export function duelOperationError(
  code: DuelErrorCode,
  message: string,
  cause?: unknown,
): DuelOperationError {
  const causeMessage =
    cause === undefined
      ? undefined
      : cause instanceof Error
        ? cause.message
        : String(cause);
  return new DuelOperationError(
    {
      code,
      message,
      ...(causeMessage === undefined
        ? {}
        : { detail: { cause: causeMessage } }),
      recoverable: isRecoverableDuelErrorCode(code),
    },
    cause,
  );
}
