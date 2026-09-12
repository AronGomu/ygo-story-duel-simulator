import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { loadConfigFromFile } from "vite";

test("development server ignores agent scratch files", async () => {
  const loaded = await loadConfigFromFile(
    { command: "serve", mode: "development" },
    path.resolve("vite.config.ts"),
  );

  assert.ok(loaded);
  assert.deepEqual(loaded.config.server?.watch?.ignored, ["**/.tmp/**"]);
});
