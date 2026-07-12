import { describe, expect, it, vi } from "vitest";
import type { OcgCoreSync } from "../../vendor/ocgcore-wasm/0.1.2/dist/index.js";
import {
  OcgCoreAdapter,
  type CoreFactory,
} from "../../src/worker/engine/OcgCoreAdapter.ts";

function fakeCore(version: readonly [number, number]): OcgCoreSync {
  return { getVersion: () => version } as OcgCoreSync;
}

describe("OcgCoreAdapter", () => {
  it("initializes only the synchronous factory and validates the version", async () => {
    const factory = vi.fn<CoreFactory>().mockResolvedValue(fakeCore([11, 0]));
    const adapter = await OcgCoreAdapter.initialize({
      wasmBinary: new ArrayBuffer(8),
      factory,
    });

    expect(adapter.getVersion()).toEqual([11, 0]);
    expect(factory).toHaveBeenCalledWith(
      expect.objectContaining({ sync: true }),
    );
  });

  it("reports a bounded structured initialization failure", async () => {
    const factory: CoreFactory = () => new Promise(() => undefined);
    await expect(
      OcgCoreAdapter.initialize({
        wasmBinary: new ArrayBuffer(8),
        timeoutMs: 5,
        factory,
      }),
    ).rejects.toMatchObject({
      duelError: { code: "engine_initialization_failed" },
    });
  });
});
