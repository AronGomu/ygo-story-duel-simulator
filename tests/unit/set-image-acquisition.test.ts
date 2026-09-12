import { readFile } from "node:fs/promises";
import { describe, expect, it, vi } from "vitest";
import {
  assertSelectedNullImageIds,
  fetchBoundedSetIndex,
  fetchSetImageBytes,
} from "../../scripts/lib/set-image-acquisition.ts";

const jpeg = new Uint8Array([0xff, 0xd8, 1, 2, 0xff, 0xd9]);

describe("set image acquisition", () => {
  it("rejects live selected null IDs that differ from pinned evidence", () => {
    const sources = [
      { setId: "set-a", sourceUrl: null },
      {
        setId: "set-b",
        sourceUrl: "https://images.ygoprodeck.com/images/sets/B.jpg",
      },
    ];
    expect(() =>
      assertSelectedNullImageIds(
        sources,
        new Set(["set-a", "set-b"]),
        new Set(["set-a"]),
      ),
    ).not.toThrow();
    expect(() =>
      assertSelectedNullImageIds(
        sources,
        new Set(["set-a", "set-b"]),
        new Set(["set-b"]),
      ),
    ).toThrow("Selected null-image sets differ from pinned evidence");
  });

  it("keeps downloader free of a local JPEG cache path", async () => {
    const source = await readFile("scripts/download-set-images.ts", "utf8");
    expect(source).not.toContain("readFile");
    expect(source).toContain("fetchSetImageBytes(source.sourceUrl)");
  });

  it("fetches selected JPEG bytes without any local-cache input", async () => {
    const fetcher = vi.fn().mockResolvedValue(
      new Response(jpeg, {
        status: 200,
        headers: { "content-type": "image/jpeg" },
      }),
    );
    await expect(
      fetchSetImageBytes(
        "https://images.ygoprodeck.com/images/sets/ONE.jpg",
        fetcher,
        async () => {},
      ),
    ).resolves.toEqual(jpeg);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("rejects invalid set_image types at the provider boundary", async () => {
    const fetcher = vi.fn().mockImplementation(async () =>
      Promise.resolve(
        new Response(JSON.stringify([{ set_name: "One", set_image: 7 }]), {
          status: 200,
        }),
      ),
    );
    await expect(fetchBoundedSetIndex(fetcher, async () => {})).rejects.toThrow(
      "Set index response contains an invalid record",
    );
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("retries the bounded provider index once", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(new Response(null, { status: 503 }))
      .mockResolvedValueOnce(
        new Response(JSON.stringify([{ set_name: "One", set_image: null }]), {
          status: 200,
        }),
      );
    await expect(
      fetchBoundedSetIndex(fetcher, async () => {}),
    ).resolves.toEqual([{ set_name: "One", set_image: null }]);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("rejects an oversized provider index after one retry", async () => {
    const fetcher = vi
      .fn()
      .mockImplementation(async () =>
        Promise.resolve(
          new Response("x".repeat(1024 * 1024 + 1), { status: 200 }),
        ),
      );
    await expect(fetchBoundedSetIndex(fetcher, async () => {})).rejects.toThrow(
      "Set index exceeds 1048576 bytes",
    );
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
});
