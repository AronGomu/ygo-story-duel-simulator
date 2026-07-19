import { mkdir, rm } from "node:fs/promises";
import path from "node:path";
import { spawnSync } from "node:child_process";
import type { SourceRevision } from "./model.ts";

interface RepositoryDefinition {
  name: string;
  repository: string;
  ref: string;
  sparsePaths?: string[];
}

export interface SyncedRepository {
  directory: string;
  revision: SourceRevision;
}

function runGit(args: string[], cwd?: string): string {
  const startedAt = Date.now();
  emit({ operation: "git", status: "start", cwd: cwd ?? process.cwd(), args });
  const result = spawnSync("git", args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });

  if (result.error || result.status !== 0) {
    const detail = result.error?.message ?? result.stderr?.trim() ?? "unknown git error";
    emit({
      operation: "git",
      status: "failed",
      cwd: cwd ?? process.cwd(),
      args,
      durationMs: Date.now() - startedAt,
      detail,
    });
    throw new Error(
      `git ${args.join(" ")} failed${cwd ? ` in ${cwd}` : ""}:\n${detail}`,
    );
  }

  emit({
    operation: "git",
    status: "ok",
    cwd: cwd ?? process.cwd(),
    args,
    durationMs: Date.now() - startedAt,
  });
  return result.stdout?.trim() ?? "";
}

export async function syncRepository(
  cacheRoot: string,
  definition: RepositoryDefinition,
  offline: boolean,
): Promise<SyncedRepository> {
  validateGitRef(definition.ref);
  await mkdir(cacheRoot, { recursive: true });
  const directory = path.join(cacheRoot, definition.name);

  try {
    runGit(["rev-parse", "--git-dir"], directory);
  } catch (error) {
    emit({
      operation: "validateSourceCache",
      status: "miss",
      repository: definition.repository,
      directory,
      detail: (error as Error).message,
    });
    if (offline) {
      throw new Error(`Offline source cache is missing or invalid: ${directory}`, {
        cause: error,
      });
    }
    await rm(directory, { recursive: true, force: true });
    const cloneArguments = definition.sparsePaths?.length
      ? ["clone", "--filter=blob:none", "--no-checkout", definition.repository, directory]
      : ["clone", "--depth=1", "--no-checkout", definition.repository, directory];
    runGit(cloneArguments);
  }

  if (definition.sparsePaths?.length) {
    runGit(["sparse-checkout", "init", "--cone"], directory);
    runGit(["sparse-checkout", "set", ...definition.sparsePaths], directory);
  } else {
    runGit(["sparse-checkout", "disable"], directory);
  }

  if (!offline) {
    runGit(["fetch", "--depth=1", "origin", definition.ref], directory);
    runGit(["checkout", "--detach", "--force", "FETCH_HEAD"], directory);
  }

  const commit = runGit(["rev-parse", "HEAD"], directory);
  validatePinnedRevision(definition.ref, commit);
  return {
    directory,
    revision: {
      repository: definition.repository,
      requestedRef: definition.ref,
      commit,
    },
  };
}

export function validatePinnedRevision(
  requestedRef: string,
  observedCommit: string,
): void {
  if (/^[a-f0-9]{40}$/i.test(requestedRef) && requestedRef !== observedCommit) {
    throw new Error(
      `Pinned source revision mismatch: expected ${requestedRef}, found ${observedCommit}`,
    );
  }
}

export function validateGitRef(ref: string): void {
  if (
    ref.length > 256 ||
    !/^[A-Za-z0-9][A-Za-z0-9._/-]*$/.test(ref) ||
    ref.includes("..") ||
    ref.includes("//") ||
    ref.endsWith("/") ||
    ref.endsWith(".") ||
    ref.endsWith(".lock")
  ) {
    throw new Error(`Unsafe or invalid Git ref: ${JSON.stringify(ref)}`);
  }
}

function emit(event: Record<string, unknown>): void {
  process.stderr.write(`${JSON.stringify({ timestamp: new Date().toISOString(), ...event })}\n`);
}
