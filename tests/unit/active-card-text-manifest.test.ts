import path from "node:path";
import { describe, expect, it } from "vitest";
import { buildActiveCardTextManifest } from "../../scripts/lib/active-card-text-manifest.ts";

describe("active browser card text manifest", () => {
  it("packages names and effect text for every requested public card", () => {
    const records = buildActiveCardTextManifest(
      path.resolve("."),
      new Set([97590747, 83764718]),
    );

    expect(records).toEqual([
      expect.objectContaining({
        code: 83764718,
        name: expect.any(String),
        description: expect.any(String),
      }),
      expect.objectContaining({
        code: 97590747,
        name: expect.any(String),
        description: expect.any(String),
      }),
    ]);
    expect(records.every(({ name }) => name.length > 0)).toBe(true);
  });
});
