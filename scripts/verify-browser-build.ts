import { ASSET_SOURCES } from "./lib/asset-roots.ts";
import { createHash } from "node:crypto";
import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadDeckSources } from "../src/battle/duel/presets/deck-sources-node.ts";
import { reviewedCardPool } from "../src/battle/duel/presets/reviewed-card-pool.ts";
import { parseRuntimeSnapshotManifest } from "../src/battle/worker/assets/runtime-manifest.ts";
import {
  deriveRuntimeSnapshotId,
  runtimeAssetContentSha256,
  verifyRuntimeSnapshotFiles,
} from "../src/battle/worker/assets/runtime-snapshot-node.ts";
import { assertNoMissingActiveImages } from "./lib/active-image-manifest.ts";
import {
  DOMAIN_BUDGET_BYTES,
  measureDomainChunks,
  staticHtmlScriptClosure,
} from "./lib/domain-chunk-closure.ts";
import type { CardImageDigest } from "./lib/image-content-lock.ts";
import {
  IMAGE_CONTENT_LOCK_FILE,
  parseImageContentLock,
  verifyLockedCardImages,
} from "./lib/image-content-lock.ts";
import { snapshotCopyPaths } from "./lib/vite-runtime-assets.ts";

const projectRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const outputRoot = path.join(projectRoot, "dist");
const runtimeRoot = path.join(outputRoot, "runtime");
const assetRoot = path.join(runtimeRoot, "assets/current");
await stat(path.join(outputRoot, "index.html"));
await verifySingleHtmlEntry();
await verifyNoRemovedPhaserResidue();
await verifyNoAcceptanceHarnessResidue();

const runtimeManifestBytes = await readFile(
  path.join(runtimeRoot, "current/manifest.json"),
);
const sourceRuntimeManifestBytes = await readFile(
  path.join(projectRoot, `${ASSET_SOURCES.runtime.source}/manifest.json`),
);
if (!runtimeManifestBytes.equals(sourceRuntimeManifestBytes)) {
  throw new Error(
    "Browser build runtime manifest differs from the verified source",
  );
}
const runtimeManifestSha256 = sha256(runtimeManifestBytes);
const manifest = parseRuntimeSnapshotManifest(
  JSON.parse(runtimeManifestBytes.toString("utf8")) as unknown,
);
await verifyRuntimeSnapshotFiles(manifest, assetRoot);
const packagedAssetPaths = (await findFiles(assetRoot)).map((file) =>
  path.relative(assetRoot, file).replaceAll("\\", "/"),
);
const expectedAssetPaths = [...snapshotCopyPaths(manifest)].sort();
if (packagedAssetPaths.sort().join("\n") !== expectedAssetPaths.join("\n")) {
  throw new Error(
    "Browser build contains missing or unmanifested runtime files",
  );
}

const packagedAssetManifest = await assertSameFile(
  path.join(assetRoot, "manifest.json"),
  path.join(projectRoot, `${ASSET_SOURCES.data.source}/manifest.json`),
  "asset manifest",
);
const packagedVendorManifest = await assertSameFile(
  path.join(runtimeRoot, "engine/vendor-manifest.json"),
  path.join(projectRoot, "vendor/ocgcore-wasm/0.1.2/vendor-manifest.json"),
  "vendor manifest",
);
const packagedWasm = await assertSameFile(
  path.join(runtimeRoot, "engine/ocgcore.sync.wasm"),
  path.join(projectRoot, "vendor/ocgcore-wasm/0.1.2/lib/ocgcore.sync.wasm"),
  "synchronous WASM",
);
if (sha256(packagedAssetManifest) !== manifest.assets.manifestSha256)
  throw new Error("Packaged asset manifest does not match the runtime root");
if (sha256(packagedVendorManifest) !== manifest.engine.manifestSha256)
  throw new Error("Packaged vendor manifest does not match the runtime root");
const derivedSnapshotId = deriveRuntimeSnapshotId(
  runtimeAssetContentSha256(
    JSON.parse(packagedAssetManifest.toString("utf8")) as Parameters<
      typeof runtimeAssetContentSha256
    >[0],
  ),
  sha256(packagedVendorManifest),
);
if (derivedSnapshotId !== manifest.snapshotId)
  throw new Error("Packaged runtime snapshot ID is not content-derived");
const vendorManifest = JSON.parse(packagedVendorManifest.toString("utf8")) as {
  readonly files?: readonly {
    readonly path?: string;
    readonly bytes?: number;
    readonly sha256?: string;
  }[];
};
const wasmRecord = vendorManifest.files?.find(
  (file) => file.path === "lib/ocgcore.sync.wasm",
);
if (
  wasmRecord?.bytes !== packagedWasm.byteLength ||
  wasmRecord.sha256 !== sha256(packagedWasm)
)
  throw new Error("Packaged synchronous WASM violates the vendor manifest");

await verifyActiveImages();
const activeImageManifestBytes = await readFile(
  path.join(runtimeRoot, "images/active-manifest.json"),
);
const activationSnapshotId = sha256(
  JSON.stringify({
    runtimeSnapshotId: manifest.snapshotId,
    activeImageManifestSha256: sha256(activeImageManifestBytes),
  }),
);
const privateDeploymentMarker = await readFile(
  path.join(outputRoot, "PRIVATE_DEPLOYMENT_ONLY.txt"),
  "utf8",
);
if (!privateDeploymentMarker.includes("Keep it private"))
  throw new Error("Unapproved image build lacks its private-deployment marker");
await verifyThirdPartyLicenses();

const javaScriptFiles = await findFiles(path.join(outputRoot, "assets"), ".js");
const jspiChunks = javaScriptFiles.filter((file) =>
  path.basename(file).startsWith("ocgcore.jspi-"),
);
const synchronousEngineChunks = javaScriptFiles.filter((file) =>
  path.basename(file).startsWith("ocgcore.sync-"),
);
if (jspiChunks.length > 0 || synchronousEngineChunks.length !== 1) {
  throw new Error(
    `Browser build emitted an unexpected engine chunk set: ${[...jspiChunks, ...synchronousEngineChunks].map((file) => path.basename(file)).join(", ")}`,
  );
}
if ((await stat(synchronousEngineChunks[0]!)).size > 100_000)
  throw new Error("Browser build emitted the embedded-WASM fallback chunk");
const workerFile = javaScriptFiles.find((file) =>
  path.basename(file).startsWith("duel.worker-browser-"),
);
if (workerFile === undefined) {
  throw new Error("Browser build did not emit the dedicated duel Worker");
}
const workerSource = await readFile(workerFile, "utf8");
if (!workerSource.includes(runtimeManifestSha256)) {
  throw new Error("Browser Worker does not embed the packaged manifest digest");
}
const forbidden = [
  "node:fs",
  "node:fs/promises",
  "node:path",
  "node:url",
  "node:crypto",
  "node:module",
  "node:worker_threads",
  "create-node-runtime",
  "duel.worker-node",
  "mvp-preset-node",
  "node_modules/ocgcore-wasm",
  "ocgcore.jspi",
  "jspi not supported",
  'Suspending"in WebAssembly',
];
let activationIdentityEmbedded = false;
for (const file of javaScriptFiles) {
  const source = await readFile(file, "utf8");
  if (source.includes(activationSnapshotId)) activationIdentityEmbedded = true;
  const match = forbidden.find((value) => source.includes(value));
  if (match !== undefined) {
    throw new Error(
      `Browser bundle ${path.relative(outputRoot, file)} contains forbidden Node/engine resolution marker: ${match}`,
    );
  }
}
if (!activationIdentityEmbedded)
  throw new Error("Browser build does not embed the composite activation ID");

const sizeSummary = await verifySizeBudgets(javaScriptFiles, workerFile);
console.log(
  JSON.stringify(
    {
      status: "ok",
      snapshotId: manifest.snapshotId,
      runtimeFiles: manifest.assets.files.length,
      worker: path.basename(workerFile),
      chunkBytes: sizeSummary,
    },
    null,
    2,
  ),
);

/* The visual novel used to ship as a second entry document, gated here by a
   `prototype.html` stat plus its own isolation scan and byte budget. It is now
   a lazily-imported domain of the single app, so the guarantee inverts: the
   build must emit exactly one HTML document. Its runtime isolation from the
   duel Worker/WASM is no longer statically derivable from an entry closure and
   is proven at runtime by `e2e/story.spec.ts` instead. */
async function verifySingleHtmlEntry(): Promise<void> {
  const documents = (await findFiles(outputRoot))
    .map((file) => path.relative(outputRoot, file).replaceAll("\\", "/"))
    .filter((file) => file.endsWith(".html"));
  if (documents.join("\n") !== "index.html")
    throw new Error(
      `Browser build must ship exactly one entry document: ${documents.join(", ")}`,
    );
}

async function verifyNoRemovedPhaserResidue(): Promise<void> {
  const packageJson = JSON.parse(
    await readFile(path.join(projectRoot, "package.json"), "utf8"),
  ) as {
    readonly dependencies?: Readonly<Record<string, string>>;
    readonly devDependencies?: Readonly<Record<string, string>>;
  };
  if (
    packageJson.dependencies?.phaser !== undefined ||
    packageJson.devDependencies?.phaser !== undefined
  ) {
    throw new Error("Browser build must not depend on Phaser");
  }
  const lock = JSON.parse(
    await readFile(path.join(projectRoot, "package-lock.json"), "utf8"),
  ) as {
    readonly packages?: Readonly<Record<string, unknown>>;
    readonly dependencies?: Readonly<Record<string, unknown>>;
  };
  if (
    lock.packages?.["node_modules/phaser"] !== undefined ||
    lock.dependencies?.phaser !== undefined
  ) {
    throw new Error("Browser build lockfile retains Phaser");
  }
  const forbiddenPackageMarkers = ["node_modules/phaser", "phaser-MIT"];
  const forbiddenBundleMarkers = [
    "phaser",
    "Phaser",
    "DuelScene",
    "create-phaser-presentation-bridge",
    "duel-field-canvas",
    "data-loaded-face-images",
    "data-card-back-ready",
    "data-failed-textures",
    "data-hidden-cards",
    "data-visible-card-images",
  ];
  for (const file of await findFiles(outputRoot)) {
    const relative = path.relative(outputRoot, file).replaceAll("\\", "/");
    const packageMarker = forbiddenPackageMarkers.find((marker) =>
      relative.includes(marker),
    );
    if (packageMarker !== undefined) {
      throw new Error(`Browser build retains Phaser artifact: ${relative}`);
    }
    if (!/\.(?:html|js|json|txt|css)$/.test(relative)) continue;
    const source = await readFile(file, "utf8");
    const bundleMarker = forbiddenBundleMarkers.find((marker) =>
      source.includes(marker),
    );
    if (bundleMarker !== undefined) {
      throw new Error(
        `Browser build ${relative} contains removed Phaser marker: ${bundleMarker}`,
      );
    }
  }
}

async function verifyNoAcceptanceHarnessResidue(): Promise<void> {
  const forbiddenFiles = new Set(["acceptance.html"]);
  const forbiddenMarkers = [
    ".acceptance-card-list-field",
    "acceptance-card-list-scenario",
    "card-list-browse-six",
    "field-emz",
  ];
  for (const file of await findFiles(outputRoot)) {
    const relative = path.relative(outputRoot, file).replaceAll("\\", "/");
    if (forbiddenFiles.has(relative))
      throw new Error(
        `Browser build contains acceptance-only file: ${relative}`,
      );
    if (!/\.(?:html|js|css)$/.test(relative)) continue;
    const source = await readFile(file, "utf8");
    const marker = forbiddenMarkers.find((value) => source.includes(value));
    if (marker !== undefined)
      throw new Error(
        `Browser build ${relative} contains acceptance-only marker: ${marker}`,
      );
  }
}

async function verifyThirdPartyLicenses(): Promise<void> {
  const expectedPackages = {
    svelte: { version: "5.56.4", license: "MIT" },
    idb: { version: "8.0.3", license: "ISC" },
  } as const;
  const lock = JSON.parse(
    await readFile(path.join(projectRoot, "package-lock.json"), "utf8"),
  ) as {
    readonly packages?: Readonly<
      Record<
        string,
        {
          readonly version?: string;
          readonly license?: string;
          readonly integrity?: string;
        }
      >
    >;
  };
  for (const [name, expected] of Object.entries(expectedPackages)) {
    const locked = lock.packages?.[`node_modules/${name}`];
    const installed = JSON.parse(
      await readFile(
        path.join(projectRoot, "node_modules", name, "package.json"),
        "utf8",
      ),
    ) as { readonly version?: string; readonly license?: string };
    if (
      locked?.version !== expected.version ||
      locked.license !== expected.license ||
      typeof locked.integrity !== "string" ||
      !locked.integrity.startsWith("sha512-") ||
      installed.version !== expected.version ||
      installed.license !== expected.license
    )
      throw new Error(`Runtime package identity is unreviewed: ${name}`);
  }
  const licenses = [
    ["licenses/svelte-MIT.txt", "node_modules/svelte/LICENSE.md"],
    ["licenses/idb-ISC.txt", "node_modules/idb/LICENSE"],
    ["licenses/ocgcore-wasm-MIT.txt", "vendor/ocgcore-wasm/0.1.2/LICENSE"],
  ] as const;
  await Promise.all(
    licenses.map(([packaged, source]) =>
      assertSameFile(
        path.join(outputRoot, ...packaged.split("/")),
        path.join(projectRoot, ...source.split("/")),
        packaged,
      ),
    ),
  );
}

async function verifySizeBudgets(
  javaScriptFiles: readonly string[],
  workerFile: string,
): Promise<Record<string, number>> {
  const sizes = new Map<string, number>();
  await Promise.all(
    javaScriptFiles.map(async (file) => {
      sizes.set(file, (await stat(file)).size);
    }),
  );
  /* The Worker is budgeted on its own line below and is never reached by a
     static import, so it stays out of both closures. */
  const routableFiles = javaScriptFiles.filter((file) => file !== workerFile);
  const shellFiles = await staticHtmlScriptClosure(
    outputRoot,
    "index.html",
    routableFiles,
  );
  const shellClosure = new Set(shellFiles);
  const shellBytes = shellFiles.reduce(
    (total, file) => total + (sizes.get(file) ?? 0),
    0,
  );
  const runtimeBytes = await totalFileBytes(
    path.join(runtimeRoot, "assets/current"),
  );
  const imageBytes = await totalFileBytes(path.join(runtimeRoot, "images"));
  const coldStartBytes =
    shellBytes + (sizes.get(workerFile) ?? 0) + runtimeBytes + imageBytes;

  /* Each domain is reached only through its own dynamic import, so its bytes
     are what visiting that route costs on top of the shell. Chunks the shell
     already paid for are excluded, and a missing domain chunk throws. */
  const domainReports = await measureDomainChunks(
    outputRoot,
    routableFiles,
    shellClosure,
  );
  const budgets: ReadonlyArray<readonly [string, number, number]> = [
    /* T11 2026-08-20: raised from 41,000,000. `snapshotCopyPaths` packages every
       file the runtime manifest declares instead of the bundled-deck closure
       (ADR-043 §3), so a cold start carries the whole snapshot. Measured
       64,351,552 bytes = shell 85,628 + Worker 144,801 + runtime 45,546,991 +
       images 18,574,132 → ceil(64351552/25_000) = 2,575 → 64,375,000 * 1.15. */
    ["aggregate cold-start transfer", coldStartBytes, 74_031_250],
    /* T21 2026-08-15: replaces the "initial JavaScript" 400,000 ceiling, which
       covered the two-entry build and went unmeasured per domain. Measured
       shell closure 78,142 bytes → ceil(78142/25_000) = 4 → 100,000 * 1.15.
       The ceiling is what catches a domain turning eager: a static import of
       `src/battle/index.ts` from the shell moved the entry chunk from 2.62 kB
       to 339.73 kB, which this line rejects. */
    ["shell initial JavaScript", shellBytes, 115_000],
    ["Duel Worker JavaScript", sizes.get(workerFile) ?? 0, 200_000],
    /* T11 2026-08-20: raised from 22,000,000, same cause as the cold-start
       ceiling above. Measured 45,546,991 bytes → ceil(45546991/25_000) = 1,822 →
       45,550,000 * 1.15. */
    ["active runtime closure", runtimeBytes, 52_382_500],
    ["active card images", imageBytes, 19_000_000],
    ...domainReports.map(
      ({ domain, bytes }) =>
        [
          `${domain} domain closure`,
          bytes,
          DOMAIN_BUDGET_BYTES[domain],
        ] as const,
    ),
  ];

  /* Headroom enforcement for domain closures. Matches the assertion in
     tests/unit/domain-chunk-closure.test.ts: (budget - bytes) / budget >= 0.1. */
  const HEADROOM_MINIMUM = 0.1;
  for (const { domain, bytes } of domainReports) {
    const budget = DOMAIN_BUDGET_BYTES[domain];
    const headroom = (budget - bytes) / budget;
    if (headroom < HEADROOM_MINIMUM) {
      throw new Error(
        `${domain} domain closure has insufficient headroom: ` +
          `${bytes} of ${budget} bytes = ${((1 - headroom) * 100).toFixed(1)}% used, ` +
          `need ≤${((1 - HEADROOM_MINIMUM) * 100).toFixed(0)}%`,
      );
    }
  }

  const exceeded = budgets.find(([, actual, maximum]) => actual > maximum);
  if (exceeded !== undefined)
    throw new Error(
      `${exceeded[0]} exceeds its production budget: ${exceeded[1]} > ${exceeded[2]} bytes`,
    );
  return {
    shell: shellBytes,
    ...Object.fromEntries(
      domainReports.map(({ domain, bytes }) => [domain, bytes]),
    ),
  };
}

async function totalFileBytes(root: string): Promise<number> {
  const files = await findFiles(root);
  const sizes = await Promise.all(
    files.map(async (file) => (await stat(file)).size),
  );
  return sizes.reduce((total, bytes) => total + bytes, 0);
}

async function verifyActiveImages(): Promise<void> {
  const imageRoot = path.join(runtimeRoot, "images");
  const cropRoot = path.join(runtimeRoot, "images-cropped");
  const manifestBytes = await readFile(
    path.join(imageRoot, "active-manifest.json"),
  );
  const imageManifest = JSON.parse(manifestBytes.toString("utf8")) as {
    readonly schemaVersion?: number;
    readonly snapshotId?: string;
    readonly provider?: string;
    readonly redistributionApproved?: boolean;
    readonly files?: readonly {
      readonly code?: number;
      readonly path?: string;
      readonly bytes?: number;
      readonly sha256?: string;
    }[];
    readonly missing?: readonly number[];
  };
  if (
    imageManifest.schemaVersion !== 1 ||
    imageManifest.snapshotId !== manifest.snapshotId ||
    imageManifest.provider !== "bundled-archive" ||
    imageManifest.redistributionApproved !== false ||
    !Array.isArray(imageManifest.files) ||
    !Array.isArray(imageManifest.missing)
  )
    throw new Error("Packaged active-image manifest is invalid");
  const packaged = (await findFiles(imageRoot)).map((file) =>
    path.relative(imageRoot, file).replaceAll("\\", "/"),
  );
  const declared = [
    "active-manifest.json",
    ...imageManifest.files.map((file) => file.path),
  ].sort();
  /* The card back sits beside the active images but is not one of them: it is
     acquired by `scripts/download-card-back.ts` into ignored `generated/`, and
     a build without it renders the duel field's drawn SVG back instead. */
  const packagedActiveImages = packaged.filter(
    (file) => file !== "card-back.jpg",
  );
  if (packagedActiveImages.sort().join("\n") !== declared.join("\n"))
    throw new Error("Packaged active images differ from their manifest");
  const declaredCodes = new Set<number>();
  const observedCards: CardImageDigest[] = [];
  for (const record of imageManifest.files) {
    if (
      !Number.isSafeInteger(record.code) ||
      record.path !== `${record.code}.jpg` ||
      !Number.isSafeInteger(record.bytes) ||
      typeof record.sha256 !== "string" ||
      !/^[a-f0-9]{64}$/.test(record.sha256)
    )
      throw new Error("Packaged active-image record is invalid");
    const bytes = await readFile(path.join(imageRoot, record.path));
    const digest = sha256(bytes);
    if (
      bytes.byteLength !== record.bytes ||
      digest !== record.sha256 ||
      bytes[0] !== 0xff ||
      bytes[1] !== 0xd8 ||
      bytes.at(-2) !== 0xff ||
      bytes.at(-1) !== 0xd9
    )
      throw new Error(
        `Packaged card image failed verification: ${record.path}`,
      );
    if (declaredCodes.has(record.code))
      throw new Error(`Duplicate packaged card image: ${record.code}`);
    declaredCodes.add(record.code);
    observedCards.push({
      code: record.code,
      bytes: bytes.byteLength,
      sha256: digest,
    });
  }
  imageManifest.missing.forEach((code) => {
    if (!Number.isSafeInteger(code) || declaredCodes.has(code))
      throw new Error(`Invalid missing active-image code: ${code}`);
    declaredCodes.add(code);
  });
  assertNoMissingActiveImages({ missing: imageManifest.missing });
  const expectedCodes = reviewedCardPool(await loadDeckSources());
  if (
    [...expectedCodes].some((code) => !declaredCodes.has(code)) ||
    [...declaredCodes].some((code) => !expectedCodes.has(code))
  )
    throw new Error("Packaged active-image coverage differs from preset decks");

  const packagedCrops = (await findFiles(cropRoot)).map((file) =>
    path.relative(cropRoot, file).replaceAll("\\", "/"),
  );
  const expectedCrops = imageManifest.files.map(({ path }) => path).sort();
  if (packagedCrops.sort().join("\n") !== expectedCrops.join("\n"))
    throw new Error("Packaged cropped images differ from active card images");
  const observedCrops: CardImageDigest[] = [];
  for (const record of imageManifest.files) {
    const bytes = await readFile(path.join(cropRoot, record.path));
    if (
      bytes[0] !== 0xff ||
      bytes[1] !== 0xd8 ||
      bytes.at(-2) !== 0xff ||
      bytes.at(-1) !== 0xd9
    )
      throw new Error(`Packaged cropped image is invalid: ${record.path}`);
    observedCrops.push({
      code: record.code,
      bytes: bytes.byteLength,
      sha256: sha256(bytes),
    });
  }

  /* Audit F16b. Everything above re-hashes packaged art against generated
     manifests. Tracked lock is digest build cannot rewrite, visible in diff. */
  const lock = parseImageContentLock(
    JSON.parse(
      await readFile(path.join(projectRoot, IMAGE_CONTENT_LOCK_FILE), "utf8"),
    ) as unknown,
  );
  const lockFailures = [
    ...verifyLockedCardImages(lock, observedCards),
    ...verifyLockedCardImages({ cards: lock.crops }, observedCrops).map(
      (failure) => `Crop: ${failure}`,
    ),
  ];
  if (lockFailures.length > 0)
    throw new Error(
      `Packaged card images differ from ${IMAGE_CONTENT_LOCK_FILE}:\n${lockFailures.join("\n")}`,
    );
}

async function assertSameFile(
  builtPath: string,
  sourcePath: string,
  label: string,
): Promise<Buffer> {
  const [built, source] = await Promise.all([
    readFile(builtPath),
    readFile(sourcePath),
  ]);
  if (
    built.byteLength !== source.byteLength ||
    sha256(built) !== sha256(source)
  ) {
    throw new Error(`Browser build ${label} differs from the verified source`);
  }
  return built;
}

async function findFiles(root: string, extension?: string): Promise<string[]> {
  const entries = await readdir(root, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const absolutePath = path.join(root, entry.name);
    if (entry.isDirectory())
      files.push(...(await findFiles(absolutePath, extension)));
    else if (
      entry.isFile() &&
      (extension === undefined || entry.name.endsWith(extension))
    )
      files.push(absolutePath);
  }
  return files;
}

function sha256(value: Uint8Array | string): string {
  return createHash("sha256").update(value).digest("hex");
}
