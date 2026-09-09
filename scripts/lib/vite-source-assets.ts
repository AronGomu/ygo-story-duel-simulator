import { createReadStream } from "node:fs";
import { cp, mkdir } from "node:fs/promises";
import path from "node:path";
import type { Plugin, ResolvedConfig } from "vite";
import { ASSET_SOURCES } from "./asset-roots.ts";
import { parseAssetProfile } from "./asset-delivery/asset-profile.ts";
import { assertSafeParents } from "./asset-delivery/path-guards.ts";
import { readSourceJson, sourceFiles } from "./asset-delivery/source-files.ts";

/** Only declared core font files and the existing imported SVG may be served from sources. */
export function sourceAssetsPlugin(projectRoot: string): Plugin {
  let config: ResolvedConfig;
  const fonts = new Map<string, string>();
  const mapSource = `${ASSET_SOURCES.story.source}/city-map-placeholder.svg`;
  return {
    name: "ygo-declared-source-assets",
    transform(source, id) {
      if (!id.split("?")[0]?.endsWith(".css")) return null;
      return {
        code: source.replace(
          /url\(["']?\/(fonts\/[^)"']+)["']?\)/g,
          (original, logical: string) =>
            fonts.has(logical) ? `url("${config.base}${logical}")` : original,
        ),
        map: null,
      };
    },
    async configResolved(resolved) {
      config = resolved;
      const profile = parseAssetProfile(
        await readSourceJson(projectRoot, "asset-profiles/core.json"),
      );
      for (const rule of profile.rules) {
        if (
          rule.root !== "shared" ||
          !(rule.path === "fonts" || rule.path.startsWith("fonts/")) ||
          !(
            rule.logicalPath === "fonts" ||
            rule.logicalPath.startsWith("fonts/")
          )
        )
          continue;
        const source = `assets/${rule.root}/${rule.path}`;
        if (rule.kind === "file") fonts.set(rule.logicalPath, source);
        else
          for (const file of await sourceFiles(projectRoot, source))
            fonts.set(
              `${rule.logicalPath}/${file.slice(source.length + 1)}`,
              file,
            );
      }
    },
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        let pathname: string;
        try {
          pathname = path.posix.normalize(
            decodeURIComponent(
              new URL(request.url ?? "/", "http://vite.local").pathname,
            ),
          );
        } catch {
          response.statusCode = 400;
          response.end("Invalid asset URL");
          return;
        }
        const base = server.config.base;
        const relative = pathname.startsWith(base)
          ? pathname.slice(base.length)
          : pathname.slice(1);
        const requestedFsPath = relative.slice(4);
        const fsPath = relative.startsWith("@fs/")
          ? path
              .relative(
                projectRoot,
                path.isAbsolute(requestedFsPath)
                  ? requestedFsPath
                  : path.resolve(path.parse(projectRoot).root, requestedFsPath),
              )
              .replaceAll("\\", "/")
          : relative;
        if (
          (/^assets\/(battle|deck-editor|story|shared)(?:\/|$)/i.test(fsPath) &&
            fsPath !== mapSource) ||
          Object.values(ASSET_SOURCES).some(
            ({ legacy }) =>
              fsPath.toLowerCase() === legacy.toLowerCase() ||
              fsPath.toLowerCase().startsWith(`${legacy.toLowerCase()}/`),
          )
        ) {
          response.statusCode = 404;
          response.end("Asset source not served");
          return;
        }
        if (fsPath === mapSource) {
          void assertSafeParents(projectRoot, mapSource)
            .then(() => next())
            .catch(() => {
              response.statusCode = 404;
              response.end("Asset not found");
            });
          return;
        }
        if (!relative.startsWith("fonts/")) {
          next();
          return;
        }
        const source = fonts.get(relative);
        if (!source) {
          response.statusCode = 404;
          response.end("Asset not found");
          return;
        }
        void assertSafeParents(projectRoot, source)
          .then((file) => {
            const stream = createReadStream(file);
            stream.on("error", () => {
              response.statusCode = 404;
              response.end("Asset not found");
            });
            response.setHeader("Content-Type", "font/woff2");
            stream.pipe(response);
          })
          .catch(() => {
            response.statusCode = 404;
            response.end("Asset not found");
          });
      });
    },
    async closeBundle() {
      if (config.command !== "build") return;
      for (const [logical, source] of fonts) {
        const target = path.join(config.root, config.build.outDir, logical);
        await mkdir(path.dirname(target), { recursive: true });
        await cp(await assertSafeParents(projectRoot, source), target);
      }
    },
  };
}
