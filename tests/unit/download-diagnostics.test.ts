import { describe, expect, it } from "vitest";
import { buildDownloadableDiagnostics } from "../../src/app/diagnostics/download-diagnostics.ts";
import type { DuelDiagnosticTrace } from "../../src/duel/contracts/duel-diagnostics.ts";
import {
  choiceId,
  promptId,
  snapshotId,
} from "../../src/duel/contracts/ids.ts";

const imageCache = {
  provider: "bundled-archive",
  snapshotId: snapshotId("a".repeat(64)),
  verified: true,
  cacheHits: 2,
  cacheMisses: 1,
  missing: 0,
  invalid: 0,
} as const;

const trace: DuelDiagnosticTrace = {
  schemaVersion: 1,
  sensitivity: "contains-production-seed",
  presetId: "mvp-preset-v1",
  snapshotId: snapshotId("a".repeat(64)),
  seed: ["1", "2", "3", "4"],
  coreVersion: [11, 0],
  revisions: {
    enginePackage: "ocgcore-wasm",
    engineVersion: "0.1.2",
    babelCdb: "babel",
    cardScripts: "scripts",
    distribution: "strings",
    activeImageManifestSha256: "b".repeat(64),
  },
  entries: [
    { sequence: 1, kind: "message", messageType: 15 },
    {
      sequence: 2,
      kind: "prompt",
      promptId: promptId("prompt-1"),
      player: 0,
    },
    {
      sequence: 3,
      kind: "response",
      promptId: promptId("prompt-1"),
      choiceIds: [choiceId("choice-1")],
      player: 0,
    },
  ],
  lastMessageType: 15,
};

describe("downloadable duel diagnostics", () => {
  it("adds deterministic application/browser metadata and marks seed sensitivity", () => {
    expect(
      buildDownloadableDiagnostics(trace, {
        buildId: "0.1.0+fixture",
        userAgent: "Fixture Browser",
        language: "en-US",
        imageCache,
        now: () => new Date("2026-07-13T00:00:00.000Z"),
      }),
    ).toEqual({
      schemaVersion: 1,
      sensitivity: "contains-production-seed",
      generatedAt: "2026-07-13T00:00:00.000Z",
      application: {
        buildId: "0.1.0+fixture",
        userAgent: "Fixture Browser",
        language: "en-US",
        activeSnapshotId: null,
        fallbackSnapshotId: null,
        imageCache,
      },
      trace,
    });
  });

  it("contains only bounded public trace fields, not card identities or raw payloads", () => {
    const serialized = JSON.stringify(
      buildDownloadableDiagnostics(trace, {
        buildId: "fixture",
        userAgent: "fixture",
        language: "en",
        imageCache,
      }),
    );
    expect(serialized).not.toMatch(/cardCode|rawBytes|wasmBinary|deckOrder/);
    expect(trace.entries).toHaveLength(3);
  });
});
