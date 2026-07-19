import { describe, expect, it } from "vitest";
import { vendoredMessageTypes } from "../../src/worker/engine/OcgCoreAdapter.ts";
import {
  classifyEngineMessage,
  INTERNAL_MESSAGE_RATIONALE,
  PINNED_MESSAGE_CLASSIFICATION,
  PINNED_MESSAGE_TYPES,
} from "../../src/worker/protocol/message-classification.ts";

describe("pinned protocol compatibility inventory", () => {
  it("classifies every message exported by the vendored adapter exactly once", () => {
    const vendored = [...new Set(vendoredMessageTypes())].sort(
      (left, right) => left - right,
    );
    const classified = [...PINNED_MESSAGE_TYPES].sort(
      (left, right) => left - right,
    );
    expect(classified).toEqual(vendored);
    for (const type of vendored) {
      expect(["prompt", "event", "internal"]).toContain(
        classifyEngineMessage(type),
      );
    }
  });

  it("documents why every internal message needs no presentation", () => {
    const internalTypes = Object.entries(PINNED_MESSAGE_CLASSIFICATION)
      .filter(([, classification]) => classification === "internal")
      .map(([type]) => Number(type));
    expect(Object.keys(INTERNAL_MESSAGE_RATIONALE).map(Number).sort()).toEqual(
      internalTypes.sort(),
    );
    expect(
      Object.values(INTERNAL_MESSAGE_RATIONALE).every(
        (rationale) => rationale.length > 40,
      ),
    ).toBe(true);
  });

  it("rejects unknown future message constants instead of guessing", () => {
    expect(() => classifyEngineMessage(999)).toThrow(/Unclassified/);
    expect(Object.keys(PINNED_MESSAGE_CLASSIFICATION)).not.toContain("999");
  });
});
