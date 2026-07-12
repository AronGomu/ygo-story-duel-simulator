import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import type { GeneratedFile } from "./model.ts";

export async function writeJson(filePath: string, value: unknown): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(value)}\n`, "utf8");
}

export async function sha256File(filePath: string): Promise<string> {
  const content = await readFile(filePath);
  return createHash("sha256").update(content).digest("hex");
}

export async function listFiles(root: string): Promise<string[]> {
  const files: string[] = [];

  async function visit(directory: string): Promise<void> {
    const entries = await readdir(directory, { withFileTypes: true });
    for (const entry of entries) {
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        await visit(absolute);
      } else if (entry.isFile()) {
        files.push(absolute);
      }
    }
  }

  await visit(root);
  return files.sort();
}

export async function describeGeneratedFiles(root: string): Promise<GeneratedFile[]> {
  const files = await listFiles(root);
  const described: GeneratedFile[] = [];

  for (const file of files) {
    if (path.basename(file) === "manifest.json") {
      continue;
    }
    const fileStat = await stat(file);
    described.push({
      path: path.relative(root, file).replaceAll(path.sep, "/"),
      bytes: fileStat.size,
      sha256: await sha256File(file),
    });
  }

  return described;
}

export async function replaceDirectoryRecoverably(
  stagingDirectory: string,
  destinationDirectory: string,
): Promise<void> {
  const backupDirectory = `${destinationDirectory}.previous`;

  // Recover a build interrupted after moving the previous snapshot aside.
  try {
    await stat(destinationDirectory);
    await rm(backupDirectory, { recursive: true, force: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      throw error;
    }
    try {
      await renameWithRetry(backupDirectory, destinationDirectory);
    } catch (recoveryError) {
      if ((recoveryError as NodeJS.ErrnoException).code !== "ENOENT") {
        throw recoveryError;
      }
    }
  }

  try {
    await renameWithRetry(destinationDirectory, backupDirectory);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code !== "ENOENT") {
      throw error;
    }
  }

  try {
    await renameWithRetry(stagingDirectory, destinationDirectory);
    await rm(backupDirectory, { recursive: true, force: true });
  } catch (error) {
    await rm(destinationDirectory, { recursive: true, force: true });
    try {
      await renameWithRetry(backupDirectory, destinationDirectory);
    } catch {
      // Preserve the original failure; there may not have been a previous snapshot.
    }
    throw error;
  }
}

async function renameWithRetry(source: string, destination: string): Promise<void> {
  const maxAttempts = process.platform === "win32" ? 8 : 1;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      await rename(source, destination);
      return;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== "EPERM" || attempt === maxAttempts) {
        throw error;
      }
      await new Promise((resolve) => setTimeout(resolve, attempt * 100));
    }
  }
}
