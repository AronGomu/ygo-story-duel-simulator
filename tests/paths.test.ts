import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { resolveProjectSubpath } from "../scripts/lib/paths.ts";

const projectRoot = path.resolve("project-root");

test("resolveProjectSubpath allows paths inside the approved project directory", () => {
  assert.equal(
    resolveProjectSubpath(projectRoot, "generated/assets/current", "generated/assets", "output"),
    path.join(projectRoot, "generated", "assets", "current"),
  );
});

test("resolveProjectSubpath rejects traversal and absolute paths", () => {
  assert.throws(
    () => resolveProjectSubpath(projectRoot, "generated/assets", "generated/assets", "output"),
    /must be a child/,
  );
  assert.throws(
    () => resolveProjectSubpath(projectRoot, "../outside", "generated/assets", "output"),
    /must stay under/,
  );
  assert.throws(
    () => resolveProjectSubpath(projectRoot, path.resolve("outside"), "generated/assets", "output"),
    /must be relative/,
  );
});
