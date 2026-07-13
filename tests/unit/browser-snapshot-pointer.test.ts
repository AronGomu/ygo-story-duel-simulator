// @vitest-environment node

import "fake-indexeddb/auto";
import { afterEach, describe, expect, it } from "vitest";
import { deleteDB } from "idb";
import { snapshotId } from "../../src/duel/contracts/ids.ts";
import { SnapshotStore } from "../../src/storage/snapshot-store.ts";
import { readCachedSnapshotFallbacks } from "../../src/worker/assets/browser-snapshot-pointer.ts";

const databaseName = "browser-snapshot-pointer-test";

afterEach(async () => deleteDB(databaseName));

async function activate(
  character: string,
  expected: string | null,
): Promise<void> {
  const store = await SnapshotStore.open(databaseName);
  const id = snapshotId(character.repeat(64));
  const digest = (character === "a" ? "c" : "d").repeat(64);
  await store.stageSnapshot({
    snapshotId: id,
    revisions: {
      runtimeSnapshotId: character.repeat(64),
      runtimeManifestSha256: digest,
      assetManifestSha256: "e".repeat(64),
      engineManifestSha256: "f".repeat(64),
      babelCdb: "babel",
      cardScripts: "scripts",
      distribution: "distribution",
      imageProvider: `bundled-archive:${"e".repeat(64)}`,
    },
    requiredArtifacts: [
      { id: "runtime-package", sha256: digest },
      { id: "active-images", sha256: "e".repeat(64) },
    ],
  });
  await store.verifyStagedSnapshot(id, [
    { id: "runtime-package", sha256: digest },
    { id: "active-images", sha256: "e".repeat(64) },
  ]);
  const status = await store.status();
  await store.activateSnapshot(
    id,
    expected === null ? null : snapshotId(expected.repeat(64)),
    status.generation,
  );
  store.close();
}

describe("browser snapshot fallback pointer", () => {
  it("selects the active known-good snapshot, or the previous one when active is current", async () => {
    await activate("a", null);
    await activate("b", "a");

    await expect(
      readCachedSnapshotFallbacks("c".repeat(64), databaseName),
    ).resolves.toEqual([
      {
        snapshotId: "b".repeat(64),
        runtimeManifestSha256: "d".repeat(64),
        activeImageManifestSha256: "e".repeat(64),
      },
      {
        snapshotId: "a".repeat(64),
        runtimeManifestSha256: "c".repeat(64),
        activeImageManifestSha256: "e".repeat(64),
      },
    ]);
    await expect(
      readCachedSnapshotFallbacks("b".repeat(64), databaseName),
    ).resolves.toEqual([
      {
        snapshotId: "a".repeat(64),
        runtimeManifestSha256: "c".repeat(64),
        activeImageManifestSha256: "e".repeat(64),
      },
    ]);
  });
});
