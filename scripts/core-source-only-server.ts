import { spawn } from "node:child_process";
import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const id = process.env.CORE_SOURCE_ID ?? "default";
if (!/^[a-z0-9-]+$/.test(id)) throw new Error("CORE_SOURCE_ID is invalid");
const scratch = path.join(projectRoot, ".tmp", `core-source-only-${id}`);
const marker = path.join(scratch, ".core-source-only-owner");
const markerText = "owned-by-core-source-only-harness\n";

async function removeOwnedScratch(): Promise<void> {
  try {
    if ((await readFile(marker, "utf8")) !== markerText)
      throw new Error(`Refusing to remove unowned scratch path: ${scratch}`);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
    throw error;
  }
  await rm(scratch, { recursive: true, force: false });
}

await removeOwnedScratch();
await mkdir(scratch, { recursive: true });
await writeFile(marker, markerText);
for (const entry of ["src", "scripts", "vendor"] as const)
  await cp(path.join(projectRoot, entry), path.join(scratch, entry), {
    recursive: true,
  });
await mkdir(path.join(scratch, "content"), { recursive: true });
await cp(
  path.join(projectRoot, "content/core-bootstrap.json"),
  path.join(scratch, "content/core-bootstrap.json"),
);
const mapAsset = "assets/story/chapter-01/city-map-placeholder.svg";
await mkdir(path.dirname(path.join(scratch, mapAsset)), { recursive: true });
await cp(path.join(projectRoot, mapAsset), path.join(scratch, mapAsset));
for (const file of [
  "index.html",
  "package-lock.json",
  "package.json",
  "tsconfig.json",
  "vite.config.ts",
] as const)
  await cp(path.join(projectRoot, file), path.join(scratch, file));

const npm = process.platform === "win32" ? "npm.cmd" : "npm";
async function run(args: readonly string[]): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(npm, args, {
      cwd: scratch,
      env: process.env,
      stdio: "inherit",
    });
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (code === 0) resolve();
      else
        reject(
          new Error(
            `${npm} ${args.join(" ")} failed with ${code ?? signal ?? "unknown"}`,
          ),
        );
    });
  });
}

try {
  await run(["ci"]);
  await run(["run", "build"]);
} catch (error) {
  await removeOwnedScratch();
  throw error;
}

const port = process.env.CORE_SOURCE_PORT ?? "4400";
const server = spawn(
  npm,
  ["run", "dev", "--", "--host", "127.0.0.1", "--port", port, "--strictPort"],
  {
    cwd: scratch,
    env: { ...process.env, DEV_PORT: port },
    stdio: "inherit",
  },
);

let stopping = false;
async function stop(signal: NodeJS.Signals): Promise<void> {
  if (stopping) return;
  stopping = true;
  server.kill(signal);
}
process.once("SIGTERM", () => void stop("SIGTERM"));
process.once("SIGINT", () => void stop("SIGINT"));
server.once("error", (error) => {
  console.error(error);
  process.exitCode = 1;
});
server.once("exit", async (code) => {
  try {
    await removeOwnedScratch();
  } catch (error) {
    console.error(error);
    process.exitCode = 1;
    return;
  }
  if (!stopping && code !== 0) process.exitCode = code ?? 1;
});
