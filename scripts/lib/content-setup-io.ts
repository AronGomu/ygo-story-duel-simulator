import { open } from "node:fs/promises";
import path from "node:path";
import { MAX_SETUP_BYTES } from "./content-setup.ts";

/** Read at most cap + 1 bytes even if a file grows after stat. No input text enters diagnostics. */
export async function readBounded(
  root: string,
  relative: string,
  cap: number,
): Promise<Buffer | null> {
  try {
    const handle = await open(path.join(root, relative), "r");
    try {
      const metadata = await handle.stat();
      if (!metadata.isFile() || metadata.size > cap) return null;
      const bytes = Buffer.alloc(Math.min(metadata.size + 1, cap + 1));
      let offset = 0;
      while (offset < bytes.length) {
        const result = await handle.read(
          bytes,
          offset,
          bytes.length - offset,
          offset,
        );
        if (result.bytesRead === 0) break;
        offset += result.bytesRead;
      }
      return offset > cap || offset !== metadata.size
        ? null
        : bytes.subarray(0, offset);
    } finally {
      await handle.close();
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}
export async function json(
  root: string,
  relative: string,
  cap = MAX_SETUP_BYTES,
): Promise<unknown> {
  const bytes = await readBounded(root, relative, cap);
  if (bytes === null) return null;
  try {
    return JSON.parse(
      new TextDecoder("utf-8", { fatal: true }).decode(bytes),
    ) as unknown;
  } catch (error) {
    if (error instanceof SyntaxError || error instanceof TypeError) return null;
    throw error;
  }
}
export function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
