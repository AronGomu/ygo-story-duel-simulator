import { describe, expect, it } from "vitest";
import { loadVendoredCoreNode } from "../../src/worker/engine/load-vendored-core-node.ts";

describe("vendored synchronous ocgcore", () => {
  it("loads the real local WASM and exposes the pinned core version", async () => {
    const adapter = await loadVendoredCoreNode({ timeoutMs: 15_000 });
    expect(adapter.getVersion()).toEqual([11, 0]);
  });
});
