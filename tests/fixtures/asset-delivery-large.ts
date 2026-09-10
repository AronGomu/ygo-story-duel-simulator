/** Owner-run only. Creates a NEW root; writes 5x input bytes across two dev runs.
 * node tests/fixtures/asset-delivery-large.ts --directory /approved-disk/new-fixture --bytes 4294967297
 * 10 GiB input: --bytes 10737418240 (requires >= 50.5 GiB free).
 * No downloads, sparse files, mocked counters, asset deletion or automatic cleanup.
 */
import assert from "node:assert/strict";
import { mkdir, open, statfs, readFile } from "node:fs/promises";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { bundleAssets } from "../../scripts/lib/asset-delivery/bundle.ts";
import { verifyBundle } from "../../scripts/lib/asset-delivery/verify-bundle.ts";
import { EMPTY_RETAINED_METADATA } from "../../scripts/lib/asset-delivery/scan-assets.ts";
import { canonicalBytes } from "../../scripts/lib/asset-delivery/canonical-json.ts";
import { parseFlags } from "../../scripts/lib/asset-delivery/cli.ts";
import { assertSafeParents } from "../../scripts/lib/asset-delivery/path-guards.ts";

const flags = parseFlags(
  process.argv.slice(2),
  ["--help"],
  ["--directory", "--bytes"],
);
if (flags.has("--help")) {
  console.log(
    "Owner-run: node tests/fixtures/asset-delivery-large.ts --directory <new-root-on-approved-disk> --bytes 4294967297|10737418240; needs 5x input bytes + 512 MiB free. Keeps all output; never deletes assets.",
  );
} else {
  assert.equal(typeof flags.get("--directory"), "string");
  const bytes = Number(flags.get("--bytes"));
  assert(
    [4294967297, 10737418240].includes(bytes),
    "Choose real >4 GiB or 10 GiB fixture size",
  );
  const root = path.resolve(flags.get("--directory") as string);
  const parent = path.dirname(root);
  await assertSafeParents(parent, path.basename(root));
  const disk = await statfs(parent, { bigint: true });
  const required = BigInt(bytes) * 5n + 512n * 1024n * 1024n;
  assert(
    disk.bavail * disk.bsize >= required,
    `Requires ${required} free bytes`,
  );
  await mkdir(root, { mode: 0o700 });
  await mkdir(path.join(root, "assets/battle"), { recursive: true });
  await mkdir(path.join(root, "asset-profiles"));
  const write = async (file: string, value: unknown) => {
    const handle = await open(path.join(root, file), "wx");
    try {
      await handle.writeFile(canonicalBytes(value));
    } finally {
      await handle.close();
    }
  };
  await write("package.json", { version: "0.1.0" });
  for (const id of ["core", "runtime", "chapter-01"])
    await write(`asset-profiles/${id}.json`, {
      schemaVersion: 1,
      id,
      dependsOn: id === "chapter-01" ? ["runtime"] : [],
      rules: [],
    });
  await write("asset-profiles/nightly.json", {
    schemaVersion: 1,
    profiles: ["core", "runtime", "chapter-01"],
  });
  const started = performance.now();
  const file = await open(
    path.join(root, "assets/battle/large-original.blend"),
    "wx",
  );
  try {
    const chunk = Buffer.alloc(256 * 1024);
    for (let i = 0; i < chunk.length; i++) chunk[i] = (i * 17 + 29) & 255;
    for (let written = 0; written < bytes; written += chunk.length)
      await file.writeFile(
        chunk.subarray(0, Math.min(chunk.length, bytes - written)),
      );
    await file.sync();
  } finally {
    await file.close();
  }
  process.env.TZ = "Pacific/Honolulu";
  const first = await bundleAssets(
    root,
    "dev",
    { kind: "nightly" },
    EMPTY_RETAINED_METADATA,
    null,
  );
  const runA = JSON.parse(
    await readFile(
      path.join(root, "generated/asset-delivery/current.json"),
      "utf8",
    ),
  );
  process.env.TZ = "Asia/Tokyo";
  const second = await bundleAssets(
    root,
    "dev",
    { kind: "release", version: "0.1.0" },
    EMPTY_RETAINED_METADATA,
    null,
  );
  const runB = JSON.parse(
    await readFile(
      path.join(root, "generated/asset-delivery/current.json"),
      "utf8",
    ),
  );
  assert.deepEqual(first, second);
  await verifyBundle(root, runA.run);
  await verifyBundle(root, runB.run);
  console.log(
    JSON.stringify({
      status: "ok",
      sourceBytes: bytes,
      requiredDiskBytes: required.toString(),
      elapsedSeconds: (performance.now() - started) / 1000,
      peakRssKiB: process.resourceUsage().maxRSS,
      runA,
      runB,
      archive: first.objects.find((r) => r.key.startsWith("dev/archives/")),
      zip64Proof:
        "real >4 GiB original, exact SHA/CRC/content closure verified twice",
      rootsRetained: root,
    }),
  );
}
