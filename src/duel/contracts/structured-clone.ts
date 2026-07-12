export function assertStructuredCloneSafe(
  value: unknown,
  label = "value",
): void {
  const seen = new Set<object>();
  visit(value, label, seen);
  structuredClone(value);
}

function visit(value: unknown, path: string, seen: Set<object>): void {
  const kind = typeof value;
  if (kind === "function" || kind === "symbol" || kind === "bigint") {
    throw new TypeError(
      `${path} contains non-clone contract value of type ${kind}`,
    );
  }
  if (value === null || typeof value !== "object") return;

  const object = value;
  if (seen.has(object)) throw new TypeError(`${path} contains a cycle`);
  seen.add(object);
  if (Array.isArray(value)) {
    value.forEach((entry, index) => visit(entry, `${path}[${index}]`, seen));
  } else {
    for (const [key, entry] of Object.entries(value))
      visit(entry, `${path}.${key}`, seen);
  }
  seen.delete(object);
}
