import { readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readCatalog } from "./lib/catalog.ts";
import {
  describeGeneratedFiles,
  listFiles,
  replaceDirectoryRecoverably,
  sha256File,
  writeJson,
} from "./lib/files.ts";
import {
  MAX_CARD_SCRIPT_BYTES,
  MAX_CARD_SCRIPT_FILES,
  MAX_CATALOG_DATABASES,
  MAX_STRINGS_CONF_BYTES,
  MAX_TOTAL_CARD_SCRIPT_BYTES,
} from "./lib/limits.ts";
import {
  CATALOG_SHARD_COUNT,
  SCRIPT_SHARD_COUNT,
  type AssetManifest,
  type CardTextRecord,
  type EngineCardRecord,
  type ImageRecord,
} from "./lib/model.ts";
import { resolveProjectSubpath } from "./lib/paths.ts";
import { acquireRunLock } from "./lib/run-lock.ts";
import { parseStringsConf } from "./lib/strings.ts";
import { syncRepository } from "./lib/sources.ts";
import { catalogShard, scriptShard } from "./lib/transform.ts";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(scriptDirectory, "..");
const options = parseOptions(process.argv.slice(2));
const stageStartedAt = new Map<string, number>();
const cacheRoot = resolveProjectSubpath(
  projectRoot,
  options.cacheDirectory,
  ".cache",
  "--cache-dir",
);
const destination = resolveProjectSubpath(
  projectRoot,
  options.outputDirectory,
  "generated/assets",
  "--output",
);
const staging = `${destination}.staging-${process.pid}`;
const releaseRunLock = await acquireRunLock(
  path.join(projectRoot, "generated", ".locks", "asset-sync"),
);

try {
const repositories = {
  babel: await syncRepository(
    cacheRoot,
    {
      name: "BabelCDB",
      repository: "https://github.com/ProjectIgnis/BabelCDB.git",
      ref: options.babelRef,
    },
    options.offline,
  ),
  scripts: await syncRepository(
    cacheRoot,
    {
      name: "CardScripts",
      repository: "https://github.com/ProjectIgnis/CardScripts.git",
      ref: options.scriptsRef,
    },
    options.offline,
  ),
  distribution: await syncRepository(
    cacheRoot,
    {
      name: "Distribution",
      repository: "https://github.com/ProjectIgnis/Distribution.git",
      ref: options.distributionRef,
      sparsePaths: ["config"],
    },
    options.offline,
  ),
};

await rm(staging, { recursive: true, force: true });

try {
  emitStage("catalog", "start");
  const catalogDatabases = await findStandardCatalogDatabases(repositories.babel.directory);
  const catalog = readCatalog(
    catalogDatabases.map((database) => path.join(repositories.babel.directory, database)),
  );
  await writeCatalogShards(staging, catalog.cards, catalog.texts);
  emitStage("catalog", "ok", { cards: catalog.cards.length, texts: catalog.texts.length });

  emitStage("scripts", "start");
  const scripts = await writeScriptShards(staging, repositories.scripts.directory);
  emitStage("scripts", "ok", scripts);

  emitStage("strings", "start");
  const stringsPath = path.join(
    repositories.distribution.directory,
    "config",
    "strings.conf",
  );
  const stringsBytes = (await stat(stringsPath)).size;
  if (stringsBytes > MAX_STRINGS_CONF_BYTES) {
    throw new Error(`strings.conf exceeds ${MAX_STRINGS_CONF_BYTES} bytes`);
  }
  const stringsContent = await readFile(stringsPath, "utf8");
  const strings = parseStringsConf(stringsContent);
  await writeJson(path.join(staging, "strings", "en.json"), strings);
  emitStage("strings", "ok", { system: Object.keys(strings.system).length });

  emitStage("images", "start");
  await writeImageShards(staging, catalog.cards.map((card) => card.code));
  emitStage("images", "ok", { records: catalog.cards.length });

  emitStage("integrityManifest", "start");
  const files = await describeGeneratedFiles(staging);
  const manifest: AssetManifest = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    sources: {
      babelCdb: repositories.babel.revision,
      cardScripts: repositories.scripts.revision,
      distribution: repositories.distribution.revision,
      imageProvider: {
        name: "YGOPRODeck",
        apiGuide: "https://ygoprodeck.com/api-guide/",
        fullTemplate: "https://images.ygoprodeck.com/images/cards/{id}.jpg",
        croppedTemplate:
          "https://images.ygoprodeck.com/images/cards_cropped/{id}.jpg",
        redistributionApproved: false,
      },
    },
    inputs: {
      catalogDatabases,
      scriptDirectories: ["official", "pre-release"],
    },
    counts: {
      cards: catalog.cards.length,
      texts: catalog.texts.length,
      officialScripts: scripts.officialCount,
      preReleaseScripts: scripts.preReleaseCount,
      globalScripts: scripts.globalCount,
      systemStrings: Object.keys(strings.system).length,
      victoryStrings: Object.keys(strings.victory).length,
      counterStrings: Object.keys(strings.counter).length,
      setNameStrings: Object.keys(strings.setname).length,
      imageRecords: catalog.cards.length,
    },
    sharding: {
      catalog: CATALOG_SHARD_COUNT,
      scripts: SCRIPT_SHARD_COUNT,
      algorithm: "numeric-id-modulo",
    },
    files,
  };

  const manifestPath = path.join(staging, "manifest.json");
  await writeJson(manifestPath, manifest);
  await writeFile(
    path.join(staging, "manifest.sha256"),
    `${await sha256File(manifestPath)}  manifest.json\n`,
    "utf8",
  );
  emitStage("integrityManifest", "ok", { files: files.length });

  emitStage("verification", "start");
  runVerifier(staging);
  emitStage("verification", "ok");

  emitStage("publish", "start");
  await replaceDirectoryRecoverably(staging, destination);
  emitStage("publish", "ok", { destination });

  console.log(
    JSON.stringify(
      {
        status: "ok",
        output: destination,
        counts: manifest.counts,
        sources: {
          babelCdb: manifest.sources.babelCdb.commit,
          cardScripts: manifest.sources.cardScripts.commit,
          distribution: manifest.sources.distribution.commit,
        },
      },
      null,
      2,
    ),
  );
} catch (error) {
  emitStage("sync", "failed", { detail: (error as Error).message });
  await rm(staging, { recursive: true, force: true });
  throw error;
}
} finally {
  await releaseRunLock();
}

interface Options {
  offline: boolean;
  cacheDirectory: string;
  outputDirectory: string;
  babelRef: string;
  scriptsRef: string;
  distributionRef: string;
}

function parseOptions(args: string[]): Options {
  const values = new Map<string, string>();
  let offline = false;

  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--offline") {
      offline = true;
      continue;
    }
    if (!argument?.startsWith("--")) {
      throw new Error(`Unknown argument: ${argument ?? "<missing>"}`);
    }
    const value = args[index + 1];
    if (!value || value.startsWith("--")) {
      throw new Error(`Missing value for ${argument}`);
    }
    values.set(argument, value);
    index += 1;
  }

  return {
    offline,
    cacheDirectory: values.get("--cache-dir") ?? ".cache/upstream",
    outputDirectory: values.get("--output") ?? "generated/assets/current",
    babelRef: values.get("--babel-ref") ?? "master",
    scriptsRef: values.get("--scripts-ref") ?? "master",
    distributionRef: values.get("--distribution-ref") ?? "master",
  };
}

async function writeCatalogShards(
  root: string,
  cards: EngineCardRecord[],
  texts: CardTextRecord[],
): Promise<void> {
  const cardShards = groupBy(cards, (card) => catalogShard(card.code));
  const textShards = groupBy(texts, (text) => catalogShard(text.code));

  for (let shard = 0; shard < CATALOG_SHARD_COUNT; shard += 1) {
    const name = shard.toString(16).padStart(2, "0");
    await writeJson(path.join(root, "catalog", "cards", `${name}.json`), cardShards.get(name) ?? []);
    await writeJson(path.join(root, "catalog", "texts", "en", `${name}.json`), textShards.get(name) ?? []);
  }
}

async function writeScriptShards(
  root: string,
  sourceRoot: string,
): Promise<{ officialCount: number; preReleaseCount: number; globalCount: number }> {
  const officialFiles = await listCardScripts(path.join(sourceRoot, "official"));
  const preReleaseFiles = await listCardScripts(path.join(sourceRoot, "pre-release"));
  const globalFiles = (await readdir(sourceRoot, { withFileTypes: true }))
    .filter((entry) => entry.isFile() && entry.name.endsWith(".lua"))
    .map((entry) => path.join(sourceRoot, entry.name))
    .sort();

  const allScriptFiles = [...officialFiles, ...preReleaseFiles, ...globalFiles];
  if (allScriptFiles.length > MAX_CARD_SCRIPT_FILES) {
    throw new Error(
      `CardScripts contains ${allScriptFiles.length} scripts; limit is ${MAX_CARD_SCRIPT_FILES}`,
    );
  }

  const shards = new Map<string, Record<string, string>>();
  const officialNames: string[] = [];
  const preReleaseNames: string[] = [];
  let totalScriptBytes = 0;

  for (const [category, files] of [
    ["official", officialFiles],
    ["pre-release", preReleaseFiles],
  ] as const) {
    for (const file of files) {
      const name = path.basename(file);
      const shard = scriptShard(name);
      const scripts = shards.get(shard) ?? {};
      if (scripts[name] !== undefined) {
        throw new Error(`Duplicate card script across categories: ${name}`);
      }
      const fileBytes = (await stat(file)).size;
      if (fileBytes > MAX_CARD_SCRIPT_BYTES) {
        throw new Error(`${name} exceeds ${MAX_CARD_SCRIPT_BYTES} bytes`);
      }
      totalScriptBytes += fileBytes;
      if (totalScriptBytes > MAX_TOTAL_CARD_SCRIPT_BYTES) {
        throw new Error(
          `CardScripts exceeds ${MAX_TOTAL_CARD_SCRIPT_BYTES} total bytes`,
        );
      }
      scripts[name] = await readFile(file, "utf8");
      shards.set(shard, scripts);
      (category === "official" ? officialNames : preReleaseNames).push(name);
    }
  }

  for (let shard = 0; shard < SCRIPT_SHARD_COUNT; shard += 1) {
    const name = shard.toString(16).padStart(2, "0");
    await writeJson(path.join(root, "scripts", "cards", `${name}.json`), shards.get(name) ?? {});
  }

  const globals: Record<string, string> = {};
  for (const file of globalFiles) {
    const name = path.basename(file);
    const fileBytes = (await stat(file)).size;
    if (fileBytes > MAX_CARD_SCRIPT_BYTES) {
      throw new Error(`${name} exceeds ${MAX_CARD_SCRIPT_BYTES} bytes`);
    }
    totalScriptBytes += fileBytes;
    if (totalScriptBytes > MAX_TOTAL_CARD_SCRIPT_BYTES) {
      throw new Error(`CardScripts exceeds ${MAX_TOTAL_CARD_SCRIPT_BYTES} total bytes`);
    }
    globals[name] = await readFile(file, "utf8");
  }
  await writeJson(path.join(root, "scripts", "globals.json"), globals);
  await writeJson(path.join(root, "scripts", "index.json"), {
    official: officialNames.sort(),
    preRelease: preReleaseNames.sort(),
    globals: Object.keys(globals).sort(),
    shardCount: SCRIPT_SHARD_COUNT,
    algorithm: "numeric-id-modulo",
  });

  return {
    officialCount: officialNames.length,
    preReleaseCount: preReleaseNames.length,
    globalCount: Object.keys(globals).length,
  };
}

async function listCardScripts(directory: string): Promise<string[]> {
  return (await listFiles(directory)).filter((file) => /^c\d+\.lua$/.test(path.basename(file)));
}

async function findStandardCatalogDatabases(sourceRoot: string): Promise<string[]> {
  const names = (await readdir(sourceRoot, { withFileTypes: true }))
    .filter((entry) => entry.isFile() && entry.name.endsWith(".cdb"))
    .map((entry) => entry.name);
  const databases = [
    "cards.cdb",
    ...names.filter((name) => name.startsWith("release-")).sort(),
    ...names
      .filter((name) => name.startsWith("prerelease-") && !name.includes("rush"))
      .sort(),
  ];
  if (databases.length > MAX_CATALOG_DATABASES) {
    throw new Error(
      `BabelCDB provided ${databases.length} standard catalog databases; limit is ${MAX_CATALOG_DATABASES}`,
    );
  }
  for (const database of databases) {
    if (!names.includes(database)) {
      throw new Error(`Required BabelCDB database is missing: ${database}`);
    }
  }
  return databases;
}

async function writeImageShards(root: string, codes: number[]): Promise<void> {
  const images: ImageRecord[] = codes.map((code) => ({
    code,
    full: `https://images.ygoprodeck.com/images/cards/${code}.jpg`,
    cropped: `https://images.ygoprodeck.com/images/cards_cropped/${code}.jpg`,
  }));
  const shards = groupBy(images, (image) => catalogShard(image.code));

  for (let shard = 0; shard < CATALOG_SHARD_COUNT; shard += 1) {
    const name = shard.toString(16).padStart(2, "0");
    await writeJson(path.join(root, "images", `${name}.json`), shards.get(name) ?? []);
  }
}

function runVerifier(outputDirectory: string): void {
  const result = spawnSync(
    process.execPath,
    [path.join(scriptDirectory, "verify-assets.ts"), "--output", outputDirectory],
    { encoding: "utf8" },
  );
  if (result.status !== 0) {
    throw new Error(`Generated snapshot verification failed:\n${result.stderr || result.stdout}`);
  }
}

function emitStage(
  stage: string,
  status: "start" | "ok" | "failed",
  details: Record<string, unknown> = {},
): void {
  if (status === "start") {
    stageStartedAt.set(stage, Date.now());
  }
  const startedAt = stageStartedAt.get(stage);
  process.stderr.write(
    `${JSON.stringify({
      timestamp: new Date().toISOString(),
      operation: "assetSync",
      stage,
      status,
      ...(startedAt !== undefined && status !== "start"
        ? { durationMs: Date.now() - startedAt }
        : {}),
      ...details,
    })}\n`,
  );
}

function groupBy<T>(items: T[], keyFor: (item: T) => string): Map<string, T[]> {
  const groups = new Map<string, T[]>();
  for (const item of items) {
    const key = keyFor(item);
    const group = groups.get(key) ?? [];
    group.push(item);
    groups.set(key, group);
  }
  return groups;
}
