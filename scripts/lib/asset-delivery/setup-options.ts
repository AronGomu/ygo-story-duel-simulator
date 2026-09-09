import { fail } from "./failure.ts";

export function parseSetupOrigin(value: unknown): string {
  if (typeof value !== "string" || value.length > 512)
    fail("ASSET_ARGUMENT_INVALID");
  let url: URL;
  try {
    url = new URL(value);
  } catch (error) {
    if (error instanceof TypeError) fail("ASSET_ARGUMENT_INVALID");
    throw error;
  }
  if (
    (value !== url.origin && value !== `${url.origin}/`) ||
    url.username ||
    url.password ||
    value.includes("*") ||
    !(
      url.protocol === "https:" ||
      (url.protocol === "http:" &&
        ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname))
    )
  )
    fail("ASSET_ARGUMENT_INVALID");
  return url.origin;
}

export function parseSetupOptions(args: readonly string[]): {
  readonly help: boolean;
  readonly remote: boolean;
  readonly origins: readonly string[];
} {
  const flags = new Set<string>();
  const origins: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;
    if (arg === "--origin") origins.push(parseSetupOrigin(args[++i]));
    else {
      if (!["--help", "--check", "--remote"].includes(arg) || flags.has(arg))
        fail("ASSET_ARGUMENT_INVALID");
      flags.add(arg);
    }
  }
  const remote = flags.has("--remote");
  const help = flags.has("--help");
  if (
    (help && args.length !== 1) ||
    (remote ? !origins.length : origins.length > 0) ||
    origins.length > 10 ||
    new Set(origins).size !== origins.length
  )
    fail("ASSET_ARGUMENT_INVALID");
  return { help, remote, origins };
}
