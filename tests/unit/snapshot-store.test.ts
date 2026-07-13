// @vitest-environment node

import "fake-indexeddb/auto";
import { afterEach, describe, expect, it } from "vitest";
import { deleteDB } from "idb";
import { snapshotId } from "../../src/duel/contracts/ids.ts";
import {
  SnapshotStorageError,
  SnapshotStore,
  type StagedSnapshotInput,
} from "../../src/storage/snapshot-store.ts";

const databaseNames: string[] = [];

afterEach(async () => {
  await Promise.all(databaseNames.splice(0).map((name) => deleteDB(name)));
});

function input(character: string): StagedSnapshotInput {
  return {
    snapshotId: snapshotId(character.repeat(64)),
    revisions: {
      runtimeSnapshotId: character.repeat(64),
      runtimeManifestSha256: character.repeat(64),
      assetManifestSha256: `${character}-assets`,
      engineManifestSha256: `${character}-engine`,
      babelCdb: `${character}-babel`,
      cardScripts: `${character}-scripts`,
      distribution: `${character}-distribution`,
      imageProvider: `bundled-archive:${character.repeat(64)}`,
    },
    requiredArtifacts: [
      { id: "runtime-package", sha256: character.repeat(64) },
      { id: "active-images", sha256: character.repeat(64) },
    ],
  };
}

async function store(name: string): Promise<SnapshotStore> {
  databaseNames.push(name);
  let tick = 0;
  return SnapshotStore.open(
    name,
    () => new Date(Date.UTC(2026, 6, 13, 0, 0, tick++)),
  );
}

describe("SnapshotStore", () => {
  it("stages, verifies, atomically activates, retains one fallback, and rolls back", async () => {
    const value = await store("snapshot-activation");
    await stageVerifyActivate(value, input("a"), null);
    expect(await value.status()).toEqual({
      activeSnapshotId: "a".repeat(64),
      fallbackSnapshotId: null,
      generation: 1,
    });

    await stageVerifyActivate(value, input("b"), snapshotId("a".repeat(64)));
    await stageVerifyActivate(value, input("c"), snapshotId("b".repeat(64)));
    expect(await value.status()).toEqual({
      activeSnapshotId: "c".repeat(64),
      fallbackSnapshotId: "b".repeat(64),
      generation: 3,
    });
    expect(
      await value.activateSnapshot(
        snapshotId("c".repeat(64)),
        snapshotId("c".repeat(64)),
        3,
      ),
    ).toEqual({
      activeSnapshotId: "c".repeat(64),
      fallbackSnapshotId: "b".repeat(64),
      generation: 3,
    });
    expect(await value.rollback(snapshotId("c".repeat(64)), 3)).toEqual({
      activeSnapshotId: "b".repeat(64),
      fallbackSnapshotId: "c".repeat(64),
      generation: 4,
    });
    await expect(value.rollback(snapshotId("c".repeat(64)), 3)).rejects.toThrow(
      "superseded",
    );
    value.close();
  });

  it("keeps an interrupted or incompletely verified staging record inactive", async () => {
    const name = "snapshot-interruption";
    const first = await store(name);
    const candidate = input("d");
    await first.stageSnapshot(candidate);
    expect(await first.status()).toEqual({
      activeSnapshotId: null,
      fallbackSnapshotId: null,
      generation: 0,
    });
    first.close();

    const reopened = await SnapshotStore.open(name);
    await expect(
      reopened.activateSnapshot(candidate.snapshotId, null, 0),
    ).rejects.toThrow("complete verification");
    await expect(
      reopened.verifyStagedSnapshot(candidate.snapshotId, [
        { id: "manifest", sha256: "d".repeat(64) },
      ]),
    ).rejects.toThrow("complete artifact verification");
    await reopened.verifyStagedSnapshot(
      candidate.snapshotId,
      candidate.requiredArtifacts,
    );
    expect(
      await reopened.activateSnapshot(candidate.snapshotId, null, 0),
    ).toMatchObject({
      activeSnapshotId: candidate.snapshotId,
    });
    reopened.close();
  });

  it("discards interrupted staging without deleting active snapshots", async () => {
    const value = await store("snapshot-discard-staging");
    await stageVerifyActivate(value, input("a"), null);
    await value.stageSnapshot(input("b"));

    await expect(
      value.discardStagedSnapshot(snapshotId("b".repeat(64))),
    ).resolves.toBe(true);
    await expect(
      value.discardStagedSnapshot(snapshotId("b".repeat(64))),
    ).resolves.toBe(false);
    await expect(
      value.discardStagedSnapshot(snapshotId("a".repeat(64))),
    ).resolves.toBe(false);
    expect(await value.status()).toEqual({
      activeSnapshotId: "a".repeat(64),
      fallbackSnapshotId: null,
      generation: 1,
    });
    value.close();
  });

  it("allows an image-only revision to use a new activation ID for the same runtime", async () => {
    const value = await store("snapshot-image-only-revision");
    const first = input("a");
    await stageVerifyActivate(value, first, null);
    const secondBase = input("b");
    const second: StagedSnapshotInput = {
      ...secondBase,
      revisions: {
        ...secondBase.revisions,
        runtimeSnapshotId: first.revisions.runtimeSnapshotId,
        runtimeManifestSha256: first.revisions.runtimeManifestSha256,
      },
      requiredArtifacts: [
        {
          id: "runtime-package",
          sha256: first.revisions.runtimeManifestSha256,
        },
        { id: "active-images", sha256: "b".repeat(64) },
      ],
    };

    await stageVerifyActivate(value, second, first.snapshotId);
    expect(await value.status()).toEqual({
      activeSnapshotId: second.snapshotId,
      fallbackSnapshotId: first.snapshotId,
      generation: 2,
    });
    expect(await value.retainedRevisionCacheNames()).toEqual(
      expect.arrayContaining([
        `ygo-card-images-v1-${first.revisions.runtimeSnapshotId}-${"a".repeat(64)}`,
        `ygo-card-images-v1-${first.revisions.runtimeSnapshotId}-${"b".repeat(64)}`,
      ]),
    );
    value.close();
  });

  it("rejects a stale cross-tab generation even after an ABA-shaped pointer change", async () => {
    const name = "snapshot-generation-cas";
    const first = await store(name);
    const second = await SnapshotStore.open(name);
    await stageVerifyActivate(first, input("a"), null);
    const stale = await second.status();
    await stageVerifyActivate(first, input("b"), input("a").snapshotId);
    await second.stageSnapshot(input("c"));
    await second.verifyStagedSnapshot(
      input("c").snapshotId,
      input("c").requiredArtifacts,
    );

    await expect(
      second.activateSnapshot(
        input("c").snapshotId,
        stale.activeSnapshotId,
        stale.generation,
      ),
    ).rejects.toThrow("superseded");
    second.close();
    first.close();
  });

  it("rejects mixed revisions for the same immutable snapshot ID", async () => {
    const value = await store("snapshot-mixed-revisions");
    const candidate = input("e");
    await value.stageSnapshot(candidate);
    await expect(
      value.stageSnapshot({
        ...candidate,
        revisions: { ...candidate.revisions, cardScripts: "different" },
      }),
    ).rejects.toThrow("conflicts with an existing revision set");
    value.close();
  });

  it("cleans abandoned staging and bounds debug-run metadata", async () => {
    const value = await store("snapshot-cleanup");
    await value.stageSnapshot(input("f"));
    expect(
      await value.cleanupAbandonedStaging(new Date("2026-07-14T00:00:00.000Z")),
    ).toBe(1);
    await value.setPreference("reduced-motion", true);
    expect(await value.getPreference("reduced-motion")).toBe(true);
    for (let index = 0; index < 25; index += 1) {
      await value.recordDebugRun({
        id: `run-${String(index).padStart(2, "0")}`,
        snapshotId: snapshotId("a".repeat(64)),
        createdAt: new Date(Date.UTC(2026, 6, 13, 0, 0, index)).toISOString(),
        resultType: "completed",
        traceEntries: index,
      });
    }
    value.close();
  });

  it("surfaces closed/quota-like write failures as typed storage errors", async () => {
    const value = await store("snapshot-write-failure");
    value.close();
    await expect(value.stageSnapshot(input("9"))).rejects.toBeInstanceOf(
      SnapshotStorageError,
    );
  });
});

async function stageVerifyActivate(
  store: SnapshotStore,
  candidate: StagedSnapshotInput,
  expectedActive: ReturnType<typeof snapshotId> | null,
): Promise<void> {
  await store.stageSnapshot(candidate);
  await store.verifyStagedSnapshot(
    candidate.snapshotId,
    candidate.requiredArtifacts,
  );
  const status = await store.status();
  expect(status.activeSnapshotId).toBe(expectedActive);
  await store.activateSnapshot(
    candidate.snapshotId,
    expectedActive,
    status.generation,
  );
}
