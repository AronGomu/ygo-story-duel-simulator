import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

const storyRoot = path.resolve("src/story");

/* What the visual novel may reach for outside itself, mirroring the rule
   `tests/unit/domain-boundaries.test.ts` enforces across every domain: the
   shared deck-data library, the one type-only battle module that names a duel
   result, and the shell's public entry. Everything else the app ships — the
   duel's `app/`, `duel/`, `field/`, `worker/` and `storage/` internals under
   `src/battle/`, the shell's internals, the deck editor — is a boundary break,
   because the story is loaded as its own lazy chunk and a value import would
   drag that chunk in with it.

   T29, deliberate widening of one target: `src/shell/index.ts` is the shared
   card preview panel's home (ADR-036), and the collection screen renders it
   rather than growing a third inspector. It costs the story chunk nothing —
   the shell entry is the eager chunk every route has already loaded before the
   visual novel mounts — which is the same reason the duel's zone in
   `eslint.config.js` stopped excluding the whole shell when the panel moved
   there. Both machine checks already allow it: the story zone in
   `eslint.config.js` re-includes the shell entry, and `isLegalImport` in
   `tests/unit/domain-boundaries.test.ts` resolves it to the shell's public
   entry. This file was the one list still holding the pre-ADR-036 shape.

   T24, the same widening for the same reason: `src/deck-select/index.ts` is
   the shared deck-selection screen, which the pre-battle briefing renders
   rather than growing a second deck picker of its own. It is presentational
   and reads no other domain, so the story chunk pays for a screen and nothing
   behind it — and both machine checks already allow it, the story zone in
   `eslint.config.js` re-including the entry and `isLegalImport` resolving it
   to deck-select's public entry. */
function reachableFromStory(target: string): boolean {
  return (
    target === "src/battle/battle-contracts.ts" ||
    target === "src/shell/index.ts" ||
    target === "src/deck-select/index.ts" ||
    // T2 source relocation preserves the existing static SVG import, not a code API.
    target === "assets/story/city-map-placeholder.svg" ||
    target.startsWith("src/decks/")
  );
}

describe("story source boundary", () => {
  /* The visual novel used to ship as its own HTML document. It now lives
     inside the single app, so the guarantee flips: the second entry point
     must be gone, not present. */
  it("has no entry document or mount script of its own", async () => {
    await expect(stat("prototype.html")).rejects.toThrow();
    await expect(stat(path.join(storyRoot, "main.ts"))).rejects.toThrow();
    await expect(stat(path.join(storyRoot, "index.ts"))).resolves.toBeDefined();
  });

  it("keeps no reviewer harness", async () => {
    await expect(stat(path.join(storyRoot, "review"))).rejects.toThrow();
    await expect(
      stat(path.join(storyRoot, "components/VisualDirectionBoards.svelte")),
    ).rejects.toThrow();
    for (const file of await findSourceFiles(storyRoot)) {
      const source = await readFile(file, "utf8");
      expect(
        /ReviewDrawer|ReviewLauncher|review-presets|review-link/.test(source),
        `${path.relative(storyRoot, file)} still references reviewer tooling`,
      ).toBe(false);
    }
  });

  it("reaches outside itself only for deck data and the duel result contract", async () => {
    const files = await findSourceFiles(storyRoot);
    expect(files.length).toBeGreaterThan(0);
    for (const file of files) {
      const source = await readFile(file, "utf8");
      const imports = source.matchAll(
        /(?:from\s+|import\s*)["']([^"']+)["']|import\s*\(\s*["']([^"']+)["']\s*\)/g,
      );
      for (const match of imports) {
        const specifier = match[1] ?? match[2]!;
        if (!specifier.startsWith(".")) continue;
        const target = path
          .relative(
            path.resolve("."),
            path.resolve(path.dirname(file), specifier),
          )
          .split(path.sep)
          .join("/");
        if (target.startsWith("src/story/")) continue;
        expect(
          reachableFromStory(target),
          `${path.relative(storyRoot, file)} imports ${target} from outside the visual novel`,
        ).toBe(true);
      }
    }
  });

  it("sizes story surfaces from their shell container, not viewport units", async () => {
    const files = await findLayoutSourceFiles(storyRoot);
    expect(files.length).toBeGreaterThan(0);
    for (const file of files) {
      const source = await readFile(file, "utf8");
      const viewportUnits =
        source.match(/\b\d*\.?\d+(?:s|d|l)?v[hw]\b/gi) ?? [];
      expect(
        viewportUnits,
        `${path.relative(storyRoot, file)} contains viewport units: ${viewportUnits.join(", ")}`,
      ).toEqual([]);
    }
  });
});

async function findSourceFiles(root: string): Promise<string[]> {
  return findFiles(root, /\.(?:ts|svelte)$/);
}

async function findLayoutSourceFiles(root: string): Promise<string[]> {
  return findFiles(root, /\.(?:css|svelte|ts)$/);
}

async function findFiles(root: string, extension: RegExp): Promise<string[]> {
  const entries = await readdir(root, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map((entry) => {
      const file = path.join(root, entry.name);
      return entry.isDirectory()
        ? findFiles(file, extension)
        : extension.test(entry.name)
          ? [file]
          : [];
    }),
  );
  return nested.flat();
}
