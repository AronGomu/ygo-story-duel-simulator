declare const brand: unique symbol;

export type Branded<T, Name extends string> = T & { readonly [brand]: Name };

export type DuelId = Branded<string, "DuelId">;
export type PromptId = Branded<string, "PromptId">;
export type ChoiceId = Branded<string, "ChoiceId">;
export type CardCode = Branded<number, "CardCode">;
export type CardInstanceId = Branded<string, "CardInstanceId">;
export type SnapshotId = Branded<string, "SnapshotId">;

export function duelId(value: string): DuelId {
  return requireNonEmpty(value, "duel ID") as DuelId;
}

export function promptId(value: string): PromptId {
  return requireNonEmpty(value, "prompt ID") as PromptId;
}

export function choiceId(value: string): ChoiceId {
  return requireNonEmpty(value, "choice ID") as ChoiceId;
}

export function cardCode(value: number): CardCode {
  if (!Number.isSafeInteger(value) || value <= 0)
    throw new Error(`Invalid card code: ${value}`);
  return value as CardCode;
}

export function cardInstanceId(value: string): CardInstanceId {
  return requireNonEmpty(value, "card instance ID") as CardInstanceId;
}

export function snapshotId(value: string): SnapshotId {
  return requireNonEmpty(value, "snapshot ID") as SnapshotId;
}

function requireNonEmpty(value: string, label: string): string {
  if (value.trim().length === 0)
    throw new Error(`Invalid ${label}: value is empty`);
  return value;
}
