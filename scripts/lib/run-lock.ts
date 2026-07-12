import { link, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";

interface LockOwner {
  pid: number;
  token: string;
  startedAt: string;
}

export async function acquireRunLock(lockFile: string): Promise<() => Promise<void>> {
  await mkdir(path.dirname(lockFile), { recursive: true });
  const owner: LockOwner = {
    pid: process.pid,
    token: randomUUID(),
    startedAt: new Date().toISOString(),
  };

  for (;;) {
    const candidate = `${lockFile}.candidate-${owner.token}`;
    await writeFile(candidate, `${JSON.stringify(owner, null, 2)}\n`, {
      encoding: "utf8",
      flag: "wx",
    });
    try {
      await link(candidate, lockFile);
      await rm(candidate, { force: true });
      break;
    } catch (error) {
      await rm(candidate, { force: true });
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      const existingOwner = await readOwner(lockFile);
      if (existingOwner && processIsAlive(existingOwner.pid)) {
        throw new Error(
          `Another asset process is running (PID ${existingOwner.pid}, started ${existingOwner.startedAt})`,
        );
      }
      const staleFile = `${lockFile}.stale-${owner.token}`;
      try {
        await rename(lockFile, staleFile);
        await rm(staleFile, { force: true });
      } catch (reclaimError) {
        if ((reclaimError as NodeJS.ErrnoException).code !== "ENOENT") throw reclaimError;
      }
    }
  }

  return async () => {
    const currentOwner = await readOwner(lockFile);
    if (currentOwner?.token === owner.token) {
      await rm(lockFile, { force: true });
    }
  };
}

export async function writeJsonAtomic(filePath: string, value: unknown): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  const temporary = `${filePath}.tmp-${process.pid}-${randomUUID()}`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await rename(temporary, filePath);
}

async function readOwner(lockFile: string): Promise<LockOwner | null> {
  try {
    return JSON.parse(await readFile(lockFile, "utf8")) as LockOwner;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

function processIsAlive(pid: number): boolean {
  if (!Number.isSafeInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}
