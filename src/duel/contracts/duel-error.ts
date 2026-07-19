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
  | "engine_error"
  | "worker_error"
  | "worker_message_error"
  | "worker_disposal_timeout"
  | "worker_unexpected_exit"
  | "invalid_worker_event";

export type RecoverableDuelErrorCode =
  | "duel_already_active"
  | "duel_not_active"
  | "invalid_command"
  | "invalid_response"
  | "stale_prompt";

interface DuelErrorBase {
  readonly message: string;
  readonly detail?: Readonly<Record<string, string | number | boolean | null>>;
}

export type NonRecoverableDuelErrorCode = Exclude<
  DuelErrorCode,
  RecoverableDuelErrorCode
>;

export type DuelError =
  | (DuelErrorBase & {
      readonly code: RecoverableDuelErrorCode;
      readonly recoverable: true;
    })
  | (DuelErrorBase & {
      readonly code: NonRecoverableDuelErrorCode;
      readonly recoverable: false;
    });

const DUEL_ERROR_CODES: ReadonlySet<DuelErrorCode> = new Set([
  "engine_initialization_failed",
  "snapshot_validation_failed",
  "deck_validation_failed",
  "dependency_resolution_failed",
  "duel_already_active",
  "duel_not_active",
  "invalid_command",
  "invalid_response",
  "stale_prompt",
  "unsupported_message",
  "process_timeout",
  "engine_error",
  "worker_error",
  "worker_message_error",
  "worker_disposal_timeout",
  "worker_unexpected_exit",
  "invalid_worker_event",
]);

const RECOVERABLE_DUEL_ERROR_CODES: ReadonlySet<RecoverableDuelErrorCode> =
  new Set([
    "duel_already_active",
    "duel_not_active",
    "invalid_command",
    "invalid_response",
    "stale_prompt",
  ]);

export function isDuelErrorCode(value: unknown): value is DuelErrorCode {
  return (
    typeof value === "string" && DUEL_ERROR_CODES.has(value as DuelErrorCode)
  );
}

export function isRecoverableDuelErrorCode(code: DuelErrorCode): boolean {
  return RECOVERABLE_DUEL_ERROR_CODES.has(code as RecoverableDuelErrorCode);
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
  const detail =
    causeMessage === undefined ? {} : { detail: { cause: causeMessage } };
  const duelError = isRecoverableDuelErrorCode(code)
    ? ({ code, message, ...detail, recoverable: true } as DuelError)
    : ({ code, message, ...detail, recoverable: false } as DuelError);
  return new DuelOperationError(duelError, cause);
}
