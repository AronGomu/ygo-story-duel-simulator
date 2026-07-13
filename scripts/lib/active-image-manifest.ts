import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

export interface ActiveImageManifestRecord {
  readonly code: number;
  readonly path: string;
  readonly bytes: number;
  readonly sha256: string;
}

export interface ActiveImageManifest {
  readonly schemaVersion: 1;
  readonly snapshotId: string;
  readonly provider: "bundled-archive";
  readonly redistributionApproved: false;
  readonly files: readonly ActiveImageManifestRecord[];
  readonly missing: readonly number[];
}

export function buildActiveImageManifest(
  projectRoot: string,
  snapshotId: string,
): ActiveImageManifest {
  const imageSourceRoot = path.join(
    projectRoot,
    "generated/card-images/archive/full",
  );
  const deckSources = [
    readFileSync(
      path.join(projectRoot, "src/duel/presets/decks/player.ydk"),
      "utf8",
    ),
    readFileSync(
      path.join(projectRoot, "src/duel/presets/decks/opponent.ydk"),
      "utf8",
    ),
  ];
  const codes = [
    ...new Set(
      deckSources.flatMap((source) =>
        source
          .split(/\r?\n/)
          .map((line) => line.trim())
          .filter((line) => /^\d+$/.test(line))
          .map(Number),
      ),
    ),
  ].sort((left, right) => left - right);
  const files: ActiveImageManifestRecord[] = [];
  const missing: number[] = [];
  for (const code of codes) {
    const source = path.join(imageSourceRoot, `${code}.jpg`);
    if (!existsSync(source)) {
      missing.push(code);
      continue;
    }
    const bytes = readFileSync(source);
    files.push({
      code,
      path: `${code}.jpg`,
      bytes: bytes.byteLength,
      sha256: createHash("sha256").update(bytes).digest("hex"),
    });
  }
  return Object.freeze({
    schemaVersion: 1,
    snapshotId,
    provider: "bundled-archive",
    redistributionApproved: false,
    files: Object.freeze(files),
    missing: Object.freeze(missing),
  });
}

export function activeImageManifestSha256(
  manifest: ActiveImageManifest,
): string {
  return createHash("sha256")
    .update(`${JSON.stringify(manifest, null, 2)}\n`)
    .digest("hex");
}
