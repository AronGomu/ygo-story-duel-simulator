import assert from "node:assert/strict";
import test from "node:test";
import { buildAssetStages, parseMvpAssetOptions } from "../scripts/lib/mvp-assets.ts";

test("MVP asset command runs every online acquisition and verification stage in order", () => {
  const stages = buildAssetStages(parseMvpAssetOptions([]));
  assert.deepEqual(
    stages.map((stage) => stage.name),
    [
      "syncDuelEngine",
      "verifyDuelEngine",
      "syncDataScriptsAndStrings",
      "verifyDataScriptsAndStrings",
      "downloadCardImages",
      "verifyCardImages",
      "generateRuntimeSnapshot",
      "verifyRuntimeSnapshot",
    ],
  );
});

test("offline MVP asset command performs no network image stage", () => {
  const stages = buildAssetStages(parseMvpAssetOptions(["--offline"]));
  assert.equal(stages[0]?.name, "syncDuelEngine");
  assert.deepEqual(stages[0]?.args, ["--offline"]);
  assert.deepEqual(stages[2]?.args, ["--offline"]);
  assert.equal(stages.some((stage) => stage.name === "downloadCardImages"), false);
  assert.equal(stages.at(-1)?.name, "verifyRuntimeSnapshot");
});

test("MVP asset options enforce the provider request ceiling", () => {
  assert.throws(
    () => parseMvpAssetOptions(["--requests-per-second", "21"]),
    /cannot exceed 20/,
  );
  assert.throws(
    () => parseMvpAssetOptions(["--offline", "--force-images"]),
    /cannot be used together/,
  );
});
