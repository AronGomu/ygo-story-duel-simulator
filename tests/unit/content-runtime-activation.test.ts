import "fake-indexeddb/auto";
import { afterEach, describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { FROZEN_VENDOR_MANIFEST_SHA256 } from "../../src/battle/storage/frozen-vendor-pin.ts";
import { deleteDB, openDB } from "idb";
import { contentInstallFixture } from "../fixtures/content-install-fixture.ts";
import type { InstalledRuntimeReceipt } from "../../src/content/index.ts";
import {
  parseInstalledRuntimeReceipt,
  readInstalledRuntimeReceipt,
  writeInstalledRuntimeReceipt,
} from "../../src/battle/storage/installed-runtime-receipt.ts";
import { createRuntimeActivationPort } from "../../src/battle/content-activation.ts";
import { SnapshotStore } from "../../src/battle/storage/snapshot-store.ts";

afterEach(() => deleteDB("ygo-story-duel"));
async function receiptFixture(): Promise<InstalledRuntimeReceipt> {
  const f = await contentInstallFixture();
  return {
    schemaVersion: 1,
    kind: "installed-runtime-v1",
    snapshot: f.content.snapshot,
    runtimePack: f.runtime.ref,
    runtimeManifestFile: {
      path: "runtime/current/manifest.json",
      bytes: 10,
      sha256: f.content.snapshot.runtimeManifestSha256,
    },
    assetManifestFile: {
      path: "runtime/assets/current/manifest.json",
      bytes: 10,
      sha256: "a".repeat(64),
    },
    engineManifestFile: {
      path: "runtime/engine/vendor-manifest.json",
      bytes: 10,
      sha256: "b".repeat(64),
    },
    verifiedAt: Date.now(),
  };
}
describe("T4 installed runtime receipt", () => {
  it("compiled pin equals untouched frozen vendor bytes", async () => {
    expect(
      createHash("sha256")
        .update(
          await readFile("vendor/ocgcore-wasm/0.1.2/vendor-manifest.json"),
        )
        .digest("hex"),
    ).toBe(FROZEN_VENDOR_MANIFEST_SHA256);
  });
  it("Worker reader accepts exact tagged prepared receipt", async () => {
    const receipt = await receiptFixture();
    expect((await writeInstalledRuntimeReceipt(receipt)).kind).toBe("ok");
    expect(
      await readInstalledRuntimeReceipt(receipt.snapshot, receipt.runtimePack),
    ).toEqual({ kind: "ok", value: receipt });
  });
  it("missing receipt never creates missing Battle DB", async () => {
    const receipt = await receiptFixture();
    expect(
      await readInstalledRuntimeReceipt(receipt.snapshot, receipt.runtimePack),
    ).toMatchObject({ code: "CONTENT_MISSING" });
    expect(
      (await indexedDB.databases()).some((db) => db.name === "ygo-story-duel"),
    ).toBe(false);
  });
  it("legacy image receipt, unsafe paths, wrong activation and wrong runtime reject", async () => {
    const receipt = await receiptFixture();
    for (const invalid of [
      { ...receipt, kind: "active-images" },
      {
        ...receipt,
        snapshot: { ...receipt.snapshot, activationId: "0".repeat(64) },
      },
      {
        ...receipt,
        runtimeManifestFile: {
          ...receipt.runtimeManifestFile,
          path: "../manifest.json",
        },
      },
      { ...receipt, verifiedAt: 0.5 },
      { ...receipt, runtimePack: { ...receipt.runtimePack, bytes: 1 } },
    ]) {
      expect(
        await parseInstalledRuntimeReceipt(
          invalid,
          receipt.snapshot,
          receipt.runtimePack,
        ),
      ).toMatchObject({ code: "CONTENT_INTEGRITY_FAILED" });
    }
  });
  it("v3 upgrade adds only receipt store, preserving legacy records", async () => {
    const old = await openDB("ygo-story-duel", 2, {
      upgrade(db) {
        db.createObjectStore("snapshots", { keyPath: "snapshotId" });
        db.createObjectStore("pointers", { keyPath: "name" });
        db.createObjectStore("preferences", { keyPath: "key" });
        db.createObjectStore("debugRuns", { keyPath: "id" });
      },
    });
    const legacy = { snapshotId: "legacy", arbitrary: "preserved" };
    await old.put("snapshots", legacy);
    old.close();
    const store = await SnapshotStore.open();
    store.close();
    const db = await openDB("ygo-story-duel");
    try {
      expect(db.version).toBe(3);
      expect([...db.objectStoreNames].sort()).toEqual([
        "debugRuns",
        "installedRuntimeReceipts",
        "pointers",
        "preferences",
        "snapshots",
      ]);
      expect(await db.get("snapshots", "legacy")).toEqual(legacy);
    } finally {
      db.close();
    }
  });
  it("activation public sub-entry constructs no Worker", () => {
    expect(createRuntimeActivationPort()).toHaveProperty("prepare");
    expect(globalThis.Worker).toBeUndefined();
  });
});
