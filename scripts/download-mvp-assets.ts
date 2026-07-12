#!/usr/bin/env node
import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildAssetStages, parseMvpAssetOptions, type AssetStage } from "./lib/mvp-assets.ts";
import { acquireRunLock, writeJsonAtomic } from "./lib/run-lock.ts";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(scriptDirectory, "..");
const generatedRoot = path.join(projectRoot, "generated");
const statusPath = path.join(generatedRoot, "mvp-assets-status.json");
const options = parseMvpAssetOptions(process.argv.slice(2));

if (options.help) {
  console.log(`Download and verify every external asset required by the MVP.

Usage:
  npm run assets:mvp -- [options]
  download-mvp-assets.cmd [options]       Windows
  ./download-mvp-assets.sh [options]      macOS/Linux

Options:
  --offline                  Regenerate from existing Git/image caches without network access
  --force-images             Redownload images that are already cached
  --concurrency <count>      Override simultaneous image workers (default: 18)
  --requests-per-second <n>  Override image request rate, maximum 20 (default: 18)
  -h, --help                 Show this help

The command is resumable. Existing valid JPEGs are verified and skipped.`);
} else {
  await main().catch((error) => {
    emit("run", "failed", {
      error: error instanceof Error ? error.message : String(error),
      resumable: true,
    });
    process.exitCode = 1;
  });
}

async function main(): Promise<void> {
  const nodeMajor = Number(process.versions.node.split(".")[0]);
  if (!Number.isSafeInteger(nodeMajor) || nodeMajor < 24) {
    throw new Error(`Node.js 24 or newer is required; found ${process.versions.node}`);
  }

  const releaseLock = await acquireRunLock(path.join(generatedRoot, ".locks", "mvp-assets"));
  const startedAt = Date.now();
  const stages = buildAssetStages(options);
  await writeStatus("in-progress", { offline: options.offline });
  emit("run", "start", { offline: options.offline, stages: stages.map((stage) => stage.name) });

  try {
    for (const stage of stages) {
      await runStage(stage);
    }

    const engineManifest = JSON.parse(
      await readFile(path.join(generatedRoot, "engine", "current", "engine-manifest.json"), "utf8"),
    ) as { package: string; version: string };
    const manifest = JSON.parse(
      await readFile(path.join(generatedRoot, "assets", "current", "manifest.json"), "utf8"),
    ) as { counts: Record<string, number> };
    const imageReport = JSON.parse(
      await readFile(
        path.join(generatedRoot, "card-images", "archive", "download-report.json"),
        "utf8",
      ),
    ) as { requested: number; missing: number; failed: number };
    const summary = {
      durationMs: Date.now() - startedAt,
      engine: `${engineManifest.package}@${engineManifest.version}`,
      cards: manifest.counts.cards,
      officialScripts: manifest.counts.officialScripts,
      preReleaseScripts: manifest.counts.preReleaseScripts,
      globalScripts: manifest.counts.globalScripts,
      imageRecords: imageReport.requested,
      archivedImages: imageReport.requested - imageReport.missing - imageReport.failed,
      providerMissingImages: imageReport.missing,
      failedImages: imageReport.failed,
      engineOutput: "generated/engine/current",
      dataOutput: "generated/assets/current",
      imageOutput: "generated/card-images/archive/full",
    };
    await writeStatus("ready", summary);
    emit("run", "ok", summary);
  } catch (error) {
    await writeStatus("failed", {
      durationMs: Date.now() - startedAt,
      error: error instanceof Error ? error.message : String(error),
      resumable: true,
    });
    throw error;
  } finally {
    await releaseLock();
  }
}

async function runStage(stage: AssetStage): Promise<void> {
  const stageStartedAt = Date.now();
  emit(stage.name, "start", { script: stage.script, args: stage.args });
  const exitCode = await new Promise<number>((resolve, reject) => {
    const child = spawn(process.execPath, [path.join(scriptDirectory, stage.script), ...stage.args], {
      cwd: projectRoot,
      stdio: "inherit",
      windowsHide: true,
    });
    const forwardSignal = (signal: NodeJS.Signals) => child.kill(signal);
    const onSigint = () => forwardSignal("SIGINT");
    const onSigterm = () => forwardSignal("SIGTERM");
    const cleanup = () => {
      process.off("SIGINT", onSigint);
      process.off("SIGTERM", onSigterm);
    };
    child.once("error", (error) => {
      cleanup();
      emit(stage.name, "failed", {
        script: stage.script,
        args: stage.args,
        durationMs: Date.now() - stageStartedAt,
        error: error.message,
      });
      reject(error);
    });
    child.once("exit", (code, signal) => {
      cleanup();
      if (signal) {
        emit(stage.name, "failed", {
          script: stage.script,
          args: stage.args,
          durationMs: Date.now() - stageStartedAt,
          signal,
        });
        reject(new Error(`${stage.name} terminated by ${signal}`));
      } else {
        resolve(code ?? 1);
      }
    });
    process.once("SIGINT", onSigint);
    process.once("SIGTERM", onSigterm);
  });
  if (exitCode !== 0) {
    emit(stage.name, "failed", { exitCode, durationMs: Date.now() - stageStartedAt });
    throw new Error(`${stage.name} failed with exit code ${exitCode}; rerun to resume safely`);
  }
  emit(stage.name, "ok", { durationMs: Date.now() - stageStartedAt });
}

async function writeStatus(status: "in-progress" | "ready" | "failed", detail: object): Promise<void> {
  await writeJsonAtomic(statusPath, {
    schemaVersion: 1,
    status,
    updatedAt: new Date().toISOString(),
    ...detail,
  });
}

function emit(operation: string, status: string, detail: Record<string, unknown>): void {
  process.stderr.write(
    `${JSON.stringify({ timestamp: new Date().toISOString(), operation, status, ...detail })}\n`,
  );
}
