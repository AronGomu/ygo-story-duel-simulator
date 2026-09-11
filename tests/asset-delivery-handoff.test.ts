import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { cp, mkdir, readFile, rm, unlink, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { once } from "node:events";
import path from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { ZipReader, Uint8ArrayReader, Uint8ArrayWriter } from "@zip.js/zip.js";
import { bundleAssets } from "../scripts/lib/asset-delivery/bundle.ts";
import { canonicalBytes } from "../scripts/lib/asset-delivery/canonical-json.ts";
import type { DownloadDependencies } from "../scripts/lib/asset-delivery/download.ts";
import { downloadAssets } from "../scripts/lib/asset-delivery/download.ts";
import { AssetDeliveryError } from "../scripts/lib/asset-delivery/failure.ts";
import {
  applyLocalPrune,
  previewLocalPrune,
} from "../scripts/lib/asset-delivery/local-prune.ts";
import type { ObjectRef } from "../scripts/lib/asset-delivery/object-ref.ts";
import { promoteAssets } from "../scripts/lib/asset-delivery/promote.ts";
import { EMPTY_RETAINED_METADATA } from "../scripts/lib/asset-delivery/scan-assets.ts";
import { stageCoreAssets } from "../scripts/lib/asset-delivery/stage-core-assets.ts";
import {
  contentObjectUrl,
  parseContentIndex,
  parseContentManifest,
  type ContentFailureCode,
  type ContentIndex,
  type ContentManifest,
} from "../src/content/index.ts";
import {
  current,
  fixture,
  prepared,
  put,
  sha,
} from "./fixtures/asset-delivery-bundle.ts";

const CONTENT_BASE_URL = "https://assets.example/ascencio-assets/v1/";
const APP_ORIGIN = "https://app.example";
const REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const CLI_ADAPTER = path.join(
  REPO_ROOT,
  "tests/fixtures/asset-delivery-cli-adapter.ts",
);
const FETCH_REGISTER = pathToFileURL(
  path.join(REPO_ROOT, "tests/fixtures/asset-delivery-fetch-register.ts"),
).href;
const roots: string[] = [];

test.after(async () => {
  for (const root of roots) await rm(root, { recursive: true, force: true });
});

async function destination(): Promise<string> {
  const base = path.resolve(".tmp/asset-handoff");
  await mkdir(base, { recursive: true });
  const root = path.join(base, randomUUID());
  roots.push(root);
  await mkdir(root, { recursive: true });
  await put(root, "package.json", '{"version":"0.1.0"}');
  await put(
    root,
    "asset-delivery.config.json",
    canonicalBytes({
      schemaVersion: 1,
      publicBaseUrl: CONTENT_BASE_URL,
      bucket: "fixture-assets",
      keyPrefix: "ascencio-assets/v1/",
    }),
  );
  return root;
}

interface CliInvocation {
  readonly status: number;
  readonly stdout: string;
  readonly stderr: string;
  readonly result: Record<string, unknown>;
}

async function installPublicCli(root: string): Promise<void> {
  await cp(path.join(REPO_ROOT, "scripts"), path.join(root, "scripts"), {
    recursive: true,
  });
  await cp(
    path.join(REPO_ROOT, "src/content"),
    path.join(root, "src/content"),
    { recursive: true },
  );
  const project = JSON.parse(
    await readFile(path.join(REPO_ROOT, "package.json"), "utf8"),
  ) as { readonly scripts: Readonly<Record<string, string>> };
  const names = [
    "assets:bundle",
    "assets:download",
    "assets:promote",
    "assets:prune",
    "content:verify",
  ] as const;
  const scripts = Object.fromEntries(
    names.map((name) => [name, project.scripts[name]]),
  );
  await put(
    root,
    "package.json",
    canonicalBytes({
      name: "asset-delivery-public-cli-fixture",
      version: "0.1.0",
      private: true,
      type: "module",
      scripts: {
        ...scripts,
        "assets:fixture:publish": `node "${CLI_ADAPTER}" publish`,
        "assets:fixture:verify": `node "${CLI_ADAPTER}" verify-installed`,
      },
    }),
  );
}

async function runNpm(
  root: string,
  script: string,
  args: readonly string[] = [],
  environment: Readonly<Record<string, string>> = {},
): Promise<CliInvocation> {
  const command = process.platform === "win32" ? "npm.cmd" : "npm";
  const child = spawn(command, ["run", script, "--", ...args], {
    cwd: root,
    env: { ...process.env, ...environment },
    shell: process.platform === "win32",
  });
  let stdout = "";
  let stderr = "";
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk: string) => (stdout += chunk));
  child.stderr.on("data", (chunk: string) => (stderr += chunk));
  const [status] = (await once(child, "close")) as [number];
  const line = stdout.trim().split(/\r?\n/).filter(Boolean).at(-1);
  assert(line, `${script}: missing stdout\n${stderr}`);
  return {
    status,
    stdout,
    stderr,
    result: JSON.parse(line) as Record<string, unknown>,
  };
}

interface FixturePublication {
  readonly objects: Map<string, Uint8Array>;
  readonly fetcher: typeof fetch;
  nightly: ObjectRef;
}

async function publication(source: string): Promise<FixturePublication> {
  const objects = new Map<string, Uint8Array>();
  const result: FixturePublication = {
    objects,
    nightly: {
      key: `snapshots/${"0".repeat(64)}.json`,
      bytes: 0,
      sha256: "0".repeat(64),
    },
    fetcher: async (input, init) => {
      const url = new URL(String(input));
      const key = url.pathname.replace("/ascencio-assets/v1/", "");
      const bytes =
        key === "channels/index.json"
          ? canonicalBytes({
              schemaVersion: 1,
              nightly: result.nightly,
              releases: [],
              retiredNightlies: [],
            })
          : objects.get(key);
      if (!bytes) return new Response(null, { status: 404 });
      const range = new Headers(init?.headers).get("range");
      const headers = {
        "accept-ranges": "bytes",
        "cache-control":
          key === "channels/index.json"
            ? "no-store"
            : "public,max-age=31536000,immutable",
        etag: `"${sha(bytes)}"`,
      };
      if (range) {
        const match = /^bytes=(\d+)-$/.exec(range);
        assert(match);
        const offset = Number(match[1]);
        const body = bytes.subarray(offset);
        return new Response(Buffer.from(body), {
          status: 206,
          headers: {
            ...headers,
            "content-length": String(body.byteLength),
            "content-range": `bytes ${offset}-${bytes.byteLength - 1}/${bytes.byteLength}`,
          },
        });
      }
      return new Response(Buffer.from(bytes), {
        status: 200,
        headers: { ...headers, "content-length": String(bytes.byteLength) },
      });
    },
  };
  await publishFixture(source, result);
  return result;
}

async function publishFixture(
  source: string,
  remote: FixturePublication,
): Promise<void> {
  const pointer = await current(source);
  const snapshot = JSON.parse(
    await readFile(
      path.join(source, pointer.run, "objects", pointer.snapshot.key),
      "utf8",
    ),
  ) as { readonly objects: readonly ObjectRef[] };
  for (const ref of [pointer.snapshot, ...snapshot.objects])
    remote.objects.set(
      ref.key,
      await readFile(path.join(source, pointer.run, "objects", ref.key)),
    );
  remote.nightly = pointer.snapshot;
}

const dependencies = (fetcher: typeof fetch): DownloadDependencies => ({
  fetcher,
  sleep: async () => undefined,
});

function failureCode(error: unknown): string | null {
  return error instanceof AssetDeliveryError ? error.code : null;
}

async function receiveContentObject(
  url: string,
  expectedSha256: string,
  kind: "indexes" | "manifests" | "parts",
  fetcher: typeof fetch,
): Promise<
  | { readonly kind: "ok"; readonly bytes: Uint8Array; readonly value: unknown }
  | { readonly kind: "failed"; readonly code: ContentFailureCode }
> {
  let response: Response;
  try {
    response = await fetcher(url, {
      cache: "no-store",
      credentials: "omit",
      redirect: "error",
      headers: { origin: APP_ORIGIN },
    });
  } catch {
    return { kind: "failed", code: "CONTENT_NETWORK_FAILED" };
  }
  if (response.status === 404 || response.status === 410)
    return { kind: "failed", code: "CONTENT_REVISION_UNAVAILABLE" };
  if (
    !response.ok ||
    response.redirected ||
    response.headers.get("access-control-allow-origin") !== APP_ORIGIN
  )
    return { kind: "failed", code: "CONTENT_NETWORK_FAILED" };
  const mediaType = response.headers.get("content-type")?.split(";", 1)[0];
  if (mediaType !== (kind === "parts" ? "application/zip" : "application/json"))
    return { kind: "failed", code: "CONTENT_NETWORK_FAILED" };
  const bytes = new Uint8Array(await response.arrayBuffer());
  const declared = response.headers.get("content-length");
  if (
    declared === null ||
    Number(declared) !== bytes.byteLength ||
    createHash("sha256").update(bytes).digest("hex") !== expectedSha256
  )
    return { kind: "failed", code: "CONTENT_INTEGRITY_FAILED" };
  if (kind === "parts") return { kind: "ok", bytes, value: null };
  let value: unknown;
  try {
    value = JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    return { kind: "failed", code: "CONTENT_INVALID_MANIFEST" };
  }
  const parsed =
    kind === "indexes" ? parseContentIndex(value) : parseContentManifest(value);
  if (parsed.kind === "failed") return parsed;
  return { kind: "ok", bytes, value: parsed.value };
}

test("public npm CLI fixture crosses publication, download, verify, update, conflict, and prune", async () => {
  const source = await fixture();
  const target = await destination();
  const remote = path.join(await destination(), "remote");
  await installPublicCli(source);
  await installPublicCli(target);
  await put(
    source,
    "generated/asset-delivery/prepared-player.json",
    canonicalBytes(prepared),
  );

  const firstBundle = await runNpm(source, "assets:bundle", [
    "--target",
    "all",
    "--empty-history",
  ]);
  assert.equal(firstBundle.status, 0, firstBundle.stderr);
  assert.deepEqual(firstBundle.result, {
    status: "ok",
    operation: "bundle",
    snapshotSha256:
      "ae616e74d641212d031da5fd92cf746e72cb95a1c3a855ef569cab4b66c41468",
  });
  assert.match(firstBundle.stderr, /"phase":"scan-freeze"/);

  const verifiedBundle = await runNpm(source, "content:verify");
  assert.equal(verifiedBundle.status, 0, verifiedBundle.stderr);
  assert.equal(
    verifiedBundle.result.snapshotSha256,
    firstBundle.result.snapshotSha256,
  );

  const firstPublish = await runNpm(source, "assets:fixture:publish", [
    "--remote",
    remote,
  ]);
  assert.equal(firstPublish.status, 0, firstPublish.stderr);
  assert.deepEqual(firstPublish.result, {
    status: "ok",
    operation: "publish",
    snapshotSha256: firstBundle.result.snapshotSha256,
  });
  assert.match(firstPublish.stderr, /"phase":"fixture-publication"/);
  const stateA = JSON.parse(
    await readFile(path.join(remote, "channels/index.json"), "utf8"),
  ) as { readonly nightly: ObjectRef };
  const snapshotABytes = await readFile(
    path.join(remote, ...stateA.nightly.key.split("/")),
  );
  const snapshotA = JSON.parse(snapshotABytes.toString()) as {
    readonly objects: readonly ObjectRef[];
  };
  assert.equal(
    snapshotA.objects.find((ref) => ref.key.startsWith("dev/archives/"))
      ?.sha256,
    "1b673300f738fec2d997d6467e25ade66255bad8df8f91f3d335866a5c1f73f7",
  );
  assert.equal(
    snapshotA.objects.find((ref) => ref.key.startsWith("core/archives/"))
      ?.sha256,
    "6a63e6b2812724fc8c4858e5967d484ad1a26c33dd63af502427bd4d2322b211",
  );

  const fetchEnvironment = {
    ASSET_DELIVERY_FIXTURE_REMOTE: remote,
    NODE_OPTIONS:
      `${process.env.NODE_OPTIONS ?? ""} --import=${FETCH_REGISTER}`.trim(),
  };
  const firstDownload = await runNpm(
    target,
    "assets:download",
    [],
    fetchEnvironment,
  );
  assert.equal(firstDownload.status, 0, firstDownload.stderr);
  assert.equal(firstDownload.result.snapshotSha256, stateA.nightly.sha256);
  const installed = await runNpm(target, "assets:fixture:verify");
  assert.equal(installed.status, 0, installed.stderr);
  assert.equal(installed.result.snapshotSha256, stateA.nightly.sha256);
  const rerun = await runNpm(target, "assets:download", [], fetchEnvironment);
  assert.equal(rerun.status, 0, rerun.stderr);
  assert.equal(rerun.result.snapshotSha256, stateA.nightly.sha256);

  await put(source, "assets/story/new.png", "new nightly bytes");
  await put(source, "release-assets.txt", "assets/story/new.png\n");
  const promotion = await runNpm(source, "assets:promote", [
    "--profile",
    "chapter-01",
    "--files-from",
    "release-assets.txt",
    "--apply",
  ]);
  assert.equal(promotion.status, 0, promotion.stderr);
  assert.match(
    promotion.stderr,
    /proposed:chapter-01:file:story\/media\/new\.png/,
  );
  await unlink(path.join(source, "assets/battle/original.blend"));

  const nextBundle = await runNpm(source, "assets:bundle", [
    "--target",
    "all",
    "--empty-history",
  ]);
  assert.equal(nextBundle.status, 0, nextBundle.stderr);
  assert.notEqual(
    nextBundle.result.snapshotSha256,
    firstBundle.result.snapshotSha256,
  );
  const nextPublish = await runNpm(source, "assets:fixture:publish", [
    "--remote",
    remote,
  ]);
  assert.equal(nextPublish.status, 0, nextPublish.stderr);
  assert.equal(
    nextPublish.result.snapshotSha256,
    nextBundle.result.snapshotSha256,
  );
  assert.deepEqual(
    await readFile(path.join(remote, ...stateA.nightly.key.split("/"))),
    snapshotABytes,
  );

  await writeFile(path.join(target, "assets/story/map.png"), "local conflict");
  const conflict = await runNpm(
    target,
    "assets:download",
    [],
    fetchEnvironment,
  );
  assert.equal(conflict.status, 2, conflict.stderr);
  assert.deepEqual(conflict.result, {
    status: "failed",
    code: "ASSET_LOCAL_CONFLICT",
    path: "assets/story/map.png",
  });
  await writeFile(
    path.join(target, "assets/story/map.png"),
    "deliberately-not-decodable-image",
  );
  const updated = await runNpm(target, "assets:download", [], fetchEnvironment);
  assert.equal(updated.status, 0, updated.stderr);
  assert.equal(updated.result.snapshotSha256, nextBundle.result.snapshotSha256);

  const prune = await runNpm(target, "assets:prune", ["--local"]);
  assert.equal(prune.status, 0, prune.stderr);
  const prunePlan = JSON.parse(
    await readFile(
      path.join(target, "generated/asset-delivery/prune-local.json"),
      "utf8",
    ),
  ) as { readonly candidates: readonly { readonly path: string }[] };
  assert.deepEqual(
    prunePlan.candidates.map((candidate) => candidate.path),
    ["assets/battle/original.blend"],
  );
  const applied = await runNpm(target, "assets:prune", [
    "--apply",
    "generated/asset-delivery/prune-local.json",
  ]);
  assert.equal(applied.status, 0, applied.stderr);
  await assert.rejects(
    readFile(path.join(target, "assets/battle/original.blend")),
    /ENOENT/,
  );
  const finalVerify = await runNpm(target, "assets:fixture:verify");
  assert.equal(finalVerify.status, 0, finalVerify.stderr);
});

test("isolated all-target handoff stages frozen core and survives dev add/remove/conflict/prune", async () => {
  const source = await fixture();
  const target = await destination();
  const first = await bundleAssets(
    source,
    "all",
    { kind: "nightly" },
    EMPTY_RETAINED_METADATA,
    prepared,
  );
  const remote = await publication(source);
  const firstObjects = new Map(
    [...remote.objects].map(([key, bytes]) => [key, bytes.slice()] as const),
  );
  assert.deepEqual(
    {
      snapshot: remote.nightly.sha256,
      devArchive: first.objects.find((ref) =>
        ref.key.startsWith("dev/archives/"),
      )?.sha256,
      coreArchive: first.objects.find((ref) =>
        ref.key.startsWith("core/archives/"),
      )?.sha256,
    },
    {
      snapshot:
        "ae616e74d641212d031da5fd92cf746e72cb95a1c3a855ef569cab4b66c41468",
      devArchive:
        "1b673300f738fec2d997d6467e25ade66255bad8df8f91f3d335866a5c1f73f7",
      coreArchive:
        "6a63e6b2812724fc8c4858e5967d484ad1a26c33dd63af502427bd4d2322b211",
    },
  );

  const plan = await stageCoreAssets(
    target,
    remote.nightly,
    dependencies(remote.fetcher),
  );
  assert.equal(plan.snapshot.sha256, remote.nightly.sha256);
  assert.equal(plan.prodInventory.sha256, first.prod!.inventory.sha256);
  assert.equal(plan.coreManifest.sha256, first.prod!.core.sha256);
  assert(plan.files.length > 0);
  for (const file of plan.files) {
    const bytes = await readFile(path.join(target, file.stagedPath));
    assert.equal(bytes.byteLength, file.bytes);
    assert.equal(sha(bytes), file.sha256);
  }
  assert.deepEqual(
    JSON.parse(
      await readFile(
        path.join(
          target,
          `generated/asset-delivery/core/${plan.coreManifest.sha256}/copy-plan.json`,
        ),
        "utf8",
      ),
    ),
    plan,
  );
  assert.deepEqual(
    await stageCoreAssets(target, remote.nightly, dependencies(remote.fetcher)),
    plan,
  );

  await downloadAssets(
    target,
    { kind: "nightly" },
    dependencies(remote.fetcher),
  );
  await downloadAssets(
    target,
    { kind: "nightly" },
    dependencies(remote.fetcher),
  );

  await put(source, "assets/story/new.png", "new nightly bytes");
  await put(source, "release-assets.txt", "assets/story/new.png\n");
  await promoteAssets(source, {
    profile: "chapter-01",
    filesFrom: "release-assets.txt",
    apply: true,
  });
  await unlink(path.join(source, "assets/battle/original.blend"));
  await bundleAssets(
    source,
    "all",
    { kind: "nightly" },
    EMPTY_RETAINED_METADATA,
    prepared,
  );
  await publishFixture(source, remote);
  for (const [key, bytes] of firstObjects)
    assert.deepEqual(remote.objects.get(key), bytes, key);

  await writeFile(path.join(target, "assets/story/map.png"), "local conflict");
  await assert.rejects(
    downloadAssets(target, { kind: "nightly" }, dependencies(remote.fetcher)),
    (error) => failureCode(error) === "ASSET_LOCAL_CONFLICT",
  );
  await writeFile(
    path.join(target, "assets/story/map.png"),
    "deliberately-not-decodable-image",
  );
  await downloadAssets(
    target,
    { kind: "nightly" },
    dependencies(remote.fetcher),
  );
  const prune = await previewLocalPrune(target);
  assert.deepEqual(
    prune.candidates.map((candidate) => candidate.path),
    ["assets/battle/original.blend"],
  );
  await applyLocalPrune(target, prune);
  await assert.rejects(
    readFile(path.join(target, "assets/battle/original.blend")),
    /ENOENT/,
  );
});

test("core staging fails closed for dev-only, missing, and corrupt published core", async () => {
  const devSource = await fixture();
  const devTarget = await destination();
  await bundleAssets(
    devSource,
    "dev",
    { kind: "nightly" },
    EMPTY_RETAINED_METADATA,
    null,
  );
  const devRemote = await publication(devSource);
  await assert.rejects(
    stageCoreAssets(
      devTarget,
      devRemote.nightly,
      dependencies(devRemote.fetcher),
    ),
    (error) => failureCode(error) === "ASSET_TARGET_UNAVAILABLE",
  );

  const prodSource = await fixture();
  const missingTarget = await destination();
  const snapshot = await bundleAssets(
    prodSource,
    "all",
    { kind: "nightly" },
    EMPTY_RETAINED_METADATA,
    prepared,
  );
  const remote = await publication(prodSource);
  const coreBytes = remote.objects.get(snapshot.prod!.core.key)!;
  remote.objects.delete(snapshot.prod!.core.key);
  await assert.rejects(
    stageCoreAssets(
      missingTarget,
      remote.nightly,
      dependencies(remote.fetcher),
    ),
    (error) => failureCode(error) === "ASSET_TARGET_UNAVAILABLE",
  );
  remote.objects.set(
    snapshot.prod!.core.key,
    Uint8Array.from(coreBytes, (byte, index) => (index ? byte : byte ^ 1)),
  );
  await assert.rejects(
    stageCoreAssets(
      await destination(),
      remote.nightly,
      dependencies(remote.fetcher),
    ),
    (error) => failureCode(error) === "ASSET_INTEGRITY_FAILED",
  );
});

test("release-A saved refs fetch exact retained bytes under distinct release-B fixture shell", async () => {
  const source = await fixture();
  const releaseA = await bundleAssets(
    source,
    "prod",
    { kind: "release", version: "0.1.0" },
    EMPTY_RETAINED_METADATA,
    prepared,
  );
  const runA = (await current(source)).run;
  const objectA = (ref: ObjectRef) =>
    path.join(source, runA, "objects", ...ref.key.split("/"));
  const indexABytes = await readFile(objectA(releaseA.prod!.index));
  const indexA = JSON.parse(indexABytes.toString()) as ContentIndex;
  const chapterA = indexA.chapters[0];
  assert(chapterA && chapterA.status === "published");
  const runtimeManifestARef: ObjectRef = {
    key: `content/manifests/${indexA.runtime.sha256}.json`,
    bytes: indexA.runtime.bytes,
    sha256: indexA.runtime.sha256,
  };
  const runtimeManifestABytes = await readFile(objectA(runtimeManifestARef));
  const runtimeManifestA = JSON.parse(
    runtimeManifestABytes.toString(),
  ) as ContentManifest;
  const partA = runtimeManifestA.parts[0]!;
  const partARef: ObjectRef = {
    key: `content/parts/${partA.sha256}.zip`,
    bytes: partA.bytes,
    sha256: partA.sha256,
  };
  const partABytes = await readFile(objectA(partARef));
  const savedA = {
    releaseId: indexA.releaseId,
    index: releaseA.prod!.index,
    runtime: indexA.runtime,
    chapter: chapterA.manifest,
  };
  const savedABytes = canonicalBytes(savedA);
  const retained = {
    schemaVersion: 1 as const,
    catalogs: [
      {
        sha256: releaseA.prod!.index.sha256,
        bytes: releaseA.prod!.index.bytes,
      },
    ],
    manifests: [indexA.runtime, chapterA.manifest].sort((left, right) =>
      left.sha256 < right.sha256 ? -1 : left.sha256 > right.sha256 ? 1 : 0,
    ),
  };
  await cp(
    path.join(source, runA, "objects"),
    path.join(source, "generated/asset-delivery/retained/objects"),
    { recursive: true },
  );

  const preparedB = { ...prepared, runtimeSnapshotId: "b".repeat(64) };
  await put(source, "package.json", '{"version":"0.2.0"}');
  await put(
    source,
    "assets/shared/runtime/manifest.json",
    '{"schemaVersion":1,"snapshotId":"' + "b".repeat(64) + '"}',
  );
  await put(source, "assets/story/map.png", "release-B art");
  const releaseB = await bundleAssets(
    source,
    "prod",
    { kind: "release", version: "0.2.0" },
    retained,
    preparedB,
  );
  const runB = (await current(source)).run;
  const indexB = JSON.parse(
    await readFile(
      path.join(source, runB, "objects", releaseB.prod!.index.key),
      "utf8",
    ),
  ) as ContentIndex;
  assert.notEqual(indexB.releaseId, indexA.releaseId);
  assert.notEqual(releaseB.prod!.index.sha256, releaseA.prod!.index.sha256);
  assert.notEqual(indexB.runtime.sha256, indexA.runtime.sha256);
  assert.notEqual(
    indexB.chapters[0]!.status === "published"
      ? indexB.chapters[0]!.manifest.sha256
      : null,
    chapterA.manifest.sha256,
  );
  assert(
    indexB.retainedCatalogs.some(
      (ref) => ref.sha256 === releaseA.prod!.index.sha256,
    ),
  );
  for (const ref of [indexA.runtime, chapterA.manifest])
    assert(
      indexB.retainedManifests.some(
        (retainedRef) => retainedRef.sha256 === ref.sha256,
      ),
    );
  assert.deepEqual(canonicalBytes(savedA), savedABytes);

  const remote = await publication(source);
  const contentFetcher: typeof fetch = async (input) => {
    const url = new URL(String(input));
    const key = url.pathname.replace("/ascencio-assets/v1/", "");
    const bytes = remote.objects.get(key);
    if (!bytes) return new Response(null, { status: 404 });
    return new Response(Buffer.from(bytes), {
      status: 200,
      headers: {
        "access-control-allow-origin": APP_ORIGIN,
        "content-length": String(bytes.byteLength),
        "content-type": key.endsWith(".zip")
          ? "application/zip"
          : "application/json",
      },
    });
  };
  const receivedIndexA = await receiveContentObject(
    contentObjectUrl(CONTENT_BASE_URL, "indexes", savedA.index.sha256),
    savedA.index.sha256,
    "indexes",
    contentFetcher,
  );
  assert.equal(receivedIndexA.kind, "ok");
  if (receivedIndexA.kind !== "ok") throw new Error("release-A index missing");
  assert(Buffer.from(receivedIndexA.bytes).equals(indexABytes));
  const resolvedIndexA = receivedIndexA.value as ContentIndex;
  assert.equal(resolvedIndexA.releaseId, savedA.releaseId);
  assert.deepEqual(resolvedIndexA.runtime, savedA.runtime);
  assert.deepEqual(resolvedIndexA.chapters[0], chapterA);

  const receivedManifestA = await receiveContentObject(
    contentObjectUrl(
      CONTENT_BASE_URL,
      "manifests",
      resolvedIndexA.runtime.sha256,
    ),
    resolvedIndexA.runtime.sha256,
    "manifests",
    contentFetcher,
  );
  assert.equal(receivedManifestA.kind, "ok");
  if (receivedManifestA.kind !== "ok")
    throw new Error("release-A manifest missing");
  assert(Buffer.from(receivedManifestA.bytes).equals(runtimeManifestABytes));
  const resolvedManifestA = receivedManifestA.value as ContentManifest;
  assert.deepEqual(resolvedManifestA.parts[0], partA);

  const receivedPartA = await receiveContentObject(
    contentObjectUrl(CONTENT_BASE_URL, "parts", partA.sha256),
    partA.sha256,
    "parts",
    contentFetcher,
  );
  assert.equal(receivedPartA.kind, "ok");
  if (receivedPartA.kind !== "ok") throw new Error("release-A part missing");
  assert(Buffer.from(receivedPartA.bytes).equals(partABytes));
  const reader = new ZipReader(new Uint8ArrayReader(receivedPartA.bytes));
  const entries = await reader.getEntries();
  const embedded = runtimeManifestA.files.find(
    (file) => file.path === "runtime/current/manifest.json",
  )!;
  const entry = entries.find(
    (candidate) => candidate.filename === embedded.entry,
  );
  assert(entry && !entry.directory);
  assert.deepEqual(
    await entry.getData(new Uint8ArrayWriter()),
    new TextEncoder().encode(
      '{"schemaVersion":1,"snapshotId":"' + "a".repeat(64) + '"}',
    ),
  );
  await reader.close();
});

test("cross-origin content receiver accepts exact index/manifest/part and maps hostile transport", async (t) => {
  const source = await fixture();
  const snapshot = await bundleAssets(
    source,
    "all",
    { kind: "nightly" },
    EMPTY_RETAINED_METADATA,
    prepared,
  );
  const remote = await publication(source);
  let cors = true;
  let redirect = false;
  let statusOverride: number | null = null;
  let tamper = false;
  let wrongLength = false;
  const server = createServer((request, response) => {
    if (redirect) {
      response.writeHead(302, { location: request.url ?? "/" });
      response.end();
      return;
    }
    const key = (request.url ?? "/").replace("/ascencio-assets/v1/", "");
    const original = remote.objects.get(key);
    const body =
      tamper && original
        ? Uint8Array.from(original, (byte, index) => (index ? byte : byte ^ 1))
        : original;
    if (!body || statusOverride !== null) {
      response.writeHead(
        statusOverride ?? 404,
        cors ? { "access-control-allow-origin": APP_ORIGIN } : {},
      );
      response.end();
      return;
    }
    response.writeHead(200, {
      "access-control-allow-origin": cors
        ? APP_ORIGIN
        : "https://wrong.example",
      "cache-control": "public,max-age=31536000,immutable",
      "content-length": wrongLength ? body.byteLength - 1 : body.byteLength,
      "content-type": key.endsWith(".zip")
        ? "application/zip"
        : "application/json",
    });
    response.end(body);
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => server.close());
  const address = server.address();
  assert(address && typeof address === "object");
  const fetcher: typeof fetch = (input, init) => {
    const original = new URL(String(input));
    return fetch(`http://127.0.0.1:${address.port}${original.pathname}`, init);
  };

  const indexUrl = contentObjectUrl(
    CONTENT_BASE_URL,
    "indexes",
    snapshot.prod!.index.sha256,
  );
  const indexResult = await receiveContentObject(
    indexUrl,
    snapshot.prod!.index.sha256,
    "indexes",
    fetcher,
  );
  assert.equal(indexResult.kind, "ok");
  if (indexResult.kind !== "ok") throw new Error("index receive failed");
  const index = indexResult.value as ContentIndex;
  const manifestUrl = contentObjectUrl(
    CONTENT_BASE_URL,
    "manifests",
    index.runtime.sha256,
  );
  const manifestResult = await receiveContentObject(
    manifestUrl,
    index.runtime.sha256,
    "manifests",
    fetcher,
  );
  assert.equal(manifestResult.kind, "ok");
  if (manifestResult.kind !== "ok") throw new Error("manifest receive failed");
  const manifest = manifestResult.value as ContentManifest;
  const part = manifest.parts[0]!;
  const partResult = await receiveContentObject(
    contentObjectUrl(CONTENT_BASE_URL, "parts", part.sha256),
    part.sha256,
    "parts",
    fetcher,
  );
  assert.equal(partResult.kind, "ok");
  if (partResult.kind !== "ok") throw new Error("part receive failed");
  const reader = new ZipReader(new Uint8ArrayReader(partResult.bytes));
  const entries = await reader.getEntries();
  const observed = entries[0]!;
  if (observed.directory) throw new Error("fixture file is a directory");
  const observedBytes = await observed.getData(new Uint8ArrayWriter());
  const expected = manifest.files.find(
    (file) => file.entry === observed.filename,
  )!;
  assert.equal(sha(observedBytes), expected.sha256);
  await reader.close();

  cors = false;
  assert.deepEqual(
    await receiveContentObject(
      indexUrl,
      snapshot.prod!.index.sha256,
      "indexes",
      fetcher,
    ),
    { kind: "failed", code: "CONTENT_NETWORK_FAILED" },
  );
  cors = true;
  redirect = true;
  assert.deepEqual(
    await receiveContentObject(
      indexUrl,
      snapshot.prod!.index.sha256,
      "indexes",
      fetcher,
    ),
    { kind: "failed", code: "CONTENT_NETWORK_FAILED" },
  );
  redirect = false;
  tamper = true;
  assert.deepEqual(
    await receiveContentObject(
      indexUrl,
      snapshot.prod!.index.sha256,
      "indexes",
      fetcher,
    ),
    { kind: "failed", code: "CONTENT_INTEGRITY_FAILED" },
  );
  tamper = false;
  wrongLength = true;
  assert.deepEqual(
    await receiveContentObject(
      indexUrl,
      snapshot.prod!.index.sha256,
      "indexes",
      fetcher,
    ),
    { kind: "failed", code: "CONTENT_INTEGRITY_FAILED" },
  );
  wrongLength = false;
  statusOverride = 410;
  assert.deepEqual(
    await receiveContentObject(
      indexUrl,
      snapshot.prod!.index.sha256,
      "indexes",
      fetcher,
    ),
    { kind: "failed", code: "CONTENT_REVISION_UNAVAILABLE" },
  );
});

test("build injects content transport constants without browser SDK imports", async () => {
  const config = await readFile("vite.config.ts", "utf8");
  const declarations = await readFile("src/vite-env.d.ts", "utf8");
  assert.match(config, /__CONTENT_BASE_URL__/);
  assert.match(config, /__CONTENT_INDEX_SHA256__/);
  assert.match(declarations, /declare const __CONTENT_BASE_URL__: string;/);
  assert.match(declarations, /declare const __CONTENT_INDEX_SHA256__: string;/);
  const contentFiles = [
    await readFile("src/content/index.ts", "utf8"),
    await readFile("src/content/content-object-url.ts", "utf8"),
  ].join("\n");
  assert.doesNotMatch(
    contentFiles,
    /@aws-sdk|scripts\/lib\/asset-delivery|node:/,
  );
});

test("old PWA tickets carry exact R2 handoff amendments", async () => {
  const tickets = await Promise.all(
    [
      "T2_chapter_packages.md",
      "T3_verified_installer.md",
      "T8_pwa_shell.md",
      "T9_pages_release.md",
      "T10_release_acceptance.md",
    ].map((name) =>
      readFile(
        path.join("artifacts/PLAN_2026_09_07_pwa_chapter_deployment", name),
        "utf8",
      ),
    ),
  );
  for (const ticket of tickets) {
    assert.match(ticket, /## Asset tooling handoff amendment/);
    assert.match(ticket, /\*\*Plan context:\*\* Self-contained historical/);
    assert.doesNotMatch(
      ticket,
      /\.\/artifacts\/PLAN_2026_09_07_pwa_chapter_deployment\.md/,
    );
  }
  assert.match(tickets[0]!, /new asset tooling T3/);
  assert.match(tickets[1]!, /contentObjectUrl/);
  assert.match(tickets[2]!, /CoreCopyPlan/);
  assert.match(tickets[2]!, /__CONTENT_BASE_URL__/);
  assert.match(tickets[3]!, /Pages serves core shell only/);
  assert.match(tickets[4]!, /cross-origin/);
  for (const ticket of tickets) assert.match(ticket, /chapter-01 only/);
});
