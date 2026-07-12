import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { acquireRunLock, writeJsonAtomic } from "../scripts/lib/run-lock.ts";

test("asset run lock prevents overlapping processes and can be reacquired", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "ygo-assets-lock-"));
  try {
    const lock = path.join(root, "asset.lock");
    const release = await acquireRunLock(lock);
    await assert.rejects(() => acquireRunLock(lock), /Another asset process is running/);
    await release();
    const releaseAgain = await acquireRunLock(lock);
    await releaseAgain();
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("asset run lock safely reclaims a dead owner's lock", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "ygo-assets-stale-lock-"));
  try {
    const lock = path.join(root, "asset.lock");
    await writeFile(
      lock,
      JSON.stringify({ pid: 2_147_483_647, token: "stale", startedAt: "2020-01-01T00:00:00Z" }),
    );
    const release = await acquireRunLock(lock);
    await release();
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("atomic JSON writer publishes complete status documents", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "ygo-assets-status-"));
  try {
    const output = path.join(root, "status.json");
    await writeJsonAtomic(output, { status: "ready", cards: 14_794 });
    assert.deepEqual(JSON.parse(await readFile(output, "utf8")), {
      status: "ready",
      cards: 14_794,
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
