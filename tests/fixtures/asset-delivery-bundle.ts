import { createHash } from "node:crypto";
import { cp, mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { after } from "node:test";
import { canonicalBytes } from "../../scripts/lib/asset-delivery/canonical-json.ts";

export const sha = (bytes: Uint8Array) =>
  createHash("sha256").update(bytes).digest("hex");
const fixtureBase = path.resolve(".tmp/ship-t3-20260909/fixtures");
const ownedFixtures: string[] = [];
after(async () => {
  const { rm } = await import("node:fs/promises");
  for (const root of ownedFixtures) await rm(root, { recursive: true });
});
export async function put(
  root: string,
  file: string,
  value: string | Uint8Array,
) {
  await mkdir(path.dirname(path.join(root, file)), { recursive: true });
  await writeFile(path.join(root, file), value);
}
export async function fixture(reverse = false) {
  await mkdir(fixtureBase, { recursive: true });
  const root = await mkdtemp(path.join(fixtureBase, "bundle-"));
  ownedFixtures.push(root);
  await put(root, "package.json", '{"version":"0.1.0"}');
  const profiles = [
    {
      id: "core",
      dependsOn: [],
      rules: [
        { root: "shared", path: "fonts", kind: "tree", logicalPath: "fonts" },
      ],
    },
    {
      id: "runtime",
      dependsOn: [],
      rules: [
        {
          root: "shared",
          path: "runtime",
          kind: "tree",
          logicalPath: "runtime/current",
        },
      ],
    },
    {
      id: "chapter-01",
      dependsOn: ["runtime"],
      rules: [
        {
          root: "story",
          path: "map.png",
          kind: "file",
          logicalPath: "story/media/map.png",
        },
        {
          root: "story",
          path: "missing.jpg",
          kind: "file",
          logicalPath: "story/media/missing.jpg",
        },
      ],
    },
  ];
  for (const profile of profiles)
    await put(
      root,
      `asset-profiles/${profile.id}.json`,
      canonicalBytes({ schemaVersion: 1, ...profile }),
    );
  await put(
    root,
    "asset-profiles/nightly.json",
    canonicalBytes({
      schemaVersion: 1,
      profiles: ["core", "runtime", "chapter-01"],
    }),
  );
  const files: [string, string][] = [
    ["assets/shared/fonts/test.woff2", "font"],
    [
      "assets/shared/runtime/manifest.json",
      '{"schemaVersion":1,"snapshotId":"' + "a".repeat(64) + '"}',
    ],
    ["assets/story/map.png", "deliberately-not-decodable-image"],
    ["assets/battle/original.blend", "original"],
    ["assets/deck-editor/unused.kra", "unreleased"],
  ];
  for (const [file, bytes] of reverse ? files.reverse() : files)
    await put(root, file, bytes);
  await cp(
    "vendor/ocgcore-wasm/0.1.2",
    path.join(root, "vendor/ocgcore-wasm/0.1.2"),
    { recursive: true },
  );
  return root;
}
export const prepared = {
  schemaVersion: 1 as const,
  sourceInputs: [],
  runtimeSnapshotId: "a".repeat(64),
  runtimeCardCodes: [1, 2],
  chapters: [
    {
      id: "chapter-01" as const,
      title: "DM",
      storyContentId: "prototype-prologue-v1" as const,
      setIds: ["duplicate-membership-set", "original-set"],
      cardCodes: [1],
      opponentIds: ["practice-bot"],
    },
  ],
};
export async function current(root: string) {
  return JSON.parse(
    await readFile(
      path.join(root, "generated/asset-delivery/current.json"),
      "utf8",
    ),
  ) as {
    run: string;
    snapshot: { key: string; sha256: string; bytes: number };
  };
}
