import { createHash } from "node:crypto";
import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseCoreBootstrap } from "../src/content/index.ts";
import {
  DOMAIN_BUDGET_BYTES,
  measureDomainChunks,
  staticHtmlScriptClosure,
} from "./lib/domain-chunk-closure.ts";
import { verifyBundle } from "./lib/asset-delivery/verify-bundle.ts";

const projectRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const outputRoot = path.join(projectRoot, "dist");

await stat(path.join(outputRoot, "index.html"));
await verifySingleHtmlEntry();
await verifyNoRemovedPhaserResidue();
await verifyNoAcceptanceHarnessResidue();

const bootstrapBytes = await readFile(
  path.join(outputRoot, "core-bootstrap.json"),
);
if (bootstrapBytes.byteLength > 1048576)
  throw new Error("CORE bootstrap exceeds its byte limit");
const bootstrap = parseCoreBootstrap(
  JSON.parse(bootstrapBytes.toString("utf8")) as unknown,
  "https://core.invalid/",
);
await verifyContentSelection(bootstrap);
await assertMissing("runtime");
await assertMissing("story/shop-sets.v1.json");

const privateDeploymentMarker = await readFile(
  path.join(outputRoot, "PRIVATE_DEPLOYMENT_ONLY.txt"),
  "utf8",
);
if (!privateDeploymentMarker.includes("Keep it private"))
  throw new Error("CORE build lacks its private-deployment marker");
await verifyThirdPartyLicenses();

const javaScriptFiles = await findFiles(path.join(outputRoot, "assets"), ".js");
const jspiChunks = javaScriptFiles.filter((file) =>
  path.basename(file).startsWith("ocgcore.jspi-"),
);
const synchronousEngineChunks = javaScriptFiles.filter((file) =>
  path.basename(file).startsWith("ocgcore.sync-"),
);
if (jspiChunks.length > 0 || synchronousEngineChunks.length !== 1)
  throw new Error(
    `Browser build emitted an unexpected engine chunk set: ${[
      ...jspiChunks,
      ...synchronousEngineChunks,
    ]
      .map((file) => path.basename(file))
      .join(", ")}`,
  );
if ((await stat(synchronousEngineChunks[0]!)).size > 100_000)
  throw new Error("Browser build emitted the embedded-WASM fallback chunk");
const workerFile = javaScriptFiles.find((file) =>
  path.basename(file).startsWith("duel.worker-browser-"),
);
if (workerFile === undefined)
  throw new Error("Browser build did not emit the dedicated duel Worker");

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
for (const file of javaScriptFiles) {
  const source = await readFile(file, "utf8");
  const match = forbidden.find((value) => source.includes(value));
  if (match !== undefined)
    throw new Error(
      `Browser bundle ${path.relative(outputRoot, file)} contains forbidden Node/engine resolution marker: ${match}`,
    );
}

const sizeSummary = await verifySizeBudgets(javaScriptFiles, workerFile);
console.log(
  JSON.stringify(
    {
      status: "ok",
      mode: "core",
      delivery: bootstrap.delivery === null ? "unavailable" : "pinned",
      bootstrapSha256: sha256(bootstrapBytes),
      worker: path.basename(workerFile),
      chunkBytes: sizeSummary,
    },
    null,
    2,
  ),
);

async function verifyContentSelection(
  bootstrap: ReturnType<typeof parseCoreBootstrap>,
): Promise<void> {
  const run = process.env.CONTENT_RUN;
  if (run === undefined || run === "") {
    if (bootstrap.delivery !== null)
      throw new Error("CORE build invented a content delivery pin");
    await assertMissing("content");
    return;
  }
  const snapshot = await verifyBundle(projectRoot, run);
  if (snapshot.prod === null) throw new Error("CONTENT_INVALID_MANIFEST");
  if (
    bootstrap.delivery?.index.sha256 !== snapshot.prod.index.sha256 ||
    bootstrap.delivery.index.bytes !== snapshot.prod.index.bytes
  )
    throw new Error("CORE bootstrap does not name the selected content index");
  const expected = snapshot.objects
    .map((ref) => ref.key)
    .filter((key) => /^content\/(indexes|catalogs|manifests|parts)\//.test(key))
    .sort();
  const packaged = (await findFiles(path.join(outputRoot, "content")))
    .map((file) => path.relative(outputRoot, file).replaceAll("\\", "/"))
    .sort();
  if (packaged.join("\n") !== expected.join("\n"))
    throw new Error("CORE build content objects differ from selected run");
}

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
  )
    throw new Error("Browser build must not depend on Phaser");
  const forbiddenMarkers = [
    "node_modules/phaser",
    "phaser-MIT",
    "DuelScene",
    "create-phaser-presentation-bridge",
    "duel-field-canvas",
  ];
  for (const file of await findFiles(outputRoot)) {
    const relative = path.relative(outputRoot, file).replaceAll("\\", "/");
    if (!/\.(?:html|js|json|txt|css)$/.test(relative)) continue;
    const source = await readFile(file, "utf8");
    const marker = forbiddenMarkers.find(
      (value) => relative.includes(value) || source.includes(value),
    );
    if (marker !== undefined)
      throw new Error(`Browser build retains Phaser artifact: ${marker}`);
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
  const licenses = [
    ["licenses/svelte-MIT.txt", "node_modules/svelte/LICENSE.md"],
    ["licenses/idb-ISC.txt", "node_modules/idb/LICENSE"],
    ["licenses/ocgcore-wasm-MIT.txt", "vendor/ocgcore-wasm/0.1.2/LICENSE"],
  ] as const;
  for (const [packaged, source] of licenses) {
    const [left, right] = await Promise.all([
      readFile(path.join(outputRoot, packaged)),
      readFile(path.join(projectRoot, source)),
    ]);
    if (left.byteLength !== right.byteLength || sha256(left) !== sha256(right))
      throw new Error(`Browser build license differs from source: ${packaged}`);
  }
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
  const domainReports = await measureDomainChunks(
    outputRoot,
    routableFiles,
    shellClosure,
  );
  const budgets: ReadonlyArray<readonly [string, number, number]> = [
    ["shell initial JavaScript", shellBytes, 115_000],
    ["Duel Worker JavaScript", sizes.get(workerFile) ?? 0, 200_000],
    ...domainReports.map(
      ({ domain, bytes }) =>
        [
          `${domain} domain closure`,
          bytes,
          DOMAIN_BUDGET_BYTES[domain],
        ] as const,
    ),
  ];
  const exceeded = budgets.find(([, actual, maximum]) => actual > maximum);
  if (exceeded !== undefined)
    throw new Error(
      `${exceeded[0]} exceeds its production budget: ${exceeded[1]} > ${exceeded[2]} bytes`,
    );
  for (const { domain, bytes } of domainReports) {
    const budget = DOMAIN_BUDGET_BYTES[domain];
    if ((budget - bytes) / budget < 0.1)
      throw new Error(`${domain} domain closure has insufficient headroom`);
  }
  return {
    shell: shellBytes,
    worker: sizes.get(workerFile) ?? 0,
    ...Object.fromEntries(
      domainReports.map(({ domain, bytes }) => [domain, bytes]),
    ),
  };
}

async function assertMissing(relative: string): Promise<void> {
  try {
    await stat(path.join(outputRoot, relative));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
    throw error;
  }
  throw new Error(`CORE build contains forbidden payload: ${relative}`);
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
