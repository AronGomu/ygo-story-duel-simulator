import { createHash } from "node:crypto";

/** Run-private names do not consume the source/ZIP entry's 512-byte path budget. */
export function frozenSourcePath(run: string, source: string): string {
  return `${run}/frozen/${createHash("sha256").update(source).digest("hex")}`;
}
