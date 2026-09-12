import type {
  ContentReadPort,
  ContentResult,
  ManifestRef,
} from "../../content/index.ts";

export interface InstallerChapterSizes {
  readonly download: number;
  readonly installed: number;
  readonly deps: string;
}
/** Display totals include each immutable dependency exactly once. */
export async function readInstallerChapterSizes(
  reader: ContentReadPort,
  root: ManifestRef,
): Promise<ContentResult<InstallerChapterSizes>> {
  const visited = new Set<string>();
  const deps = new Set<string>();
  let download = 0;
  let installed = 0;
  const read = async (ref: ManifestRef): Promise<ContentResult<void>> => {
    if (visited.has(ref.sha256)) return { kind: "ok", value: undefined };
    visited.add(ref.sha256);
    const manifest = await reader.readManifest(ref);
    if (manifest.kind === "failed") return manifest;
    download += manifest.value.value.parts.reduce(
      (n, part) => n + part.bytes,
      0,
    );
    installed += manifest.value.value.files.reduce(
      (n, file) => n + file.bytes,
      0,
    );
    for (const dependency of manifest.value.value.dependencies) {
      deps.add(dependency.packId);
      const result = await read(dependency);
      if (result.kind === "failed") return result;
    }
    return { kind: "ok", value: undefined };
  };
  const result = await read(root);
  return result.kind === "failed"
    ? result
    : {
        kind: "ok",
        value: { download, installed, deps: [...deps].join(", ") },
      };
}
