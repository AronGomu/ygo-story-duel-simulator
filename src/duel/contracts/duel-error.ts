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
