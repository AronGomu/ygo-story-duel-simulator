import assert from "node:assert/strict";
import test from "node:test";
import {
  copyFile,
  mkdtemp,
  mkdir,
  readFile,
  readdir,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { ESLint } from "eslint";
import {
  AssetDeliveryError,
  failureResult,
} from "../scripts/lib/asset-delivery/failure.ts";
import { parseAssetDeliveryConfig } from "../scripts/lib/asset-delivery/config.ts";
import {
  assertSafePath,
  assertManagedPath,
  assertNoPathCollisions,
  assertSafeParents,
} from "../scripts/lib/asset-delivery/path-guards.ts";
import {
  parsePublicationApproval,
  checkPublicationScope,
} from "../scripts/lib/asset-delivery/publication-approval.ts";
import { parsePublicationInventory } from "../scripts/lib/asset-delivery/publication-inventory.ts";
import { parseAssetProfile } from "../scripts/lib/asset-delivery/asset-profile.ts";
import { acquireAssetDeliveryLock } from "../scripts/lib/asset-delivery/local-lock.ts";
import { runAssetSetup } from "../scripts/lib/asset-delivery/setup.ts";
import { probeAssetSetup } from "../scripts/lib/asset-delivery/setup-remote.ts";
import {
  canonicalBytes,
  compareCodePoints,
  MAX_METADATA_BYTES,
  parseJsonBytes,
} from "../scripts/lib/asset-delivery/canonical-json.ts";
import fs from "node:fs/promises";
import { syncBuiltinESMExports } from "node:module";
import { verifyContentSetup } from "../scripts/lib/content-setup.ts";
import { contentSetupFixture } from "./fixtures/content-setup.ts";

test("canonical metadata smoke: compact UTF-8 plus LF", () => {
  assert.equal(
    new TextDecoder().decode(canonicalBytes({ schemaVersion: 1 })),
    '{"schemaVersion":1}\n',
  );
});

const sha = "a".repeat(64);
const config = {
  schemaVersion: 1,
  publicBaseUrl: "https://assets.example/ascencio-assets/v1/",
  bucket: "ascencio-assets",
  keyPrefix: "ascencio-assets/v1/",
};
const emptyState = {
  schemaVersion: 1,
  nightly: null,
  releases: [],
  retiredNightlies: [],
};
const digest = {
  path: "content/distribution-evidence.json",
  bytes: 12,
  sha256: sha,
};
const failure = (code: string) => (error: unknown) =>
  error instanceof AssetDeliveryError &&
  error.code === code &&
  error.message === code;
async function fixture(t: test.TestContext): Promise<string> {
  await mkdir(".tmp", { recursive: true });
  const root = await mkdtemp(path.resolve(".tmp/asset-contract-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  return root;
}

test("canonical metadata rejects ambiguity; code-point sorted keys, not insertion or UTF-16 order", () => {
  const first = { "𐀀": 3, "\ue000": 2, "2": 4, "10": 1 };
  assert.equal(
    Buffer.from(canonicalBytes(first)).toString(),
    '{"10":1,"2":4,"\ue000":2,"𐀀":3}\n',
  );
  assert.deepEqual(
    canonicalBytes({ z: 2, a: { d: 4, b: 3 } }),
    canonicalBytes({ a: { b: 3, d: 4 }, z: 2 }),
  );
  const cycle: Record<string, unknown> = {};
  cycle.self = cycle;
  for (const bad of [
    undefined,
    NaN,
    Infinity,
    1n,
    new Date(),
    { a: undefined },
    [undefined],
    Array(1),
    { a: () => 1 },
    cycle,
    "\ud800",
    Number.MAX_SAFE_INTEGER + 1,
  ])
    assert.throws(() => canonicalBytes(bad), failure("ASSET_CONFIG_INVALID"));
});

test("strict config accepts HTTPS custom prefix only; unknown keys fail", () => {
  assert.deepEqual(parseAssetDeliveryConfig(config), config);
  for (const url of [
    "http://assets.example/ascencio-assets/v1/",
    "https://user:pass@assets.example/ascencio-assets/v1/",
    "https://assets.example/ascencio-assets/v1/?token=x",
    "https://assets.example/ascencio-assets/v1/#x",
    "https://assets.example/wrong/",
    "https://assets.example/ascencio-assets/v1",
    "https://assets.example/a/../ascencio-assets/v1/",
    "https://assets.example/%61scencio-assets/v1/",
    "https://pub-test.r2.dev/ascencio-assets/v1/",
  ])
    assert.throws(
      () => parseAssetDeliveryConfig({ ...config, publicBaseUrl: url }),
      failure("ASSET_CONFIG_INVALID"),
    );
  for (const value of [
    { ...config, secret: "not-allowed" },
    { ...config, schemaVersion: 2 },
    { ...config, bucket: "../bad" },
  ])
    assert.throws(
      () => parseAssetDeliveryConfig(value),
      failure("ASSET_CONFIG_INVALID"),
    );
});

test("cross-platform managed paths reject traversal, devices, forbidden roots, aliases", () => {
  assert.equal(
    assertManagedPath("assets/story/originals/é.psd"),
    "assets/story/originals/é.psd",
  );
  for (const bad of [
    "/a",
    "a/../b",
    "a/./b",
    "a//b",
    "a\\b",
    "C:a",
    "a\0b",
    "a%20",
    "a?b",
    "a#b",
    "CON.jpg",
    "a/LPT9.psd",
    "a/COM¹.txt",
    "a. ",
    "a/",
    "a/aux",
    "a/*",
    "a/\u0001",
  ])
    assert.throws(() => assertSafePath(bad), failure("ASSET_PATH_UNSAFE"));
  for (const bad of [
    "vendor/ocgcore-wasm/a",
    "assets/unknown/a",
    "assets/story/.env",
    "assets/story/.env.local",
    "assets/story/node_modules/a",
    "assets/story/.git/config",
    "assets/shared/key.pem",
  ])
    assert.throws(() => assertManagedPath(bad), failure("ASSET_PATH_UNSAFE"));
  for (const files of [
    ["A/a", "a/b"],
    ["A", "a"],
    ["é", "e\u0301"],
    ["dir", "dir/file"],
    ["a", "a"],
  ])
    assert.throws(
      () => assertNoPathCollisions(files),
      failure("ASSET_PATH_UNSAFE"),
    );
  assertNoPathCollisions(["a/x", "a/y"]);
  assert.equal(assertSafePath("", true), "");
  assert.throws(() => assertSafePath(""), failure("ASSET_PATH_UNSAFE"));
});

test("parent guards reject links before writes; lock serializes common namespace", async (t) => {
  const root = await fixture(t);
  await mkdir(path.join(root, "outside"));
  await mkdir(path.join(root, "assets"));
  await symlink(
    path.join(root, "outside"),
    path.join(root, "assets/story"),
    process.platform === "win32" ? "junction" : "dir",
  );
  await assert.rejects(
    assertSafeParents(root, "assets/story/new.psd"),
    failure("ASSET_PATH_UNSAFE"),
  );
  const release = await acquireAssetDeliveryLock(root);
  await assert.rejects(acquireAssetDeliveryLock(root), failure("ASSET_BUSY"));
  await release();
  await (
    await acquireAssetDeliveryLock(root)
  )();
  await writeFile(
    path.join(root, "generated/.locks/asset-delivery"),
    "interrupted",
  );
  await assert.rejects(acquireAssetDeliveryLock(root), failure("ASSET_BUSY"));
});

test("rights-only scope independent of gameplay; exact hashes, future trees, evidence schema", () => {
  const gameplay = contentSetupFixture();
  gameplay.availability.runtimeVerified = false;
  const readiness = verifyContentSetup(gameplay);
  assert.equal(readiness.publishReady, false);
  assert(
    readiness.blockers.some(
      (blocker) => blocker.code === "SOURCE_COVERAGE_REQUIRED",
    ),
  );
  const approval = parsePublicationApproval({
    schemaVersion: 1,
    status: "approved",
    targets: ["dev"],
    rules: [
      {
        root: "story",
        kind: "file",
        path: "approved.psd",
        sha256: sha,
        evidence: digest,
      },
    ],
  });
  assert.equal(
    checkPublicationScope(approval, "dev", [
      { root: "story", path: "approved.psd", sha256: sha },
    ]).status,
    "ok",
  );
  assert.deepEqual(
    checkPublicationScope(approval, "dev", [
      { root: "story", path: "other.psd", sha256: sha },
    ]),
    {
      status: "failed",
      code: "ASSET_PUBLICATION_DENIED",
      path: "assets/story/other.psd",
    },
  );
  assert.equal(checkPublicationScope(approval, "prod", []).status, "failed");
  assert.equal(
    checkPublicationScope(approval, "dev", [
      { root: "story", path: "approved.psd", sha256: "b".repeat(64) },
    ]).status,
    "failed",
  );
  const tree = {
    root: "story",
    kind: "tree",
    path: "chapter-01",
    includesFutureFiles: true,
    evidence: digest,
  };
  const future = parsePublicationApproval({ ...approval, rules: [tree] });
  assert.equal(
    checkPublicationScope(future, "dev", [
      { root: "story", path: "chapter-01/new.psd", sha256: sha },
    ]).status,
    "ok",
  );
  assert.equal(
    checkPublicationScope(future, "dev", [
      { root: "story", path: "chapter-010/new.psd", sha256: sha },
    ]).status,
    "failed",
  );
  for (const rule of [
    { ...tree, includesFutureFiles: false },
    { ...tree, root: "vendor" },
    { ...tree, evidence: { ...digest, secret: "no" } },
  ])
    assert.throws(
      () => parsePublicationApproval({ ...approval, rules: [rule] }),
      failure("ASSET_CONFIG_INVALID"),
    );
  assert.throws(
    () => parsePublicationApproval({ ...approval, publishReady: false }),
    failure("ASSET_CONFIG_INVALID"),
  );
});

test("local setup: no publisher credentials required, no writes/network; public CLI JSON", async (t) => {
  const root = await fixture(t);
  await writeFile(
    path.join(root, "asset-delivery.config.json"),
    JSON.stringify(config),
  );
  const before = await readdir(root);
  const out: string[] = [];
  const err: string[] = [];
  assert.equal(
    await runAssetSetup(
      root,
      ["--check"],
      {},
      (s) => out.push(s),
      (s) => err.push(s),
    ),
    0,
  );
  assert.deepEqual(JSON.parse(out.at(-1)!), {
    status: "ok",
    operation: "setup",
    snapshotSha256: null,
  });
  assert(
    err
      .map((s) => JSON.parse(s).phase)
      .includes("publisher-credentials-pending"),
  );
  assert.deepEqual(await readdir(root), before);
  const script = path.resolve("scripts/asset-delivery-setup.ts");
  for (const [args, expected] of [
    [["--help"], 0],
    [["--unknown"], 2],
    [["--help", "--remote"], 2],
    [["--check", "--check"], 2],
    [["--remote"], 2],
    [["--origin", "https://app.example"], 2],
    [["--remote", "--origin"], 2],
    [["--remote", "--origin", "https://user:pass@app.example"], 2],
  ] as const) {
    const res = spawnSync(process.execPath, [script, ...args], {
      encoding: "utf8",
      cwd: root,
    });
    assert.equal(res.status, expected, res.stderr);
    assert(["ok", "failed"].includes(JSON.parse(res.stdout.trim()).status));
  }
  assert.equal(failureResult(new Error("provider-secret-body")).exitCode, 1);
  assert(
    !JSON.stringify(failureResult(new Error("provider-secret-body"))).includes(
      "provider-secret-body",
    ),
  );
});

test("remote setup probes only anonymous HEAD/GET plus read-only S3 commands; sanitizes failures", async () => {
  const requests: { url: string; init: RequestInit }[] = [];
  const commands: string[] = [];
  const fetcher: typeof fetch = async (input, init = {}) => {
    requests.push({ url: String(input), init });
    return new Response(
      init.method === "HEAD" ? null : JSON.stringify(emptyState),
      {
        headers: {
          "access-control-allow-origin": "https://app.example",
          "access-control-expose-headers":
            "Content-Length, ETag, Content-Range, Accept-Ranges",
        },
      },
    );
  };
  const send = async (command: unknown) => {
    commands.push(
      (command as { constructor: { name: string } }).constructor.name,
    );
    if (commands.at(-1) === "ListObjectsV2Command")
      assert.deepEqual((command as { input: unknown }).input, {
        Bucket: "ascencio-assets",
        Prefix: "ascencio-assets/v1/",
        MaxKeys: 1,
      });
    return {};
  };
  await probeAssetSetup(
    parseAssetDeliveryConfig(config),
    ["https://app.example"],
    fetcher,
    send,
  );
  assert.deepEqual(commands, ["HeadBucketCommand", "ListObjectsV2Command"]);
  assert(requests.some(({ init }) => init.method === "HEAD"));
  assert(requests.some(({ init }) => new Headers(init.headers).has("origin")));
  for (const { init } of requests) {
    assert(["GET", "HEAD"].includes(init.method!));
    assert.equal(init.credentials, "omit");
    assert.equal(init.redirect, "error");
    assert.equal(new Headers(init.headers).get("cache-control"), "no-store");
    assert(!new Headers(init.headers).has("authorization"));
  }
  await assert.rejects(
    probeAssetSetup(
      parseAssetDeliveryConfig(config),
      ["https://app.example"],
      async () => new Response("secret", { status: 404 }),
      send,
    ),
    failure("ASSET_REFERENCE_MISSING"),
  );
  await assert.rejects(
    probeAssetSetup(
      parseAssetDeliveryConfig(config),
      ["https://app.example"],
      fetcher,
      async () => {
        throw new Error("secret-provider-body");
      },
    ),
    failure("ASSET_NETWORK_FAILED"),
  );
});

test("Node SDK imports rejected from browser modules, including dynamic import", async () => {
  const eslint = new ESLint();
  for (const code of [
    'import { S3Client } from "@aws-sdk/client-s3"; void S3Client;',
    'void import("@aws-sdk/lib-storage");',
    'export * from "../../scripts/lib/asset-delivery/config.ts";',
  ]) {
    const [result] = await eslint.lintText(code, {
      filePath: "src/shell/asset-boundary-fixture.ts",
    });
    assert(
      result!.messages.some((m) =>
        m.message.includes("Node-only asset delivery"),
      ),
      JSON.stringify(result!.messages),
    );
  }
});

test("strict profile and publication index: unknown keys, invalid hashes", () => {
  const profile = {
    schemaVersion: 1,
    id: "core",
    dependsOn: [],
    rules: [
      { root: "shared", path: "fonts", kind: "tree", logicalPath: "fonts" },
    ],
  };
  assert.deepEqual(parseAssetProfile(profile), profile);
  assert.deepEqual(parsePublicationInventory(emptyState), emptyState);
  assert.throws(
    () =>
      parseAssetProfile({
        ...profile,
        rules: [{ ...profile.rules[0], extra: 1 }],
      }),
    failure("ASSET_CONFIG_INVALID"),
  );
  assert.throws(
    () => parsePublicationInventory({ ...emptyState, extra: 1 }),
    failure("ASSET_CONFIG_INVALID"),
  );
  assert.throws(
    () =>
      parsePublicationInventory({
        ...emptyState,
        nightly: {
          key: `snapshots/${sha}.json`,
          bytes: 1,
          sha256: "b".repeat(64),
        },
      }),
    failure("ASSET_INTEGRITY_FAILED"),
  );
});

test("zip.js 2.13.1 streaming options fixture is STORE, DOS epoch, UTF-8, permission-free across TZ", () => {
  const results = ["UTC", "Pacific/Honolulu"].map((TZ) => {
    const res = spawnSync(
      process.execPath,
      ["tests/fixtures/asset-delivery-zip.ts"],
      { encoding: "utf8", env: { ...process.env, TZ } },
    );
    assert.equal(res.status, 0, res.stderr);
    return JSON.parse(res.stdout);
  });
  assert.deepEqual(results[0], results[1]);
  const zip = results[0];
  assert.equal(zip.method, 0);
  assert.equal(zip.rawLastModDate, 0x00210000);
  assert.equal(zip.utf8, true);
  assert.equal(zip.attributes, 0);
  assert.equal(zip.commentLength, 0);
  assert(zip.extras.every((id: number) => id === 1));
});

import {
  schemaFixtures,
  parserNames,
} from "./fixtures/asset-delivery-contracts.ts";

for (const [name, value] of Object.entries(schemaFixtures)) {
  test(`strict ${name}: exact schema, reject unknown keys and unsafe nested integers`, async () => {
    const module = await import(`../scripts/lib/asset-delivery/${name}.ts`);
    const parse = module[parserNames[name as keyof typeof schemaFixtures]] as (
      v: unknown,
    ) => unknown;
    assert.equal(typeof parse, "function");
    assert.deepEqual(parse(value), value);
    assert.throws(
      () => parse({ ...value, unknown: true }),
      failure("ASSET_CONFIG_INVALID"),
    );
    assert.throws(() => parse(null), failure("ASSET_CONFIG_INVALID"));
    const corrupt = (input: unknown): unknown => {
      if (Array.isArray(input)) return input.map(corrupt);
      if (input !== null && typeof input === "object")
        return Object.fromEntries(
          Object.entries(input).map(([key, item]) => [
            key,
            key === "bytes" ? Number.MAX_SAFE_INTEGER + 1 : corrupt(item),
          ]),
        );
      return input;
    };
    if (JSON.stringify(value).includes('"bytes":'))
      assert.throws(
        () => parse(corrupt(value)),
        failure("ASSET_CONFIG_INVALID"),
      );
  });
}

test("public npm setup boundary succeeds anonymously with fixture config; exact SDK pins", async (t) => {
  const root = await fixture(t);
  const pkg = JSON.parse(await readFile("package.json", "utf8"));
  for (const name of ["@aws-sdk/client-s3", "@aws-sdk/lib-storage"]) {
    assert.equal(pkg.devDependencies[name], "3.1128.0");
    assert.equal(pkg.dependencies[name], undefined);
  }
  assert.equal(pkg.dependencies["@zip.js/zip.js"], "2.13.1");
  await mkdir(path.join(root, "scripts"));
  await copyFile(
    "scripts/asset-delivery-setup.ts",
    path.join(root, "scripts/asset-delivery-setup.ts"),
  );
  await symlink(
    path.resolve("scripts/lib"),
    path.join(root, "scripts/lib"),
    process.platform === "win32" ? "junction" : "dir",
  );
  await writeFile(
    path.join(root, "asset-delivery.config.json"),
    JSON.stringify(config),
  );
  await writeFile(
    path.join(root, "package.json"),
    JSON.stringify({
      type: "module",
      scripts: { "assets:setup": pkg.scripts["assets:setup"] },
    }),
  );
  const result = spawnSync(
    process.platform === "win32" ? "npm.cmd" : "npm",
    ["run", "assets:setup", "--", "--check"],
    { cwd: root, encoding: "utf8", shell: process.platform === "win32" },
  );
  assert.equal(result.status, 0, result.stderr);
  assert.equal(
    JSON.parse(result.stdout.trim().split("\n").at(-1)!).status,
    "ok",
  );
  const command = spawnSync(
    process.execPath,
    [path.join(root, "scripts/asset-delivery-setup.ts"), "--check"],
    { cwd: root, encoding: "utf8" },
  );
  assert.equal(command.status, 0, command.stderr);
  assert.equal(JSON.parse(command.stdout).status, "ok");
  assert(
    command.stderr.includes("dev-download-needs-no-publisher-credentials"),
  );
  assert.deepEqual((await readdir(root)).sort(), [
    "asset-delivery.config.json",
    "package.json",
    "scripts",
  ]);
});

test("journal/path/inventory integrity rejects mismatched scopes, duplicate files, extra nested keys", async () => {
  const { parseInstallReceipt } =
    await import("../scripts/lib/asset-delivery/install-receipt.ts");
  const { parsePruneJournal } =
    await import("../scripts/lib/asset-delivery/prune-journal.ts");
  const { parseMigrationPlan } =
    await import("../scripts/lib/asset-delivery/migration-plan.ts");
  const { parseDevManifest } =
    await import("../scripts/lib/asset-delivery/dev-manifest.ts");
  const receipt = schemaFixtures["install-receipt"];
  assert.throws(
    () => parseInstallReceipt({ ...receipt, retired: receipt.files }),
    failure("ASSET_PATH_UNSAFE"),
  );
  assert.throws(
    () => parseInstallReceipt({ ...receipt, layoutVersion: 2 }),
    failure("ASSET_LAYOUT_INCOMPATIBLE"),
  );
  const journal = schemaFixtures["prune-journal"];
  for (const value of [
    { ...journal, nextState: emptyState },
    { ...journal, completedPaths: [receipt.files[0]!.path] },
    { ...journal, phase: "committed" },
    { ...journal, intentPaths: ["assets/story/unplanned.psd"] },
  ])
    assert.throws(
      () => parsePruneJournal(value),
      failure("ASSET_CONFIG_INVALID"),
    );
  const migration = schemaFixtures["migration-plan"];
  assert.throws(
    () =>
      parseMigrationPlan({
        ...migration,
        files: [{ ...migration.files[0], to: "assets/battle/stolen.woff2" }],
      }),
    failure("ASSET_PATH_UNSAFE"),
  );
  const dev = schemaFixtures["dev-manifest"];
  assert.throws(
    () => parseDevManifest({ ...dev, files: [{ ...dev.files[0], extra: 1 }] }),
    failure("ASSET_CONFIG_INVALID"),
  );
  assert.throws(
    () =>
      parseDevManifest({
        ...dev,
        files: [{ ...dev.files[0], bytes: 16 * 1024 ** 3 + 1 }],
      }),
    failure("ASSET_LIMIT_EXCEEDED"),
  );
});

test("remote origins explicit, exact, bounded; CORS denial fails closed", async () => {
  const { parseSetupOptions } =
    await import("../scripts/lib/asset-delivery/setup-options.ts");
  assert.deepEqual(
    parseSetupOptions([
      "--check",
      "--remote",
      "--origin",
      "http://localhost:5173",
      "--origin",
      "https://app.example/",
    ]),
    {
      help: false,
      remote: true,
      origins: ["http://localhost:5173", "https://app.example"],
    },
  );
  for (const origin of [
    "*",
    "https://app.example/path",
    "https://app.example?x",
    "https://app.example#x",
    "https://u:p@app.example",
    "http://app.example",
    "https://*.example",
  ])
    assert.throws(
      () => parseSetupOptions(["--remote", "--origin", origin]),
      failure("ASSET_ARGUMENT_INVALID"),
    );
  assert.throws(
    () =>
      parseSetupOptions([
        "--remote",
        "--origin",
        "https://app.example",
        "--origin",
        "https://app.example/",
      ]),
    failure("ASSET_ARGUMENT_INVALID"),
  );
  await assert.rejects(
    probeAssetSetup(
      parseAssetDeliveryConfig(config),
      ["https://app.example"],
      async (_input, init = {}) =>
        new Response(
          init.method === "HEAD" ? null : JSON.stringify(emptyState),
        ),
      async () => ({}),
    ),
    failure("ASSET_CONFIG_INVALID"),
  );
});

test("schema-defined sorted sets reject permutations without reordering arbitrary arrays", async () => {
  const { parsePreparedPlayerMetadata } =
    await import("../scripts/lib/asset-delivery/prepared-player-metadata.ts");
  const { parseBundleSnapshot } =
    await import("../scripts/lib/asset-delivery/bundle-snapshot.ts");
  const { parseRetainedMetadata } =
    await import("../scripts/lib/asset-delivery/retained-metadata.ts");
  const { parseMigrationPlan } =
    await import("../scripts/lib/asset-delivery/migration-plan.ts");
  const { parsePrunePlan } =
    await import("../scripts/lib/asset-delivery/prune-plan.ts");
  const prepared = schemaFixtures["prepared-player-metadata"];
  const chapter = prepared.chapters[0]!;
  const valid = {
    ...prepared,
    runtimeCardCodes: [2, 10],
    chapters: [
      {
        ...chapter,
        cardCodes: [2, 10],
        setIds: ["\ue000", "𐀀"],
        opponentIds: ["a", "b"],
      },
    ],
  };
  assert.deepEqual(parsePreparedPlayerMetadata(valid), valid);
  for (const invalid of [
    { ...valid, runtimeCardCodes: [10, 2] },
    ...["cardCodes", "setIds", "opponentIds"].map((key) => ({
      ...valid,
      chapters: [
        {
          ...valid.chapters[0],
          [key]: [
            ...valid.chapters[0]![
              key as "cardCodes" | "setIds" | "opponentIds"
            ],
          ].reverse(),
        },
      ],
    })),
  ])
    assert.throws(
      () => parsePreparedPlayerMetadata(invalid),
      failure("ASSET_CONFIG_INVALID"),
    );
  const snapshot = schemaFixtures["bundle-snapshot"];
  const reversed = { ...snapshot, objects: [...snapshot.objects].reverse() };
  assert.throws(
    () => parseBundleSnapshot(reversed),
    failure("ASSET_CONFIG_INVALID"),
  );
  assert.deepEqual(reversed.objects, [...snapshot.objects].reverse());

  const hashes = ["a".repeat(64), "b".repeat(64)];
  const catalogs = hashes.map((sha256) => ({ sha256, bytes: 1 }));
  const manifests = hashes.flatMap((sha256) =>
    ["chapter-01", "runtime"].map((packId) => ({ packId, sha256, bytes: 1 })),
  );
  const retained = { schemaVersion: 1, catalogs, manifests };
  assert.deepEqual(parseRetainedMetadata(retained), retained);
  assert.throws(
    () =>
      parseRetainedMetadata({ ...retained, catalogs: [...catalogs].reverse() }),
    failure("ASSET_CONFIG_INVALID"),
  );
  assert.throws(
    () =>
      parseRetainedMetadata({
        ...retained,
        manifests: [...manifests].reverse(),
      }),
    failure("ASSET_CONFIG_INVALID"),
  );

  const rules = ["a", "b"].map((path) => ({
    root: "story",
    path,
    kind: "file",
    logicalPath: `story/${path}`,
  }));
  const profile = { schemaVersion: 1, id: "core", dependsOn: [], rules };
  assert.deepEqual(parseAssetProfile(profile), profile);
  assert.deepEqual(
    parseAssetProfile({ ...profile, rules: [rules[0], rules[0], rules[1]] }),
    profile,
  );
  assert.throws(
    () => parseAssetProfile({ ...profile, rules: [...rules].reverse() }),
    failure("ASSET_CONFIG_INVALID"),
  );
  const migration = {
    schemaVersion: 1,
    files: ["a", "b"].map((name) => ({
      from: `src/story/assets/${name}.svg`,
      to: `assets/story/${name}.svg`,
      bytes: 1,
      sha256: sha,
    })),
  };
  assert.deepEqual(parseMigrationPlan(migration), migration);
  assert.throws(
    () =>
      parseMigrationPlan({
        ...migration,
        files: [...migration.files].reverse(),
      }),
    failure("ASSET_CONFIG_INVALID"),
  );
  const prune = {
    schemaVersion: 1,
    scope: "local",
    basisSha256: sha,
    candidates: ["a", "b"].map((name) => ({
      path: `assets/story/${name}.psd`,
      bytes: 1,
      sha256: sha,
    })),
  };
  assert.deepEqual(parsePrunePlan(prune), prune);
  assert.throws(
    () =>
      parsePrunePlan({ ...prune, candidates: [...prune.candidates].reverse() }),
    failure("ASSET_CONFIG_INVALID"),
  );
  assert.equal(
    Buffer.from(canonicalBytes([2, 1, "b", "a"])).toString(),
    '[2,1,"b","a"]\n',
  );
  assert(compareCodePoints("\ue000", "𐀀") < 0);
});

test("caseless Unicode collision checks include capital sharp-S and normalized parent aliases", () => {
  for (const paths of [
    ["straße.psd", "STRAẞE.psd"],
    ["straße.psd", "STRASSE.psd"],
    ["café/straße.psd", "cafe\u0301/STRAẞE.psd"],
    ["straße/a.psd", "STRAẞE/b.psd"],
    ["straẞe", "STRASSE/b.psd"],
    ["σ.psd", "ς.psd"],
  ]) {
    assert.throws(
      () => assertNoPathCollisions(paths),
      failure("ASSET_PATH_UNSAFE"),
    );
    assert.throws(
      () => assertNoPathCollisions([...paths].reverse()),
      failure("ASSET_PATH_UNSAFE"),
    );
  }
  assertNoPathCollisions([
    "straße/a.psd",
    "straße/b.psd",
    "café.psd",
    "cafe.psd",
  ]);
});

test("lock ENOSPC at mkdir/open/write/sync is expected disk-full; handles close and residue remains busy", async (t) => {
  for (const stage of ["mkdir", "open", "writeFile", "sync"] as const) {
    await t.test(stage, async (t) => {
      const root = await fixture(t);
      const originalOpen = fs.open;
      const diskFull = () =>
        Object.assign(new Error("injected disk-full"), { code: "ENOSPC" });
      let opened: Awaited<ReturnType<typeof fs.open>> | undefined;
      let closed = 0;
      const injected =
        stage === "mkdir"
          ? t.mock.method(fs, "mkdir", async () => {
              throw diskFull();
            })
          : t.mock.method(
              fs,
              "open",
              async (...args: Parameters<typeof fs.open>) => {
                if (stage === "open") throw diskFull();
                const handle = await originalOpen(...args);
                opened = handle;
                const close = handle.close.bind(handle);
                t.mock.method(handle, "close", async () => {
                  closed++;
                  await close();
                });
                t.mock.method(handle, stage, async () => {
                  throw diskFull();
                });
                return handle;
              },
            );
      syncBuiltinESMExports();
      try {
        await assert.rejects(
          acquireAssetDeliveryLock(root),
          (error: unknown) => {
            assert.deepEqual(failureResult(error), {
              result: { status: "failed", code: "ASSET_DISK_FULL", path: null },
              exitCode: 2,
            });
            return true;
          },
        );
      } finally {
        injected.mock.restore();
        syncBuiltinESMExports();
      }
      if (stage === "writeFile" || stage === "sync") {
        assert.equal(closed, 1);
        assert.equal(opened!.fd, -1);
        assert(
          (
            await fs.lstat(path.join(root, "generated/.locks/asset-delivery"))
          ).isFile(),
        );
        await assert.rejects(
          acquireAssetDeliveryLock(root),
          failure("ASSET_BUSY"),
        );
      } else {
        assert.equal(closed, 0);
        await assert.rejects(
          fs.lstat(path.join(root, "generated/.locks/asset-delivery")),
          { code: "ENOENT" },
        );
      }
    });
  }
});

test("lock release ENOSPC preserves ownership for successful retry", async (t) => {
  const root = await fixture(t);
  const release = await acquireAssetDeliveryLock(root);
  const injected = t.mock.method(fs, "unlink", async () => {
    throw Object.assign(new Error("injected disk-full"), { code: "ENOSPC" });
  });
  syncBuiltinESMExports();
  try {
    await assert.rejects(release(), (error: unknown) => {
      assert.deepEqual(failureResult(error), {
        result: { status: "failed", code: "ASSET_DISK_FULL", path: null },
        exitCode: 2,
      });
      return true;
    });
  } finally {
    injected.mock.restore();
    syncBuiltinESMExports();
  }
  await assert.rejects(acquireAssetDeliveryLock(root), failure("ASSET_BUSY"));
  await release();
  const nextRelease = await acquireAssetDeliveryLock(root);
  await nextRelease();
});

test("remote metadata failures stop probes; oversized responses cancel before further pulls", async (t) => {
  for (const kind of [
    "declared",
    "streamed",
    "utf8",
    "json",
    "unknown-key",
  ] as const) {
    await t.test(kind, async () => {
      const methods: string[] = [];
      let pulls = 0;
      let cancels = 0;
      const chunk =
        kind === "streamed"
          ? new Uint8Array(1024 * 1024)
          : kind === "utf8"
            ? new Uint8Array([0xff])
            : new TextEncoder().encode(
                kind === "json"
                  ? '{"schemaVersion":'
                  : JSON.stringify({ ...emptyState, unknown: true }),
              );
      const body = new ReadableStream<Uint8Array>(
        {
          pull(controller) {
            pulls++;
            if ((kind === "streamed" && pulls <= 34) || pulls === 1)
              controller.enqueue(chunk);
            else controller.close();
          },
          cancel() {
            cancels++;
          },
        },
        { highWaterMark: 0 },
      );
      const fetcher: typeof fetch = async (_url, init = {}) => {
        methods.push(init.method!);
        if (init.method === "HEAD") return new Response(null);
        return new Response(body, {
          headers:
            kind === "declared"
              ? { "content-length": String(MAX_METADATA_BYTES + 1) }
              : {},
        });
      };
      await assert.rejects(
        probeAssetSetup(
          parseAssetDeliveryConfig(config),
          ["https://app.example", "https://second.example"],
          fetcher,
          async () => ({}),
        ),
        failure(
          kind === "declared" || kind === "streamed"
            ? "ASSET_LIMIT_EXCEEDED"
            : "ASSET_CONFIG_INVALID",
        ),
      );
      assert.deepEqual(methods, ["HEAD", "GET"]);
      assert.equal(body.locked, false);
      assert.equal(cancels, kind === "declared" || kind === "streamed" ? 1 : 0);
      assert.equal(
        pulls,
        kind === "declared" ? 0 : kind === "streamed" ? 33 : 2,
      );
    });
  }
});

test("metadata and argv boundaries reject malformed bytes and >10 origins before I/O", async () => {
  for (const bytes of [new Uint8Array([0xff]), new TextEncoder().encode("{")])
    assert.throws(() => parseJsonBytes(bytes), failure("ASSET_CONFIG_INVALID"));
  assert.throws(
    () => parseJsonBytes(new Uint8Array(MAX_METADATA_BYTES + 1)),
    failure("ASSET_LIMIT_EXCEEDED"),
  );
  const origins = Array.from(
    { length: 11 },
    (_, i) => `https://app${i}.example`,
  );
  const { parseSetupOptions } =
    await import("../scripts/lib/asset-delivery/setup-options.ts");
  const args = [
    "--remote",
    ...origins.flatMap((origin) => ["--origin", origin]),
  ];
  assert.throws(
    () => parseSetupOptions(args),
    failure("ASSET_ARGUMENT_INVALID"),
  );
  const stdout: string[] = [];
  const stderr: string[] = [];
  assert.equal(
    await runAssetSetup(
      ".",
      args,
      {},
      (line) => stdout.push(line),
      (line) => stderr.push(line),
    ),
    2,
  );
  assert.deepEqual(JSON.parse(stdout[0]!), {
    status: "failed",
    code: "ASSET_ARGUMENT_INVALID",
    path: null,
  });
  assert.deepEqual(stderr, []);
  let io = 0;
  await assert.rejects(
    probeAssetSetup(
      parseAssetDeliveryConfig(config),
      origins,
      async () => {
        io++;
        return new Response(null);
      },
      async () => {
        io++;
        return {};
      },
    ),
    failure("ASSET_ARGUMENT_INVALID"),
  );
  assert.equal(io, 0);
});

test("canonical cumulative budget rejects wide metadata before oversized joins or UTF-8 output allocation", (t) => {
  let encodes = 0;
  let maxJoinBytes = 0;
  const originalEncode = TextEncoder.prototype.encode;
  t.mock.method(
    TextEncoder.prototype,
    "encode",
    function (this: TextEncoder, input?: string) {
      encodes++;
      return originalEncode.call(this, input);
    },
  );
  const joinDescriptor = Object.getOwnPropertyDescriptor(
    Array.prototype,
    "join",
  )!;
  t.after(() => Object.defineProperty(Array.prototype, "join", joinDescriptor));
  Object.defineProperty(Array.prototype, "join", {
    ...joinDescriptor,
    value: new Proxy(Array.prototype.join, {
      apply(target, receiver, args) {
        const joined = Reflect.apply(target, receiver, args) as string;
        maxJoinBytes = Math.max(maxJoinBytes, Buffer.byteLength(joined));
        return joined;
      },
    }),
  });
  assert.throws(
    () => canonicalBytes(Array(100_000).fill("x".repeat(512))),
    failure("ASSET_LIMIT_EXCEEDED"),
  );
  assert.equal(encodes, 0);
  assert(maxJoinBytes <= MAX_METADATA_BYTES, `oversized join: ${maxJoinBytes}`);
});

test("canonical single-string budget accounts for UTF-8 and JSON escaping before stringify", async (t) => {
  for (const [character, count] of [
    ["x", MAX_METADATA_BYTES],
    ["é", MAX_METADATA_BYTES / 2],
    ["𐀀", MAX_METADATA_BYTES / 4],
    ["\u0001", Math.ceil(MAX_METADATA_BYTES / 6)],
    ['"', MAX_METADATA_BYTES / 2],
  ] as const) {
    await t.test(JSON.stringify(character), (t) => {
      const value = character.repeat(count);
      let stringified = false;
      t.mock.method(
        JSON,
        "stringify",
        new Proxy(JSON.stringify, {
          apply(target, receiver, args) {
            if (args[0] === value) stringified = true;
            return Reflect.apply(target, receiver, args);
          },
        }),
      );
      assert.throws(
        () => canonicalBytes(value),
        failure("ASSET_LIMIT_EXCEEDED"),
      );
      assert.equal(stringified, false);
    });
  }
});

test("canonical exact byte cap includes delimiters/LF; escaping and Unicode bytes stay exact", () => {
  const bytes = canonicalBytes("x".repeat(MAX_METADATA_BYTES - 3));
  assert.equal(bytes.length, MAX_METADATA_BYTES);
  assert.equal(bytes[0], 0x22);
  assert.equal(bytes.at(-2), 0x22);
  assert.equal(bytes.at(-1), 0x0a);
  assert.throws(
    () => canonicalBytes("x".repeat(MAX_METADATA_BYTES - 2)),
    failure("ASSET_LIMIT_EXCEEDED"),
  );
  const small = {
    a: [null, true, false, -0, 0.5, '\u0000\b\t\n\f\r"\\é𐀀'],
    b: { "\ue000": 1, "𐀀": 2 },
  };
  assert.equal(
    Buffer.from(canonicalBytes(small)).toString(),
    `${JSON.stringify(small)}\n`,
  );
});
