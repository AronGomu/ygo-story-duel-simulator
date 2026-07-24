import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

const prototypeRoot = path.resolve("src/prototype");
const forbiddenDomains = new Set(["app", "duel", "field", "storage", "worker"]);

describe("prototype source boundary", () => {
  it("exists under its isolated entry and imports no production domains", async () => {
    await expect(stat("prototype.html")).resolves.toBeDefined();
    await expect(
      stat(path.join(prototypeRoot, "main.ts")),
    ).resolves.toBeDefined();
    expect(path.normalize("src/prototype/main.ts")).not.toBe(
      path.normalize("src/main.ts"),
    );

    const files = await findSourceFiles(prototypeRoot);
    expect(files.length).toBeGreaterThan(0);
    for (const file of files) {
      const source = await readFile(file, "utf8");
      const imports = source.matchAll(
        /(?:from\s+|import\s*)["']([^"']+)["']|import\s*\(\s*["']([^"']+)["']\s*\)/g,
      );
      for (const match of imports) {
        const specifier = match[1] ?? match[2]!;
        if (!specifier.startsWith(".")) continue;
        const resolved = path.resolve(path.dirname(file), specifier);
        const [rootDomain] = path
          .relative(path.resolve("src"), resolved)
          .split(path.sep);
        expect(
          rootDomain !== "prototype" && forbiddenDomains.has(rootDomain!),
          `${path.relative(prototypeRoot, file)} imports production domain ${specifier}`,
        ).toBe(false);
      }
    }
  });
});

async function findSourceFiles(root: string): Promise<string[]> {
  const entries = await readdir(root, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map((entry) => {
      const file = path.join(root, entry.name);
      return entry.isDirectory()
        ? findSourceFiles(file)
        : /\.(?:ts|svelte)$/.test(entry.name)
          ? [file]
          : [];
    }),
  );
  return nested.flat();
}
