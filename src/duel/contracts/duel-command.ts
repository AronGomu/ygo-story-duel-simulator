import { DuelOperationError } from "./duel-error.ts";
import {
  choiceId,
  duelId,
  promptId,
  type ChoiceId,
  type DuelId,
  type PromptId,
} from "./ids.ts";

const MAX_ID_LENGTH = 512;
const MAX_RESPONSE_CHOICES = 256;

export type DuelCommand =
  | { readonly type: "initialize" }
  | { readonly type: "startDuel"; readonly duelId: DuelId }
  | {
      readonly type: "respond";
      readonly promptId: PromptId;
      readonly choiceIds: readonly ChoiceId[];
    }
  | { readonly type: "surrender" }
  | { readonly type: "requestDiagnostics" }
  | { readonly type: "dispose" };

export class DuelCommandValidationError extends DuelOperationError {
  constructor(message: string) {
    super({ code: "invalid_command", message, recoverable: true });
    this.name = "DuelCommandValidationError";
  }
}

export function parseDuelCommand(value: unknown): DuelCommand {
  const command = requireRecord(value);
  const commandType = command.type;
  if (typeof commandType !== "string" || commandType.length > 32) {
    throw new DuelCommandValidationError("Unsupported duel command");
  }
  switch (commandType) {
    case "initialize":
    case "surrender":
    case "requestDiagnostics":
    case "dispose":
      requireOnlyKeys(command, ["type"]);
      return { type: commandType };
    case "startDuel":
      requireOnlyKeys(command, ["type", "duelId"]);
      return {
        type: "startDuel",
        duelId: duelId(requireId(command.duelId, "duelId")),
      };
    case "respond": {
      requireOnlyKeys(command, ["type", "promptId", "choiceIds"]);
      if (!Array.isArray(command.choiceIds)) {
        throw new DuelCommandValidationError(
          "Duel respond command choiceIds must be an array",
        );
      }
      if (command.choiceIds.length > MAX_RESPONSE_CHOICES) {
        throw new DuelCommandValidationError(
          `Duel respond command accepts at most ${MAX_RESPONSE_CHOICES} choice IDs`,
        );
      }
      for (let index = 0; index < command.choiceIds.length; index += 1) {
        if (!(index in command.choiceIds)) {
          throw new DuelCommandValidationError(
            "Duel respond command choiceIds must be a dense array",
          );
        }
      }
      return {
        type: "respond",
        promptId: promptId(requireId(command.promptId, "promptId")),
        choiceIds: command.choiceIds.map((id) =>
          choiceId(requireId(id, "choiceId")),
        ),
      };
    }
    default:
      throw new DuelCommandValidationError("Unsupported duel command");
  }
}

function requireRecord(value: unknown): Readonly<Record<string, unknown>> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new DuelCommandValidationError("Duel command must be an object");
  }
  return value as Readonly<Record<string, unknown>>;
}

function requireId(value: unknown, label: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new DuelCommandValidationError(
      `Duel command ${label} must be a non-empty string`,
    );
  }
  if (value.length > MAX_ID_LENGTH) {
    throw new DuelCommandValidationError(
      `Duel command ${label} exceeds ${MAX_ID_LENGTH} characters`,
    );
  }
  return value;
}

function requireOnlyKeys(
  command: Readonly<Record<string, unknown>>,
  allowedKeys: readonly string[],
): void {
  let ownKeyCount = 0;
  for (const key in command) {
    if (!Object.hasOwn(command, key)) continue;
    ownKeyCount += 1;
    if (ownKeyCount > allowedKeys.length || !allowedKeys.includes(key)) {
      throw new DuelCommandValidationError(
        "Duel command contains an unexpected field",
      );
    }
  }
}
