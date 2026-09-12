import "fake-indexeddb/auto";
import { afterEach, describe, expect, it } from "vitest";
import {
  openContentDatabase,
  commitInstall,
  EMPTY_CONTENT,
} from "../../src/content/storage/content-database.ts";
import { deleteDB } from "idb";
import { contentInstallFixture } from "../fixtures/content-install-fixture.ts";
import type { PersistedDownloadJob } from "../../src/content/index.ts";

export async function installJob(): Promise<PersistedDownloadJob> {
  const { content } = await contentInstallFixture();
  return {
    jobId: crypto.randomUUID(),
    target: { kind: "chapter", chapterId: "chapter-01" },
    expectedGeneration: 0,
    content,
    verifiedParts: [],
    failure: null,
    progress: {
      jobId: "test",
      packId: "chapter-01",
      phase: "activating",
      verifiedDownloadBytes: 1,
      totalDownloadBytes: 1,
      currentPartReceivedBytes: 1,
      currentPartTotalBytes: 1,
    },
  };
}
afterEach(() => deleteDB("ygo-story-content"));
describe("content storage state machine (browser atomicity proven separately)", () => {
  it("commits whole closure and job in one generation CAS", async () => {
    const db = await openContentDatabase();
    try {
      const job = await installJob();
      const receipt = {
        manifest: job.content!.runtime,
        verifiedAt: Date.now(),
        fileKeys: ["verified"],
      };
      const current = await commitInstall(db, job, [receipt]);
      expect(current).toEqual({
        generation: 1,
        current: job.content,
        previous: null,
      });
      expect(await db.get("receipts", receipt.manifest.sha256)).toEqual(
        receipt,
      );
      expect((await db.get("jobs", job.jobId))?.progress.phase).toBe(
        "complete",
      );
      await expect(commitInstall(db, job, [])).rejects.toMatchObject({
        code: "CONTENT_ACTIVATION_CONFLICT",
      });
      expect(await db.get("active", "current")).toEqual(current);
    } finally {
      db.close();
    }
  });
  it("does not alter prior current on a failed candidate", async () => {
    const db = await openContentDatabase();
    try {
      await db.put("active", EMPTY_CONTENT, "current");
      await expect(
        commitInstall(db, { ...(await installJob()), content: null }, []),
      ).rejects.toMatchObject({ code: "CONTENT_INTEGRITY_FAILED" });
      expect(await db.get("active", "current")).toEqual(EMPTY_CONTENT);
      expect(await db.count("receipts")).toBe(0);
    } finally {
      db.close();
    }
  });
});
