import { readFile, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const markerText = "owned-by-core-source-only-harness\n";

export default async function teardownCoreSourceOnly(): Promise<void> {
  for (const id of ["root", "subpath"] as const) {
    const scratch = path.join(projectRoot, ".tmp", `core-source-only-${id}`);
    const marker = path.join(scratch, ".core-source-only-owner");
    try {
      if ((await readFile(marker, "utf8")) !== markerText)
        throw new Error(`Refusing to remove unowned scratch path: ${scratch}`);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") continue;
      throw error;
    }
    await rm(scratch, { recursive: true, force: false });
  }
}
