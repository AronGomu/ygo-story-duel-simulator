import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  symlink,
  unlink,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { canonicalBytes } from "../scripts/lib/asset-delivery/canonical-json.ts";
import { acquireAssetDeliveryLock } from "../scripts/lib/asset-delivery/local-lock.ts";
import {
  scanAssets,
  checkAssetProfiles,
} from "../scripts/lib/asset-delivery/scan-assets.ts";
import {
  previewMigration,
  applyMigration,
} from "../scripts/lib/asset-delivery/migrate.ts";
import { promoteAssets } from "../scripts/lib/asset-delivery/promote.ts";
import { mappedLogicalPath } from "../scripts/lib/asset-delivery/source-mapping.ts";
import type {
  AssetProfile,
  AssetRule,
} from "../scripts/lib/asset-delivery/asset-profile.ts";

const repo = fileURLToPath(new URL("../", import.meta.url));
const selection = {
  schemaVersion: 1 as const,
  profiles: ["core", "runtime", "chapter-01"] as const,
};
const history = { schemaVersion: 1 as const, catalogs: [], manifests: [] };
const digest = (bytes: string | Uint8Array) =>
  createHash("sha256").update(bytes).digest("hex");
async function put(root: string, file: string, bytes: string | Uint8Array) {
  await mkdir(path.dirname(path.join(root, file)), { recursive: true });
  await writeFile(path.join(root, file), bytes);
}
async function profile(
  root: string,
  id: AssetProfile["id"],
  rules: readonly AssetRule[] = [],
  dependsOn: AssetProfile["dependsOn"] = id === "chapter-01" ? ["runtime"] : [],
) {
  await put(
    root,
    `asset-profiles/${id}.json`,
    canonicalBytes({ schemaVersion: 1, id, dependsOn, rules }),
  );
}
async function fixture(t: { after: (fn: () => Promise<void>) => void }) {
  await mkdir(path.join(repo, ".tmp"), { recursive: true });
  const root = await mkdtemp(path.join(repo, ".tmp/profiles-test-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await put(root, "package.json", '{"version":"0.1.0"}');
  await put(root, "asset-profiles/nightly.json", canonicalBytes(selection));
  for (const id of selection.profiles) await profile(root, id);
  return root;
}
const rule = (
  path: string,
  kind: "file" | "tree" = "tree",
  logicalPath = "story/media/chapter-01",
): AssetRule => ({ root: "story", path, kind, logicalPath });
const scan = (root: string) => scanAssets(root, selection, history, null);

// Defining invariants: all bytes, copy-only migration, rule-only promotion.
test("New unused file: ignored originals remain dev-only without media decoding", async (t) => {
  const root = await fixture(t);
  await put(root, ".gitignore", "assets/\n");
  for (const family of ["battle", "deck-editor", "story", "shared"])
    await put(root, `assets/${family}/unused/original.psd`, "not an image");
  const inventory = await scan(root);
  assert.equal(inventory.files.length, 4);
  assert.ok(
    inventory.files.every(
      (file) =>
        file.profile === "dev-only" &&
        file.logicalPath === null &&
        file.sha256 === digest("not an image"),
    ),
  );
  assert.deepEqual(
    inventory.profiles.map((p) => p.id),
    ["chapter-01", "core", "runtime"],
  );
  assert.deepEqual(inventory, await scan(root));
});
test("Migration collision: preview/apply preserve every original and reject differing destinations before first copy", async (t) => {
  const root = await fixture(t);
  await put(root, "generated/assets/current/a.json", "a");
  await put(root, "generated/set-images/z.jpg", "z");
  const plan = await previewMigration(root);
  assert.equal(plan.files.length, 2);
  await put(root, "assets/shared/set-images/z.jpg", "edited");
  await assert.rejects(previewMigration(root), {
    message: "ASSET_LOCAL_CONFLICT",
  });
  await assert.rejects(applyMigration(root, plan), {
    message: "ASSET_LOCAL_CONFLICT",
  });
  await assert.rejects(
    readFile(path.join(root, "assets/shared/data/current/a.json")),
    { code: "ENOENT" },
  );
  assert.equal(
    await readFile(path.join(root, "generated/set-images/z.jpg"), "utf8"),
    "z",
  );
  assert.equal(
    await readFile(path.join(root, "assets/shared/set-images/z.jpg"), "utf8"),
    "edited",
  );
});
test("Promotion stable: exact list twice keeps profile bytes and asset bytes unchanged", async (t) => {
  const root = await fixture(t);
  await put(root, "assets/story/chapter-01/a.svg", "art");
  await put(root, "release-assets.txt", "assets/story/chapter-01/a.svg\n\n");
  const before = await readFile(
    path.join(root, "asset-profiles/chapter-01.json"),
  );
  const options = {
    profile: "chapter-01" as const,
    filesFrom: "release-assets.txt",
  };
  const preview = await promoteAssets(root, options);
  assert.equal(preview.changes[0]?.logicalPath, "story/media/chapter-01/a.svg");
  assert.deepEqual(
    await readFile(path.join(root, "asset-profiles/chapter-01.json")),
    before,
  );
  await promoteAssets(root, { ...options, apply: true });
  const once = await readFile(
    path.join(root, "asset-profiles/chapter-01.json"),
  );
  await promoteAssets(root, { ...options, apply: true });
  assert.deepEqual(
    await readFile(path.join(root, "asset-profiles/chapter-01.json")),
    once,
  );
  assert.equal(
    await readFile(path.join(root, "assets/story/chapter-01/a.svg"), "utf8"),
    "art",
  );
  assert.deepEqual(await readdir(path.join(root, "assets/story/chapter-01")), [
    "a.svg",
  ]);
});
test("Directory growth: next scan adds/removes sorted tree membership on segment boundaries", async (t) => {
  const root = await fixture(t);
  await profile(root, "chapter-01", [rule("chapter-01")]);
  await put(root, "assets/story/chapter-01/z.svg", "z");
  await put(root, "assets/story/chapter-010/no.svg", "no");
  await put(root, "assets/story/chapter-01/a.svg", "a");
  assert.deepEqual(
    (await scan(root)).files
      .filter((f) => f.profile === "chapter-01")
      .map((f) => f.sourcePath),
    ["chapter-01/a.svg", "chapter-01/z.svg"],
  );
  await unlink(path.join(root, "assets/story/chapter-01/z.svg"));
  assert.equal(
    (await scan(root)).files.filter((f) => f.profile === "chapter-01").length,
    1,
  );
});
test("Selection conflicts: duplicate ownership and logical paths fail even across unused profiles", async (t) => {
  const root = await fixture(t);
  await profile(root, "chapter-01", [rule("chapter-01")]);
  await profile(root, "chapter-02", [rule("chapter-01")], ["chapter-01"]);
  await put(root, "assets/story/chapter-01/a.svg", "a");
  await assert.rejects(scan(root), { message: "ASSET_PROFILE_CONFLICT" });
  await profile(root, "chapter-02", [rule("other", "tree")], ["chapter-01"]);
  await put(root, "assets/story/other/a.svg", "different");
  await assert.rejects(scan(root), { message: "ASSET_PROFILE_CONFLICT" });
});
test("Broken reference: check fails explicit missing file; pure scan omits; missing tree warns", async (t) => {
  const root = await fixture(t);
  await profile(root, "chapter-01", [rule("missing.svg", "file")]);
  assert.equal((await scan(root)).files.length, 0);
  await assert.rejects(checkAssetProfiles(root), {
    message: "ASSET_REFERENCE_MISSING",
    path: "assets/story/missing.svg",
  });
  await profile(root, "chapter-01", [rule("absent")]);
  assert.deepEqual(
    (await checkAssetProfiles(root)).diagnostics.map((d) => d.phase),
    ["tree-missing-dev-only-empty"],
  );
});
test("DAG: dependencies selected explicitly, unused profiles excluded, cycles/missing deps invalid", async (t) => {
  const root = await fixture(t);
  await profile(root, "chapter-02", [], ["chapter-01"]);
  const inventory = await scanAssets(
    root,
    { schemaVersion: 1, profiles: ["chapter-02"] },
    history,
    null,
  );
  assert.deepEqual(inventory.selection.profiles, [
    "chapter-01",
    "chapter-02",
    "runtime",
  ]);
  await profile(root, "chapter-03", [], ["chapter-02"]);
  await profile(root, "chapter-02", [], ["chapter-03"]);
  await assert.rejects(scan(root), {
    message: "ASSET_PROFILE_CONFLICT",
    path: "asset-profiles/chapter-02.json",
  });
  // Valid diamond: chapter-04 -> chapter-02/chapter-03 -> chapter-01 -> runtime.
  await profile(root, "chapter-02", [], ["chapter-01"]);
  await profile(root, "chapter-03", [], ["chapter-01"]);
  await profile(root, "chapter-04", [], ["chapter-02", "chapter-03"]);
  assert.deepEqual(
    (
      await scanAssets(
        root,
        { schemaVersion: 1, profiles: ["chapter-04"] },
        history,
        null,
      )
    ).selection.profiles,
    ["chapter-01", "chapter-02", "chapter-03", "chapter-04", "runtime"],
  );
  await profile(root, "runtime", [], ["chapter-01"]);
  await assert.rejects(scan(root), { message: "ASSET_PROFILE_CONFLICT" });
  await profile(root, "runtime", [], ["chapter-missing"]);
  await assert.rejects(scan(root), { message: "ASSET_REFERENCE_MISSING" });
});
test("Core split and promotion/migration mapping retain existing browser URLs", async (t) => {
  const root = await fixture(t);
  const mappings = [
    [
      "generated/card-images/archive/full/1.jpg",
      "assets/shared/card-images/full/1.jpg",
      "runtime/images/1.jpg",
    ],
    [
      "generated/card-images/archive/cropped/1.jpg",
      "assets/shared/card-images/cropped/1.jpg",
      "runtime/images-cropped/1.jpg",
    ],
    [
      "generated/card-images/card-back.jpg",
      "assets/shared/card-back.jpg",
      "runtime/images/card-back.jpg",
    ],
    ["src/story/assets/art.svg", "assets/story/art.svg", "story/media/art.svg"],
  ];
  for (const [from, , logical] of mappings) await put(root, from!, logical!);
  const plan = await previewMigration(root);
  const receipt = await applyMigration(root, plan);
  assert.equal(receipt.completed.length, 4);
  for (const [from, to, logical] of mappings) {
    assert.equal(mappedLogicalPath(to!), logical);
    assert.equal(await readFile(path.join(root, from!), "utf8"), logical);
    assert.equal(await readFile(path.join(root, to!), "utf8"), logical);
  }
  assert.deepEqual(await applyMigration(root, plan), receipt);
});
test("Migration source hash and membership guards reject changes; no receipt or copied bytes", async (t) => {
  const root = await fixture(t);
  await put(root, "generated/set-images/a.jpg", "a");
  const plan = await previewMigration(root);
  await put(root, "generated/set-images/a.jpg", "b");
  await assert.rejects(applyMigration(root, plan), {
    message: "ASSET_SOURCE_CHANGED",
  });
  await put(root, "generated/set-images/a.jpg", "a");
  await put(root, "generated/set-images/b.jpg", "b");
  await assert.rejects(applyMigration(root, plan), {
    message: "ASSET_SOURCE_CHANGED",
  });
  await assert.rejects(
    readFile(
      path.join(root, "generated/asset-delivery/migration-receipt.json"),
    ),
    { code: "ENOENT" },
  );
});
test("Migration retry adopts crash output without receipt; source mutation never overwritten", async (t) => {
  const root = await fixture(t);
  await put(root, "generated/set-images/a.jpg", "a");
  const plan = await previewMigration(root);
  await put(root, "assets/shared/set-images/a.jpg", "a");
  const receipt = await applyMigration(root, plan);
  assert.equal(receipt.completed[0]?.sha256, digest("a"));
  assert.equal(
    await readFile(path.join(root, "generated/set-images/a.jpg"), "utf8"),
    "a",
  );
});
test("Unsafe input: credential names, links, case and Unicode collisions rejected regardless gitignore", async (t) => {
  for (const names of [
    [".env.local"],
    ["secret.key"],
    ["nested/.git/config"],
    ["node_modules/x"],
    ["A/x", "a/y"],
    ["é.svg", "é.svg"],
  ]) {
    const root = await fixture(t);
    for (const name of names) await put(root, `assets/story/${name}`, "x");
    await assert.rejects(scan(root), { message: "ASSET_PATH_UNSAFE" });
  }
  const root = await fixture(t);
  await put(root, "outside", "x");
  await mkdir(path.join(root, "assets/story"), { recursive: true });
  await symlink(
    path.join(root, "outside"),
    path.join(root, "assets/story/link"),
  );
  await assert.rejects(scan(root), { message: "ASSET_PATH_UNSAFE" });
});
test("Case mismatch explicit rule reports unsafe path, not absent-file fallback", async (t) => {
  const root = await fixture(t);
  await put(root, "assets/story/Art.svg", "x");
  await profile(root, "chapter-01", [rule("art.svg", "file")]);
  await assert.rejects(checkAssetProfiles(root), {
    message: "ASSET_PATH_UNSAFE",
  });
});
test("Tree promotion defaults to canonical mapping, unmapped requires explicit prefix; no reassignment", async (t) => {
  const root = await fixture(t);
  await put(root, "assets/shared/card-images/cropped/1.jpg", "x");
  await promoteAssets(root, {
    profile: "runtime",
    from: "assets/shared/card-images/cropped",
    all: true,
    apply: true,
  });
  assert.equal(
    (await scan(root)).files[0]?.logicalPath,
    "runtime/images-cropped/1.jpg",
  );
  await assert.rejects(
    promoteAssets(root, {
      profile: "chapter-01",
      from: "assets/shared/card-images/cropped",
      all: true,
      apply: true,
    }),
    { message: "ASSET_PROFILE_CONFLICT" },
  );
  await put(root, "assets/deck-editor/custom/a.svg", "x");
  await assert.rejects(
    promoteAssets(root, {
      profile: "chapter-01",
      from: "assets/deck-editor/custom",
      all: true,
    }),
    { message: "ASSET_CONFIG_INVALID" },
  );
  await promoteAssets(root, {
    profile: "chapter-01",
    from: "assets/deck-editor/custom",
    all: true,
    logicalPrefix: "story/media/custom",
    apply: true,
  });
  assert.equal(
    (await scan(root)).files.find((f) => f.root === "deck-editor")?.logicalPath,
    "story/media/custom/a.svg",
  );
});
test("Common local lock excludes migration, promotion, profile sync writers", async (t) => {
  const root = await fixture(t);
  const release = await acquireAssetDeliveryLock(root);
  try {
    await assert.rejects(
      applyMigration(root, { schemaVersion: 1, files: [] }),
      { message: "ASSET_BUSY" },
    );
    await assert.rejects(
      promoteAssets(root, {
        profile: "chapter-01",
        from: "assets/story/chapter-01",
        all: true,
        apply: true,
      }),
      { message: "ASSET_BUSY" },
    );
  } finally {
    await release();
  }
});
test("Public Node CLI help/invalid flags emit exact final AssetResult and exit status", () => {
  for (const script of [
    "sync-asset-profiles",
    "promote-assets",
    "migrate-assets",
  ]) {
    const help = spawnSync(
      process.execPath,
      [path.join(repo, `scripts/${script}.ts`), "--help"],
      { encoding: "utf8" },
    );
    assert.equal(help.status, 0, help.stderr);
    assert.equal(JSON.parse(help.stdout).status, "ok");
    for (const args of [["--wat"], ["--help", "--wat"]]) {
      const bad = spawnSync(
        process.execPath,
        [path.join(repo, `scripts/${script}.ts`), ...args],
        { encoding: "utf8" },
      );
      assert.equal(bad.status, 2, bad.stderr);
      assert.deepEqual(JSON.parse(bad.stdout), {
        status: "failed",
        code: "ASSET_ARGUMENT_INVALID",
        path: null,
      });
    }
  }
});

test("Migration race: destination appears at exclusive install, differing bytes survive", async (t) => {
  const { default: fs } = await import("node:fs/promises");
  const { syncBuiltinESMExports } = await import("node:module");
  const root = await fixture(t);
  await put(root, "generated/set-images/a.jpg", "incoming");
  const plan = await previewMigration(root);
  const original = fs.link;
  fs.link = async (from, to) => {
    await writeFile(to, "author-edit");
    return original(from, to);
  };
  syncBuiltinESMExports();
  try {
    await assert.rejects(applyMigration(root, plan), {
      message: "ASSET_LOCAL_CONFLICT",
    });
  } finally {
    fs.link = original;
    syncBuiltinESMExports();
  }
  assert.equal(
    await readFile(path.join(root, "assets/shared/set-images/a.jpg"), "utf8"),
    "author-edit",
  );
  assert.deepEqual(await readdir(path.join(root, "assets/shared/set-images")), [
    "a.jpg",
  ]);
});
test("Migration copy guard detects external source mutation, removes own temp, leaves originals", async (t) => {
  const { default: fs } = await import("node:fs/promises");
  const { syncBuiltinESMExports } = await import("node:module");
  const root = await fixture(t);
  await put(root, "generated/set-images/a.jpg", "incoming");
  const plan = await previewMigration(root);
  const original = fs.open;
  fs.open = async (...args: Parameters<typeof fs.open>) => {
    const handle = await original(...args);
    if (path.basename(String(args[0])).startsWith(".m-") && args[1] === "wx") {
      const write = handle.write.bind(handle);
      handle.write = (async (
        buffer: Buffer,
        offset: number,
        length: number,
        position: number,
      ) => {
        const result = await write(buffer, offset, length, position);
        await writeFile(
          path.join(root, "generated/set-images/a.jpg"),
          "author-edit",
        );
        return result;
      }) as typeof handle.write;
    }
    return handle;
  };
  syncBuiltinESMExports();
  try {
    await assert.rejects(applyMigration(root, plan), {
      message: "ASSET_SOURCE_CHANGED",
    });
  } finally {
    fs.open = original;
    syncBuiltinESMExports();
  }
  assert.equal(
    await readFile(path.join(root, "generated/set-images/a.jpg"), "utf8"),
    "author-edit",
  );
  assert.deepEqual(
    await readdir(path.join(root, "assets/shared/set-images")),
    [],
  );
});
test("Migration filesystem without exclusive hardlinks fails closed, no rename fallback", async (t) => {
  const { default: fs } = await import("node:fs/promises");
  const { syncBuiltinESMExports } = await import("node:module");
  const root = await fixture(t);
  await put(root, "generated/set-images/a.jpg", "a");
  const plan = await previewMigration(root);
  const original = fs.link;
  fs.link = async () => {
    throw Object.assign(new Error("unsupported"), { code: "ENOTSUP" });
  };
  syncBuiltinESMExports();
  try {
    await assert.rejects(applyMigration(root, plan), {
      message: "ASSET_LOCAL_CONFLICT",
    });
  } finally {
    fs.link = original;
    syncBuiltinESMExports();
  }
  assert.deepEqual(
    await readdir(path.join(root, "assets/shared/set-images")),
    [],
  );
});
test("Migration crash before/after link and before receipt is retryable after explicit stale-lock recovery", async (t) => {
  for (const phase of ["copy", "link", "receipt"]) {
    const root = await fixture(t);
    await put(root, "generated/assets/current/a.json", "a");
    await profile(root, "runtime", [
      {
        root: "shared",
        path: "data/current",
        kind: "tree",
        logicalPath: "runtime/assets/current",
      },
    ]);
    const plan = await previewMigration(root);
    const clean = await fixture(t);
    await put(clean, "generated/assets/current/a.json", "a");
    await profile(clean, "runtime", [
      {
        root: "shared",
        path: "data/current",
        kind: "tree",
        logicalPath: "runtime/assets/current",
      },
    ]);
    await applyMigration(clean, await previewMigration(clean));
    const expected = await scan(clean);
    const script = `
      import fs from 'node:fs/promises';
      import { syncBuiltinESMExports } from 'node:module';
      import { applyMigration } from ${JSON.stringify(new URL("../scripts/lib/asset-delivery/migrate.ts", import.meta.url).href)};
      const phase=${JSON.stringify(phase)};
      const open=fs.open;
      fs.open=async(...args)=>{
        const handle=await open(...args);
        if(phase==='copy' && args[1]==='wx' && /\\/\\.m-[^/]+$/.test(String(args[0]))) {
          const write=handle.write.bind(handle);
          handle.write=async(...values)=>{ await write(...values); process.exit(73); };
        }
        return handle;
      };
      const method=phase==='link'?'link':'rename', original=fs[method];
      fs[method]=async(...args)=>{ if(phase!=='link') { if(phase==='receipt' && String(args[1]).endsWith('/migration-receipt.json')) process.exit(73); return original(...args); } await original(...args); process.exit(73); };
      syncBuiltinESMExports();
      await applyMigration(${JSON.stringify(root)},${JSON.stringify(plan)});
    `;
    const child = spawnSync(
      process.execPath,
      ["--input-type=module", "-e", script],
      { encoding: "utf8" },
    );
    assert.equal(child.status, 73, child.stderr);
    await assert.rejects(applyMigration(root, plan), { message: "ASSET_BUSY" });
    // Fixture-only owner recovery: child exited, remove only its exact known lock.
    await unlink(path.join(root, "generated/.locks/asset-delivery"));
    if (phase !== "receipt") {
      await assert.rejects(scan(root), { message: "ASSET_RECOVERY_REQUIRED" });
      await assert.rejects(checkAssetProfiles(root), {
        message: "ASSET_RECOVERY_REQUIRED",
      });
      await assert.rejects(acquireAssetDeliveryLock(root), {
        message: "ASSET_RECOVERY_REQUIRED",
      });
      await assert.rejects(
        applyMigration(root, { schemaVersion: 1, files: [] }),
        { message: "ASSET_RECOVERY_REQUIRED" },
      );
    }
    const receipt = await applyMigration(root, plan);
    assert.equal(receipt.completed[0]?.sha256, digest("a"));
    assert.equal(
      await readFile(
        path.join(root, "generated/assets/current/a.json"),
        "utf8",
      ),
      "a",
    );
    assert.equal(
      await readFile(
        path.join(root, "assets/shared/data/current/a.json"),
        "utf8",
      ),
      "a",
    );
    assert.deepEqual(await scan(root), expected);
    assert.deepEqual(
      await readdir(path.join(root, "assets/shared/data/current")),
      ["a.json"],
    );
  }
});
test("Migration temp cleanup error is surfaced, receipt not claimed, retry adopts verified output", async (t) => {
  const { default: fs } = await import("node:fs/promises");
  const { syncBuiltinESMExports } = await import("node:module");
  const root = await fixture(t);
  await put(root, "generated/set-images/a.jpg", "a");
  const plan = await previewMigration(root);
  const original = fs.unlink;
  fs.unlink = async (file) => {
    if (
      path.basename(String(file)).startsWith(".m-") ||
      String(file).endsWith(".migration-tmp")
    )
      throw Object.assign(new Error("cleanup denied"), { code: "EPERM" });
    return original(file);
  };
  syncBuiltinESMExports();
  try {
    await assert.rejects(applyMigration(root, plan), { code: "EPERM" });
  } finally {
    fs.unlink = original;
    syncBuiltinESMExports();
  }
  await assert.rejects(
    readFile(
      path.join(root, "generated/asset-delivery/migration-receipt.json"),
    ),
    { code: "ENOENT" },
  );
  assert.equal((await applyMigration(root, plan)).completed.length, 1);
});
test("Public command runners exercise real fixture sync/migrate/promote outputs, conflicts and common lock", async (t) => {
  const root = await fixture(t);
  await put(root, "generated/set-images/a.jpg", "a");
  const invoke = (module: string, fn: string, args: string[]) => {
    const script = `import {${fn}} from ${JSON.stringify(new URL(`../scripts/lib/asset-delivery/${module}.ts`, import.meta.url).href)}; process.exitCode=await ${fn}(${JSON.stringify(root)},${JSON.stringify(args)});`;
    return spawnSync(process.execPath, ["--input-type=module", "-e", script], {
      encoding: "utf8",
    });
  };
  assert.equal(invoke("migration-cli", "runMigration", ["--plan"]).status, 0);
  assert.equal(
    invoke("migration-cli", "runMigration", [
      "--apply",
      "generated/asset-delivery/migration-plan.json",
    ]).status,
    0,
  );
  await put(root, "list.txt", "assets/shared/set-images/a.jpg\n");
  assert.equal(
    invoke("promotion-cli", "runPromotion", [
      "--profile",
      "chapter-01",
      "--files-from",
      "list.txt",
      "--apply",
    ]).status,
    0,
  );
  assert.equal(invoke("profile-sync", "runProfileSync", ["--check"]).status, 0);
  assert.equal(invoke("profile-sync", "runProfileSync", []).status, 0);
  assert.equal(
    JSON.parse(
      await readFile(
        path.join(root, "generated/asset-delivery/inventory.json"),
        "utf8",
      ),
    ).files[0].logicalPath,
    "runtime/sets/a.jpg",
  );
  const release = await acquireAssetDeliveryLock(root);
  try {
    const busy = invoke("profile-sync", "runProfileSync", []);
    assert.equal(busy.status, 2);
    assert.deepEqual(JSON.parse(busy.stdout), {
      status: "failed",
      code: "ASSET_BUSY",
      path: "generated/.locks/asset-delivery",
    });
  } finally {
    await release();
  }
  for (const args of [
    [
      "--profile",
      "chapter-01",
      "--files-from",
      "list.txt",
      "--from",
      "assets/story",
      "--all",
    ],
    [
      "--profile",
      "chapter-01",
      "--files-from",
      "list.txt",
      "--logical-prefix",
      "story/media",
    ],
  ]) {
    const invalid = invoke("promotion-cli", "runPromotion", args);
    assert.equal(invalid.status, 2);
    assert.equal(JSON.parse(invalid.stdout).code, "ASSET_ARGUMENT_INVALID");
  }
});

test("Dev Vite serves core font URLs and imported SVG only, never original source trees", async (t) => {
  const { createServer } = await import("vite");
  const { sourceAssetsPlugin } =
    await import("../scripts/lib/vite-source-assets.ts");
  const root = await fixture(t);
  await profile(root, "core", [
    {
      root: "shared",
      path: "fonts/test.woff2",
      kind: "file",
      logicalPath: "fonts/test.woff2",
    },
  ]);
  await put(root, "assets/shared/fonts/test.woff2", "font-bytes");
  await put(root, "assets/story/original.psd", "private-original");
  await put(root, "generated/assets/current/original.psd", "private-original");
  await put(
    root,
    "assets/story/chapter-01/city-map-placeholder.svg",
    "<svg></svg>",
  );
  const server = await createServer({
    configFile: false,
    root,
    logLevel: "silent",
    server: { host: "127.0.0.1", port: 0 },
    plugins: [sourceAssetsPlugin(root)],
  });
  try {
    await server.listen();
    const address = server.httpServer!.address();
    assert.ok(address && typeof address !== "string");
    const base = `http://127.0.0.1:${address.port}`;
    const font = await fetch(`${base}/fonts/test.woff2`);
    assert.equal(font.status, 200);
    assert.equal(await font.text(), "font-bytes");
    assert.equal(
      (await fetch(`${base}/assets/story/chapter-01/city-map-placeholder.svg`))
        .status,
      200,
    );
    for (const url of [
      "//assets/story/original.psd",
      "/assets%2Fstory%2Foriginal.psd",
      "/generated/assets/current/original.psd",
      "/assets/story/original.psd",
      `/@fs/${root}/assets/story/original.psd`,
      `/@fs/${root.replace(/^\//, "")}/assets/story/original.psd`,
      "/assets/shared/fonts/test.woff2",
      "/fonts/unknown.woff2",
    ]) {
      const response = await fetch(base + url);
      assert.equal(response.status, 404, url);
      assert.notEqual(await response.text(), "private-original");
    }
    await put(root, "private.txt", "private-original");
    await unlink(
      path.join(root, "assets/story/chapter-01/city-map-placeholder.svg"),
    );
    await symlink(
      path.join(root, "private.txt"),
      path.join(root, "assets/story/chapter-01/city-map-placeholder.svg"),
    );
    const linked = await fetch(
      `${base}/assets/story/chapter-01/city-map-placeholder.svg`,
    );
    assert.equal(linked.status, 404);
    assert.notEqual(await linked.text(), "private-original");
  } finally {
    await server.close();
  }
});
test("Frozen vendor authority: only exact tracked WASM/manifest copied into prepared inventory", async (t) => {
  const { scanVendorFiles } =
    await import("../scripts/lib/asset-delivery/vendor-files.ts");
  const root = await fixture(t);
  for (const file of ["vendor-manifest.json", "lib/ocgcore.sync.wasm"])
    await put(
      root,
      `vendor/ocgcore-wasm/0.1.2/${file}`,
      await readFile(path.join(repo, `vendor/ocgcore-wasm/0.1.2/${file}`)),
    );
  const files = await scanVendorFiles(root);
  assert.deepEqual(
    files.map((f) => f.path),
    [
      "vendor/ocgcore-wasm/0.1.2/lib/ocgcore.sync.wasm",
      "vendor/ocgcore-wasm/0.1.2/vendor-manifest.json",
    ],
  );
  await put(root, "vendor/ocgcore-wasm/0.1.2/lib/ocgcore.sync.wasm", "edited");
  await assert.rejects(scanVendorFiles(root), {
    message: "ASSET_INTEGRITY_FAILED",
  });
});

test("Deep dependency DAG stays bounded by data, not JavaScript call-stack depth", async () => {
  const { selectProfiles } =
    await import("../scripts/lib/asset-delivery/profile-set.ts");
  const profiles: AssetProfile[] = Array.from({ length: 10_000 }, (_, i) => ({
    schemaVersion: 1,
    id: `chapter-level-${i}`,
    dependsOn: i === 9_999 ? [] : [`chapter-level-${i + 1}`],
    rules: [],
  }));
  assert.equal(
    selectProfiles(profiles, {
      schemaVersion: 1,
      profiles: ["chapter-level-0"],
    }).profiles.length,
    10_000,
  );
});
test("CLI distinguishes expected disk/permission errors from unexpected faults without raw error leakage", async () => {
  const { assetCli } = await import("../scripts/lib/asset-delivery/cli.ts");
  for (const [code, expected, exit] of [
    ["ENOSPC", "ASSET_DISK_FULL", 2],
    ["EPERM", "ASSET_LOCAL_CONFLICT", 2],
    ["UNKNOWN", "ASSET_CONFIG_INVALID", 1],
  ] as const) {
    const lines: string[] = [];
    const result = await assetCli(
      "migrate",
      async () => {
        throw Object.assign(new Error("raw-private-detail"), { code });
      },
      (line) => lines.push(line),
    );
    assert.equal(result, exit);
    assert.deepEqual(JSON.parse(lines[0]!), {
      status: "failed",
      code: expected,
      path: null,
    });
    assert.ok(!lines.join().includes("raw-private-detail"));
  }
});

test("explicit media selection requires selected art without inventing files from gameplay metadata", async (t) => {
  const root = await fixture(t);
  await put(
    root,
    "content/chapter-selections.json",
    JSON.stringify({ cardCodes: [1, 2] }),
  );
  await put(root, "assets/story/available.svg", "art");
  await profile(root, "chapter-01", [
    rule("available.svg", "file", "story/media/available.svg"),
  ]);
  assert.equal((await checkAssetProfiles(root)).inventory.files.length, 1);
  // Gameplay metadata alone is not an instruction to fabricate absent art.
  await unlink(path.join(root, "assets/story/available.svg"));
  await assert.rejects(checkAssetProfiles(root), {
    message: "ASSET_REFERENCE_MISSING",
    path: "assets/story/available.svg",
  });
});

test("Source deleted between directory enumeration and hashing fails source-change guard", async (t) => {
  const { default: fs } = await import("node:fs/promises");
  const { syncBuiltinESMExports } = await import("node:module");
  const root = await fixture(t);
  await put(root, "assets/story/original.psd", "source");
  const original = fs.readdir;
  let removed = false;
  fs.readdir = (async (...args: Parameters<typeof fs.readdir>) => {
    const entries = await original(...args);
    if (!removed && String(args[0]) === path.join(root, "assets/story")) {
      removed = true;
      await unlink(path.join(root, "assets/story/original.psd"));
    }
    return entries;
  }) as typeof fs.readdir;
  syncBuiltinESMExports();
  try {
    await assert.rejects(scan(root), { message: "ASSET_SOURCE_CHANGED" });
  } finally {
    fs.readdir = original;
    syncBuiltinESMExports();
  }
});

test("Observed root disappearance and enumerated file disappearance fail ASSET_SOURCE_CHANGED", async (t) => {
  const { default: fs } = await import("node:fs/promises");
  const { syncBuiltinESMExports } = await import("node:module");
  for (const phase of ["root", "file"]) {
    const root = await fixture(t);
    await put(root, "assets/story/original.psd", "source");
    const target = path.join(
      root,
      phase === "root" ? "assets/story" : "assets/story/original.psd",
    );
    const original = fs.lstat;
    let observations = 0;
    fs.lstat = (async (...args: Parameters<typeof fs.lstat>) => {
      const result = await original(...args);
      if (
        String(args[0]) === target &&
        (args[1] as { bigint?: boolean } | undefined)?.bigint
      ) {
        observations++;
        // root's preliminary observation; file identity immediately before hashing.
        if (observations === (phase === "root" ? 1 : 2))
          await rm(target, { recursive: phase === "root" });
      }
      return result;
    }) as typeof fs.lstat;
    syncBuiltinESMExports();
    try {
      await assert.rejects(scan(root), {
        message: "ASSET_SOURCE_CHANGED",
        path: path.relative(root, target),
      });
      assert.equal(observations, phase === "root" ? 1 : 2);
    } finally {
      fs.lstat = original;
      syncBuiltinESMExports();
    }
  }
});

test("Migration preflight rejects empty-directory case/Unicode aliases before any copy", async (t) => {
  for (const [old, existing] of [
    ["src/story/assets/é/test.svg", "assets/story/é"],
  ]) {
    const root = await fixture(t);
    await put(root, "generated/assets/current/a.json", "a");
    await put(root, old!, "source");
    const plan = await previewMigration(root);
    await mkdir(path.join(root, existing!), { recursive: true });
    await assert.rejects(previewMigration(root), {
      message: "ASSET_PATH_UNSAFE",
    });
    await assert.rejects(applyMigration(root, plan), {
      message: "ASSET_PATH_UNSAFE",
    });
    await assert.rejects(
      readFile(path.join(root, "assets/shared/data/current/a.json")),
      { code: "ENOENT" },
    );
    assert.deepEqual(await readdir(path.join(root, existing!)), []);
    assert.equal(await readFile(path.join(root, old!), "utf8"), "source");
  }
});

test("Migration independent temp supports long basenames and preflights derived 512-byte boundary", async (t) => {
  const root = await fixture(t);
  const long = `${"z".repeat(220)}.jpg`;
  await put(root, "generated/set-images/a.jpg", "a");
  await put(root, `generated/set-images/${long}`, "long");
  const plan = await previewMigration(root);
  assert.equal((await applyMigration(root, plan)).completed.length, 2);
  assert.deepEqual(await readdir(path.join(root, "assets/shared/set-images")), [
    "a.jpg",
    long,
  ]);
  for (const parentBytes of [472, 473]) {
    const fixtureRoot = await fixture(t);
    // Temp basename is 39 bytes, independent of the destination basename.
    const prefix = "assets/story/";
    const parents = `${"p".repeat(220)}/${"q".repeat(parentBytes - prefix.length - 221)}`;
    const from = `src/story/assets/${parents}/x`;
    await put(fixtureRoot, from, "x");
    await put(fixtureRoot, "generated/assets/current/a.json", "a");
    if (parentBytes === 472) {
      const accepted = await previewMigration(fixtureRoot);
      await applyMigration(fixtureRoot, accepted);
      assert.equal(
        await readFile(
          path.join(fixtureRoot, `assets/story/${parents}/x`),
          "utf8",
        ),
        "x",
      );
    } else {
      await assert.rejects(previewMigration(fixtureRoot), {
        message: "ASSET_PATH_UNSAFE",
      });
      await assert.rejects(
        readFile(path.join(fixtureRoot, "assets/shared/data/current/a.json")),
        { code: "ENOENT" },
      );
    }
  }
});

test("CLI nullish/non-Error throws still emit one final sanitized AssetResult", async () => {
  const { assetCli } = await import("../scripts/lib/asset-delivery/cli.ts");
  for (const thrown of [null, undefined, "raw-private-detail", 17, {}]) {
    const lines: string[] = [];
    const exit = await assetCli(
      "migrate",
      async () => {
        throw thrown;
      },
      (line) => lines.push(line),
    );
    assert.equal(exit, 1);
    assert.deepEqual(
      lines.map((line) => JSON.parse(line)),
      [{ status: "failed", code: "ASSET_CONFIG_INVALID", path: null }],
    );
  }
});

test("Promotion rule diff is linear over sorted rules, including unchanged 100000-rule control", async () => {
  const { addedRules } =
    await import("../scripts/lib/asset-delivery/promotion-rule-diff.ts");
  let reads = 0;
  const rules: AssetRule[] = Array.from({ length: 100_000 }, (_, i) => ({
    get root() {
      reads++;
      return "story" as const;
    },
    path: `art/${String(i).padStart(6, "0")}`,
    kind: "file",
    logicalPath: `story/media/art/${String(i).padStart(6, "0")}`,
  }));
  assert.deepEqual(addedRules(rules, rules), []);
  assert.ok(reads <= rules.length * 8, `root accesses: ${reads}`);
  const extra = rule("zzz", "file", "story/media/zzz");
  assert.deepEqual(addedRules(rules, [...rules, extra]), [extra]);
});

test("Promotion apply compares bounded constituents, not a duplicated over-32MiB wrapper", async (t) => {
  const { MAX_METADATA_BYTES } =
    await import("../scripts/lib/asset-delivery/canonical-json.ts");
  const root = await fixture(t);
  const rules: AssetRule[] = Array.from({ length: 9_500 }, (_, i) => {
    const part = `${String(i).padStart(5, "0")}/${"x".repeat(235)}/${"y".repeat(235)}`;
    return {
      root: "battle",
      path: part,
      kind: "file",
      logicalPath: `media/${part}`,
    };
  });
  await profile(root, "chapter-01", rules);
  await put(root, "assets/story/new.svg", "new");
  await put(root, "list.txt", "assets/story/new.svg\n");
  const bytes = await readFile(
    path.join(root, "asset-profiles/chapter-01.json"),
  );
  assert.ok(bytes.length < MAX_METADATA_BYTES);
  assert.ok(bytes.length * 4 > MAX_METADATA_BYTES);
  const options = {
    profile: "chapter-01" as const,
    filesFrom: "list.txt",
    apply: true,
  };
  const result = await promoteAssets(root, options);
  assert.equal(result.after.rules.length, 9_501);
  assert.deepEqual(result.changes, [
    {
      path: "assets/story/new.svg",
      logicalPath: "story/media/new.svg",
      profile: "chapter-01",
      kind: "file",
    },
  ]);
  const once = await readFile(
    path.join(root, "asset-profiles/chapter-01.json"),
  );
  assert.deepEqual((await promoteAssets(root, options)).changes, []);
  assert.deepEqual(
    await readFile(path.join(root, "asset-profiles/chapter-01.json")),
    once,
  );
});

test("Migration recovery leaves partial, replaced-inode and unknown temps untouched behind the gate", async (t) => {
  for (const phase of [
    "partial",
    "unknown",
    "replaced",
    "linked",
    "malformed",
  ]) {
    const root = await fixture(t);
    await put(root, "generated/assets/current/a.json", "complete");
    await profile(root, "runtime", [
      {
        root: "shared",
        path: "data/current",
        kind: "tree",
        logicalPath: "runtime/assets/current",
      },
    ]);
    const plan = await previewMigration(root);
    const script = `
      import fs from 'node:fs/promises';
      import { syncBuiltinESMExports } from 'node:module';
      import { applyMigration } from ${JSON.stringify(new URL("../scripts/lib/asset-delivery/migrate.ts", import.meta.url).href)};
      const phase=${JSON.stringify(phase)};
      const open=fs.open;
      fs.open=async(...args)=>{
        const handle=await open(...args);
        if(args[1]==='wx' && /\\/\\.m-[^/]+$/.test(String(args[0]))) {
          if(phase==='unknown') process.exit(73);
          const write=handle.write.bind(handle);
          handle.write=async(buffer,offset,length,position)=>{
            await write(buffer,offset,phase==='partial'?3:length,position);
            process.exit(73);
          };
        }
        return handle;
      };
      syncBuiltinESMExports();
      await applyMigration(${JSON.stringify(root)},${JSON.stringify(plan)});
    `;
    const child = spawnSync(
      process.execPath,
      ["--input-type=module", "-e", script],
      { encoding: "utf8" },
    );
    assert.equal(child.status, 73, child.stderr);
    await unlink(path.join(root, "generated/.locks/asset-delivery"));
    const marker = "generated/asset-delivery/migration-pending.json";
    const pending = JSON.parse(
      await readFile(path.join(root, marker), "utf8"),
    ) as { temporary: string; identity: unknown };
    const temporary = path.join(root, pending.temporary);
    if (phase === "unknown") assert.equal(pending.identity, null);
    if (phase === "replaced") {
      const { open } = await import("node:fs/promises");
      const old = await open(temporary, "r");
      try {
        await unlink(temporary);
        await writeFile(temporary, "complete");
      } finally {
        await old.close();
      }
    }
    if (phase === "linked") {
      await unlink(temporary);
      await symlink(
        path.join(root, "generated/assets/current/a.json"),
        temporary,
      );
    }
    if (phase === "malformed") await put(root, marker, '{"unknown":true}');
    const markerBytes = await readFile(path.join(root, marker));
    const tempBytes = await readFile(temporary);
    for (let retry = 0; retry < 2; retry++) {
      await assert.rejects(applyMigration(root, plan), {
        message: "ASSET_RECOVERY_REQUIRED",
      });
      await assert.rejects(scan(root), { message: "ASSET_RECOVERY_REQUIRED" });
      await assert.rejects(
        promoteAssets(root, {
          profile: "runtime",
          from: "assets/shared/data/current",
          all: true,
          apply: true,
        }),
        { message: "ASSET_RECOVERY_REQUIRED" },
      );
      await assert.rejects(acquireAssetDeliveryLock(root), {
        message: "ASSET_RECOVERY_REQUIRED",
      });
      assert.deepEqual(await readFile(temporary), tempBytes);
      assert.deepEqual(await readFile(path.join(root, marker)), markerBytes);
      await assert.rejects(
        readFile(path.join(root, "generated/.locks/asset-delivery")),
        { code: "ENOENT" },
      );
    }
    assert.equal(
      await readFile(
        path.join(root, "generated/assets/current/a.json"),
        "utf8",
      ),
      "complete",
    );
    await assert.rejects(
      readFile(path.join(root, "assets/shared/data/current/a.json")),
      { code: "ENOENT" },
    );
  }
});

test("Unknown operational-shaped originals fail recovery without filename-based omission or deletion", async (t) => {
  for (const basename of [
    "a.json.00000000-0000-0000-0000-000000000000.migration-tmp",
    ".m-00000000-0000-0000-0000-000000000000",
  ]) {
    const root = await fixture(t);
    await profile(root, "runtime", [
      {
        root: "shared",
        path: "data/current",
        kind: "tree",
        logicalPath: "runtime/assets/current",
      },
    ]);
    const file = `assets/shared/data/current/${basename}`;
    await put(root, file, "author-bytes");
    await assert.rejects(scan(root), {
      message: "ASSET_RECOVERY_REQUIRED",
      path: file,
    });
    await assert.rejects(previewMigration(root), {
      message: "ASSET_RECOVERY_REQUIRED",
      path: file,
    });
    assert.equal(await readFile(path.join(root, file), "utf8"), "author-bytes");
  }
  const root = await fixture(t);
  await put(root, "assets/story/author.migration-tmp", "original");
  assert.equal((await scan(root)).files[0]?.sourcePath, "author.migration-tmp");
});

test("Owned migration handle preserves bounded partial writes on ENOSPC, EFBIG and zero progress", async (t) => {
  const { default: fs } = await import("node:fs/promises");
  const { syncBuiltinESMExports } = await import("node:module");
  for (const failure of ["ENOSPC", "EFBIG", "zero", "short-success"]) {
    const root = await fixture(t);
    const bytes = Buffer.from(
      Array.from({ length: 1024 * 1024 + 17 }, (_, i) => i % 251),
    );
    await put(root, "generated/assets/current/a.json", bytes);
    const plan = await previewMigration(root);
    const original = fs.open;
    let writes = 0;
    const handles: Awaited<ReturnType<typeof fs.open>>[] = [];
    fs.open = async (...args: Parameters<typeof fs.open>) => {
      const handle = await original(...args);
      const writable =
        typeof args[1] === "number"
          ? (args[1] & 3) !== 0
          : typeof args[1] === "string" && /[w+a]/.test(args[1]);
      if (path.basename(String(args[0])).startsWith(".m-") && writable) {
        handles.push(handle);
        const write = handle.write.bind(handle);
        handle.write = (async (
          buffer: Buffer,
          offset: number,
          length: number,
          position: number,
        ) => {
          writes++;
          assert.ok(length <= 1024 * 1024);
          if (writes === 3 && failure !== "short-success") {
            if (failure === "zero") return { bytesWritten: 0, buffer };
            throw Object.assign(new Error("injected write failure"), {
              code: failure,
            });
          }
          return write(buffer, offset, Math.min(length, 65_537), position);
        }) as typeof handle.write;
      }
      return handle;
    };
    syncBuiltinESMExports();
    try {
      if (failure === "short-success") await applyMigration(root, plan);
      else
        await assert.rejects(applyMigration(root, plan), {
          message: "ASSET_RECOVERY_REQUIRED",
        });
    } finally {
      fs.open = original;
      syncBuiltinESMExports();
    }
    assert.equal(handles.length, 1, "owned temp must not reopen or truncate");
    assert.equal(handles[0]!.fd, -1, "owned handle must close");
    assert.ok(writes >= 3);
    assert.deepEqual(
      await readFile(path.join(root, "generated/assets/current/a.json")),
      bytes,
    );
    const marker = path.join(
      root,
      "generated/asset-delivery/migration-pending.json",
    );
    if (failure === "short-success") {
      assert.deepEqual(
        await readFile(path.join(root, "assets/shared/data/current/a.json")),
        bytes,
      );
      await assert.rejects(readFile(marker), { code: "ENOENT" });
    } else {
      const markerBytes = await readFile(marker);
      const pending = JSON.parse(markerBytes.toString()) as {
        temporary: string;
      };
      const partial = await readFile(path.join(root, pending.temporary));
      assert.deepEqual(partial, bytes.subarray(0, 131_074));
      await assert.rejects(scan(root), { message: "ASSET_RECOVERY_REQUIRED" });
      await assert.rejects(acquireAssetDeliveryLock(root), {
        message: "ASSET_RECOVERY_REQUIRED",
      });
      await assert.rejects(applyMigration(root, plan), {
        message: "ASSET_RECOVERY_REQUIRED",
      });
      assert.deepEqual(await readFile(marker), markerBytes);
      assert.deepEqual(
        await readFile(path.join(root, pending.temporary)),
        partial,
      );
      await assert.rejects(
        readFile(path.join(root, "assets/shared/data/current/a.json")),
        { code: "ENOENT" },
      );
    }
  }
});

test(
  "Linux ulimit-f write failure retains actual partial migration bytes and recovery marker",
  {
    skip:
      process.platform !== "linux"
        ? "RLIMIT_FSIZE fixture requires Linux bash; injected write failures run on every platform"
        : false,
  },
  async (t) => {
    const root = await fixture(t);
    const bytes = Buffer.alloc(16_384, 97);
    await put(root, "generated/assets/current/a.json", bytes);
    const plan = await previewMigration(root);
    const script = `
    import fs from 'node:fs/promises';
    import path from 'node:path';
    import { syncBuiltinESMExports } from 'node:module';
    import { applyMigration } from ${JSON.stringify(new URL("../scripts/lib/asset-delivery/migrate.ts", import.meta.url).href)};
    process.on('SIGXFSZ', () => {});
    let nativeFailure = null;
    const open = fs.open;
    fs.open = async (...args) => {
      const handle = await open(...args);
      if (path.basename(String(args[0])).startsWith('.m-')) {
        const write = handle.write.bind(handle);
        handle.write = async (...values) => { try { return await write(...values); } catch (error) { nativeFailure = error.code; throw error; } };
      }
      return handle;
    };
    syncBuiltinESMExports();
    try { await applyMigration(${JSON.stringify(root)}, ${JSON.stringify(plan)}); process.exitCode = 1; }
    catch (error) { process.stdout.write(JSON.stringify({code: error.code, nativeFailure}) + '\\n'); process.exitCode = 2; }
  `;
    const child = spawnSync(
      "bash",
      [
        "-c",
        'ulimit -f 1 || exit 77; exec "$@"',
        "migration-limit",
        process.execPath,
        "--input-type=module",
        "-e",
        script,
      ],
      {
        encoding: "utf8",
        timeout: 15_000,
        env: { ...process.env, NODE_DISABLE_COMPILE_CACHE: "1" },
      },
    );
    if (child.error?.message.includes("ENOENT") || child.status === 77) {
      t.skip(
        "Linux bash/ulimit-f unavailable; injected write failures still required",
      );
      return;
    }
    assert.equal(child.status, 2, child.stderr);
    assert.deepEqual(JSON.parse(child.stdout), {
      code: "ASSET_RECOVERY_REQUIRED",
      nativeFailure: "EFBIG",
    });
    const marker = path.join(
      root,
      "generated/asset-delivery/migration-pending.json",
    );
    const markerBytes = await readFile(marker);
    const pending = JSON.parse(markerBytes.toString()) as { temporary: string };
    const partial = await readFile(path.join(root, pending.temporary));
    assert.equal(partial.length, 1024);
    assert.deepEqual(partial, bytes.subarray(0, 1024));
    assert.deepEqual(
      await readFile(path.join(root, "generated/assets/current/a.json")),
      bytes,
    );
    await assert.rejects(scan(root), { message: "ASSET_RECOVERY_REQUIRED" });
    await assert.rejects(acquireAssetDeliveryLock(root), {
      message: "ASSET_RECOVERY_REQUIRED",
    });
    await assert.rejects(applyMigration(root, plan), {
      message: "ASSET_RECOVERY_REQUIRED",
    });
    assert.deepEqual(await readFile(marker), markerBytes);
    assert.deepEqual(
      await readFile(path.join(root, pending.temporary)),
      partial,
    );
    await assert.rejects(
      readFile(path.join(root, "assets/shared/data/current/a.json")),
      { code: "ENOENT" },
    );
    t.diagnostic(
      "native EFBIG; partial1024 retained; source16384 unchanged; scan/writers blocked",
    );
  },
);
