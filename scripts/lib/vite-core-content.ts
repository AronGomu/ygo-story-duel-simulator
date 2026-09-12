import { createHash } from "node:crypto";
import { cp, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { Plugin, ResolvedConfig, ViteDevServer } from "vite";
import {
  parseCoreBootstrap,
  type CoreBootstrap,
} from "../../src/content/index.ts";
import { verifyBundle } from "./asset-delivery/verify-bundle.ts";
import type { ObjectRef } from "./asset-delivery/object-ref.ts";
import { assertSafeParents } from "./asset-delivery/path-guards.ts";

const CONTENT_RUN = /^generated\/asset-delivery\/runs\/[a-f0-9-]{36}$/;
const CONTENT_OBJECT =
  /^content\/(indexes|catalogs|manifests|parts)\/([a-f0-9]{64})\.(json|zip)$/;
const PRIVATE_MARKER =
  "This CORE artifact has no public-distribution approval. Keep it private.\n";

export interface CoreDelivery {
  readonly bootstrap: CoreBootstrap;
  readonly bootstrapBytes: Uint8Array;
  readonly contentRun: string | null;
  readonly objects: ReadonlyMap<string, ObjectRef>;
}

function jsonBytes(value: unknown): Uint8Array {
  return new TextEncoder().encode(`${JSON.stringify(value, null, 2)}\n`);
}

export async function prepareCoreDelivery(
  projectRoot: string,
  contentRun: string | undefined,
): Promise<CoreDelivery> {
  try {
    const source = await readFile(
      path.join(projectRoot, "content/core-bootstrap.json"),
    );
    if (source.byteLength > 1048576)
      throw new Error("CONTENT_INVALID_MANIFEST");
    const tracked = parseCoreBootstrap(
      JSON.parse(source.toString("utf8")) as unknown,
      "https://core.invalid/",
    );
    if (contentRun === undefined || contentRun === "") {
      return {
        bootstrap: tracked,
        bootstrapBytes: source,
        contentRun: null,
        objects: new Map(),
      };
    }
    if (!CONTENT_RUN.test(contentRun))
      throw new Error("CONTENT_INVALID_MANIFEST");
    const snapshot = await verifyBundle(projectRoot, contentRun);
    if (snapshot.prod === null) throw new Error("CONTENT_INVALID_MANIFEST");
    const raw: CoreBootstrap = {
      ...tracked,
      delivery: {
        baseUrl: "./",
        index: {
          sha256: snapshot.prod.index.sha256,
          bytes: snapshot.prod.index.bytes,
        },
      },
    };
    parseCoreBootstrap(raw, "https://core.invalid/");
    return {
      bootstrap: raw,
      bootstrapBytes: jsonBytes(raw),
      contentRun,
      objects: new Map(
        snapshot.objects
          .filter((ref) => CONTENT_OBJECT.test(ref.key))
          .map((ref) => [ref.key, ref]),
      ),
    };
  } catch {
    throw new Error("CONTENT_INVALID_MANIFEST");
  }
}

async function verifiedObject(
  projectRoot: string,
  delivery: CoreDelivery,
  ref: ObjectRef,
): Promise<Uint8Array> {
  if (delivery.contentRun === null) throw new Error("CONTENT_INVALID_MANIFEST");
  const relative = `${delivery.contentRun}/objects/${ref.key}`;
  const file = await assertSafeParents(projectRoot, relative);
  const bytes = await readFile(file);
  const digest = createHash("sha256").update(bytes).digest("hex");
  if (bytes.byteLength !== ref.bytes || digest !== ref.sha256)
    throw new Error("CONTENT_INVALID_MANIFEST");
  return bytes;
}

function normalizedBase(base: string): string {
  const leading = base.startsWith("/") ? base : `/${base}`;
  return leading.endsWith("/") ? leading : `${leading}/`;
}

function requestPath(requestUrl: string, base: string): string | null {
  if (/%|\\|\?|#/.test(requestUrl)) return null;
  const pathname = new URL(requestUrl, "http://vite.local").pathname;
  const prefix = normalizedBase(base);
  return pathname.startsWith(prefix) ? pathname.slice(prefix.length) : null;
}

function installCoreMiddleware(
  server: ViteDevServer,
  projectRoot: string,
  delivery: CoreDelivery,
): void {
  server.middlewares.use((request, response, next) => {
    if (request.url === undefined) return next();
    const relative = requestPath(request.url, server.config.base);
    const isBootstrap = relative === "core-bootstrap.json";
    const ref = relative === null ? undefined : delivery.objects.get(relative);
    if (!isBootstrap && ref === undefined) return next();
    if (request.method !== "GET" && request.method !== "HEAD") {
      response.statusCode = 405;
      response.setHeader("Allow", "GET, HEAD");
      response.end("Method not allowed");
      return;
    }
    void (
      isBootstrap
        ? Promise.resolve(delivery.bootstrapBytes)
        : verifiedObject(projectRoot, delivery, ref!)
    ).then(
      (bytes) => {
        response.statusCode = 200;
        response.setHeader(
          "Content-Type",
          isBootstrap || ref?.key.endsWith(".json")
            ? "application/json; charset=utf-8"
            : "application/zip",
        );
        response.setHeader(
          "Cache-Control",
          isBootstrap ? "no-store" : "public, max-age=31536000, immutable",
        );
        response.end(request.method === "HEAD" ? undefined : bytes);
      },
      () => {
        response.statusCode = 500;
        response.end("CONTENT_INVALID_MANIFEST");
      },
    );
  });
}

async function copyLicenses(projectRoot: string, outputRoot: string) {
  const licenses = [
    ["node_modules/svelte/LICENSE.md", "svelte-MIT.txt"],
    ["node_modules/idb/LICENSE", "idb-ISC.txt"],
    ["vendor/ocgcore-wasm/0.1.2/LICENSE", "ocgcore-wasm-MIT.txt"],
  ] as const;
  await Promise.all(
    licenses.map(async ([source, target]) => {
      const destination = path.join(outputRoot, "licenses", target);
      await mkdir(path.dirname(destination), { recursive: true });
      await cp(path.join(projectRoot, source), destination);
    }),
  );
}

export function coreContentPlugin(
  projectRoot: string,
  delivery: CoreDelivery,
): Plugin {
  let config: ResolvedConfig | undefined;
  return {
    name: "ygo-core-content",
    configResolved(resolved) {
      config = resolved;
      if (resolved.command === "build" && resolved.mode !== "private")
        throw new Error(
          "Public deployment is not approved; use the explicit private build mode",
        );
    },
    configureServer(server) {
      installCoreMiddleware(server, projectRoot, delivery);
    },
    async writeBundle() {
      if (config?.command !== "build") return;
      const outputRoot = path.resolve(config.root, config.build.outDir);
      await Promise.all([
        writeFile(
          path.join(outputRoot, "core-bootstrap.json"),
          delivery.bootstrapBytes,
        ),
        writeFile(
          path.join(outputRoot, "PRIVATE_DEPLOYMENT_ONLY.txt"),
          PRIVATE_MARKER,
        ),
        copyLicenses(projectRoot, outputRoot),
      ]);
      for (const ref of delivery.objects.values()) {
        const destination = path.join(outputRoot, ref.key);
        await mkdir(path.dirname(destination), { recursive: true });
        await writeFile(
          destination,
          await verifiedObject(projectRoot, delivery, ref),
        );
      }
    },
  };
}
