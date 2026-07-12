export function assertNever(
  value: never,
  context = "Unexpected discriminated union member",
): never {
  throw new Error(`${context}: ${JSON.stringify(value)}`);
}
