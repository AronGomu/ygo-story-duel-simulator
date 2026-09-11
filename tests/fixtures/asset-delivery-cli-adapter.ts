import { createHash } from "node:crypto";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { assetCli } from "../../scripts/lib/asset-delivery/cli.ts";
import { canonicalBytes } from "../../scripts/lib/asset-delivery/canonical-json.ts";
import { parseBundleSnapshot } from "../../scripts/lib/asset-delivery/bundle-snapshot.ts";
import { fail } from "../../scripts/lib/asset-delivery/failure.ts";
import { parseInstallReceipt } from "../../scripts/lib/asset-delivery/install-receipt.ts";
import {
  parseObjectRef,
  type ObjectRef,
} from "../../scripts/lib/asset-delivery/object-ref.ts";
import { parsePublicationInventory } from "../../scripts/lib/asset-delivery/publication-inventory.ts";

const root = process.cwd();
const command = process.argv[2];
const args = process.argv.slice(3);

function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function flag(name: string): string | undefined {
  const index = args.indexOf(name);
  if (index < 0) return undefined;
  const value = args[index + 1];
  if (!value || value.startsWith("--")) fail("ASSET_ARGUMENT_INVALID");
  return value;
}

function assertArgs(allowed: readonly string[]): void {
  for (let index = 0; index < args.length; index += 2) {
    if (!allowed.includes(args[index]!) || !args[index + 1])
      fail("ASSET_ARGUMENT_INVALID");
  }
}

async function putImmutable(
  remote: string,
  ref: ObjectRef,
  bytes: Uint8Array,
): Promise<void> {
  if (bytes.byteLength !== ref.bytes || sha256(bytes) !== ref.sha256)
    fail("ASSET_INTEGRITY_FAILED", ref.key);
  const output = path.join(remote, ...ref.key.split("/"));
  await mkdir(path.dirname(output), { recursive: true });
  try {
    const existing = await readFile(output);
    if (!Buffer.from(existing).equals(Buffer.from(bytes)))
      fail("ASSET_INTEGRITY_FAILED", ref.key);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    await writeFile(output, bytes, { flag: "wx", mode: 0o600 });
  }
}

async function publishFixture(): Promise<string> {
  assertArgs(["--remote", "--version"]);
  const remote = flag("--remote");
  if (!remote) fail("ASSET_ARGUMENT_INVALID");
  const pointer = JSON.parse(
    await readFile(
      path.join(root, "generated/asset-delivery/current.json"),
      "utf8",
    ),
  ) as { readonly run: string; readonly snapshot: unknown };
  const snapshotRef = parseObjectRef(pointer.snapshot);
  const objectRoot = path.join(root, pointer.run, "objects");
  const snapshotBytes = await readFile(
    path.join(objectRoot, ...snapshotRef.key.split("/")),
  );
  const snapshot = parseBundleSnapshot(JSON.parse(snapshotBytes.toString()));
  await putImmutable(remote, snapshotRef, snapshotBytes);
  for (const ref of snapshot.objects)
    await putImmutable(
      remote,
      ref,
      await readFile(path.join(objectRoot, ...ref.key.split("/"))),
    );

  const statePath = path.join(remote, "channels/index.json");
  let state;
  try {
    state = parsePublicationInventory(
      JSON.parse(await readFile(statePath, "utf8")),
    );
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    state = parsePublicationInventory({
      schemaVersion: 1,
      nightly: null,
      releases: [],
      retiredNightlies: [],
    });
  }
  const version = flag("--version");
  if (version) {
    if (state.releases.some((release) => release.version === version))
      fail("ASSET_RELEASE_EXISTS", `releases/${version}.json`);
    const pointerBytes = canonicalBytes({
      schemaVersion: 1,
      version,
      snapshot: snapshotRef,
    });
    const releaseRef = parseObjectRef({
      key: `releases/${version}.json`,
      bytes: pointerBytes.byteLength,
      sha256: sha256(pointerBytes),
    });
    await putImmutable(remote, releaseRef, pointerBytes);
    state = parsePublicationInventory({
      ...state,
      releases: [...state.releases, { version, pointer: releaseRef }].sort(
        (left, right) => left.version.localeCompare(right.version),
      ),
    });
  } else {
    state = parsePublicationInventory({
      ...state,
      nightly: snapshotRef,
      retiredNightlies: state.nightly
        ? [
            ...state.retiredNightlies,
            {
              snapshot: state.nightly,
              retiredAt: "2000-01-01T00:00:00.000Z",
            },
          ]
        : state.retiredNightlies,
    });
  }
  await mkdir(path.dirname(statePath), { recursive: true });
  await writeFile(statePath, canonicalBytes(state));
  return snapshotRef.sha256;
}

async function verifyInstalled(): Promise<string> {
  if (args.length) fail("ASSET_ARGUMENT_INVALID");
  const receipt = parseInstallReceipt(
    JSON.parse(
      await readFile(path.join(root, "assets/.install-receipt.json"), "utf8"),
    ),
  );
  for (const file of receipt.files) {
    const source = path.join(root, ...file.path.split("/"));
    const info = await stat(source);
    const bytes = await readFile(source);
    if (
      !info.isFile() ||
      info.size !== file.bytes ||
      sha256(bytes) !== file.sha256
    )
      fail("ASSET_INTEGRITY_FAILED", file.path);
  }
  return receipt.snapshotSha256;
}

if (command === "publish") {
  process.exitCode = await assetCli("publish", async (progress) => {
    progress("fixture-publication", flag("--remote"));
    return publishFixture();
  });
} else if (command === "verify-installed") {
  process.exitCode = await assetCli("check", async (progress) => {
    progress("verify-installed", "assets/.install-receipt.json");
    return verifyInstalled();
  });
} else {
  process.exitCode = await assetCli("check", async () => {
    fail("ASSET_ARGUMENT_INVALID");
  });
}
