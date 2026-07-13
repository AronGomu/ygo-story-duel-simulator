import { createHash } from "node:crypto";
import { readdir, readFile, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "vite";

const projectRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const outputs = ["dist-repro-a", "dist-repro-b"] as const;

try {
  for (const output of outputs) {
    await rm(path.join(projectRoot, output), { recursive: true, force: true });
    await build({
      root: projectRoot,
      mode: "private",
      logLevel: "warn",
      build: { outDir: output, emptyOutDir: true },
    });
  }
  const trees = await Promise.all(
    outputs.map((output) => hashTree(path.join(projectRoot, output))),
  );
  const first = trees[0]!;
  const second = trees[1]!;
  if (JSON.stringify(first) !== JSON.stringify(second))
    throw new Error("Two clean production builds produced different artifacts");
  console.log(
    JSON.stringify({ status: "ok", files: Object.keys(first).length }, null, 2),
  );
} finally {
  await Promise.all(
    outputs.map((output) =>
      rm(path.join(projectRoot, output), { recursive: true, force: true }),
    ),
  );
}

async function hashTree(root: string): Promise<Record<string, string>> {
  const files = await findFiles(root);
  const entries = await Promise.all(
    files.map(
      async (file) =>
        [
          path.relative(root, file).replaceAll("\\", "/"),
          createHash("sha256")
            .update(await readFile(file))
            .digest("hex"),
        ] as const,
    ),
  );
  return Object.fromEntries(
    entries.sort(([left], [right]) => left.localeCompare(right)),
  );
}

async function findFiles(root: string): Promise<string[]> {
  const entries = await readdir(root, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map((entry) => {
      const location = path.join(root, entry.name);
      return entry.isDirectory() ? findFiles(location) : [location];
    }),
  );
  return nested.flat().sort();
}
