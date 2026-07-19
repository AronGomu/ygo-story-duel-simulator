import {
  DuelOperationError,
  type NonRecoverableDuelErrorCode,
} from "../duel/contracts/duel-error.ts";

export async function runDuelRuntimeInitializationStage<T>(
  code: NonRecoverableDuelErrorCode,
  message: string,
  operation: () => Promise<T>,
): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    throw new DuelOperationError(
      {
        code,
        message,
        recoverable: false,
      },
      error,
    );
  }
}
