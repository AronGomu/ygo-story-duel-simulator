import { ASSET_SOURCES } from "../scripts/lib/asset-roots.ts";
import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { resolveProjectSubpath } from "../scripts/lib/paths.ts";

const projectRoot = path.resolve("project-root");

test("resolveProjectSubpath allows paths inside the approved project directory", () => {
  assert.equal(
    resolveProjectSubpath(
      projectRoot,
      ASSET_SOURCES.data.source,
      path.posix.dirname(ASSET_SOURCES.data.source),
      "output",
    ),
    path.join(projectRoot, ASSET_SOURCES.data.source),
  );
});

test("resolveProjectSubpath rejects traversal and absolute paths", () => {
  assert.throws(
    () =>
      resolveProjectSubpath(
        projectRoot,
        path.posix.dirname(ASSET_SOURCES.data.source),
        path.posix.dirname(ASSET_SOURCES.data.source),
        "output",
      ),
    /must be a child/,
  );
  assert.throws(
    () =>
      resolveProjectSubpath(
        projectRoot,
        "../outside",
        path.posix.dirname(ASSET_SOURCES.data.source),
        "output",
      ),
    /must stay under/,
  );
  assert.throws(
    () =>
      resolveProjectSubpath(
        projectRoot,
        path.resolve("outside"),
        path.posix.dirname(ASSET_SOURCES.data.source),
        "output",
      ),
    /must be relative/,
  );
});
