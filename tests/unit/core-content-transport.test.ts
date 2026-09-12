import { readFile, rm } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import type { ViteDevServer } from "vite";
import { bundleAssets } from "../../scripts/lib/asset-delivery/bundle.ts";
import { EMPTY_RETAINED_METADATA } from "../../scripts/lib/asset-delivery/scan-assets.ts";
import {
  coreContentPlugin,
  prepareCoreDelivery,
} from "../../scripts/lib/vite-core-content.ts";
import { fixture, prepared, put } from "../fixtures/asset-delivery-bundle.ts";

interface ResponseResult {
  readonly status: number;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: unknown;
  readonly next: boolean;
}

type Middleware = (
  request: { readonly url?: string; readonly method?: string },
  response: {
    statusCode: number;
    setHeader(name: string, value: string): void;
    end(body?: unknown): void;
  },
  next: () => void,
) => void;

async function request(
  middleware: Middleware,
  url: string,
  method: string,
): Promise<ResponseResult> {
  return new Promise((resolve) => {
    const headers: Record<string, string> = {};
    const response = {
      statusCode: 0,
      setHeader(name: string, value: string) {
        headers[name] = value;
      },
      end(body?: unknown) {
        resolve({ status: response.statusCode, headers, body, next: false });
      },
    };
    middleware({ url, method }, response, () =>
      resolve({ status: 0, headers, body: null, next: true }),
    );
  });
}

describe("CORE content transport", () => {
  it("serves only verified GET/HEAD objects and pins the produced index", async () => {
    const root = await fixture();
    try {
      await put(
        root,
        "content/core-bootstrap.json",
        await readFile("content/core-bootstrap.json"),
      );
      const snapshot = await bundleAssets(
        root,
        "prod",
        { kind: "nightly" },
        EMPTY_RETAINED_METADATA,
        prepared,
      );
      const run = JSON.parse(
        await readFile(`${root}/generated/asset-delivery/current.json`, "utf8"),
      ).run as string;
      const delivery = await prepareCoreDelivery(root, run);
      expect(delivery.bootstrap.delivery?.index).toEqual({
        sha256: snapshot.prod?.index.sha256,
        bytes: snapshot.prod?.index.bytes,
      });
      const handlers: Middleware[] = [];
      const plugin = coreContentPlugin(root, delivery);
      const configure = plugin.configureServer;
      if (typeof configure !== "function") throw new Error("missing hook");
      const configureServer = configure as (server: ViteDevServer) => void;
      configureServer({
        config: { base: "/private/" },
        middlewares: { use: (handler: Middleware) => handlers.push(handler) },
      } as unknown as ViteDevServer);
      const middleware = handlers[0]!;
      const key = [...delivery.objects.keys()][0]!;
      const get = await request(middleware, `/private/${key}`, "GET");
      expect(get.status).toBe(200);
      expect(get.headers["Cache-Control"]).toContain("immutable");
      expect(get.body).toBeInstanceOf(Uint8Array);
      const head = await request(
        middleware,
        "/private/core-bootstrap.json",
        "HEAD",
      );
      expect(head.status).toBe(200);
      expect(head.body).toBeUndefined();
      expect(
        await request(middleware, `/private/${key}`, "POST"),
      ).toMatchObject({ status: 405, body: "Method not allowed" });
      expect(
        await request(middleware, `/private/%2e%2e/${key}`, "GET"),
      ).toMatchObject({ next: true });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
