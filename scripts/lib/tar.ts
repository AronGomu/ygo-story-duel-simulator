export interface TarFile {
  path: string;
  bytes: Uint8Array;
}

const BLOCK_SIZE = 512;
const MAX_FILES = 1_000;
const MAX_FILE_BYTES = 20 * 1024 * 1024;
const MAX_TOTAL_FILE_BYTES = 50 * 1024 * 1024;

export function readTarFiles(archive: Uint8Array, requiredPrefix: string): TarFile[] {
  const files: TarFile[] = [];
  let totalFileBytes = 0;
  let offset = 0;

  while (offset + BLOCK_SIZE <= archive.length) {
    const header = archive.subarray(offset, offset + BLOCK_SIZE);
    if (header.every((byte) => byte === 0)) break;

    const name = readString(header, 0, 100);
    const prefix = readString(header, 345, 155);
    const entryPath = prefix ? `${prefix}/${name}` : name;
    const sizeText = readString(header, 124, 12).trim();
    const size = sizeText ? Number.parseInt(sizeText, 8) : 0;
    const type = String.fromCharCode(header[156] ?? 0);
    if (!Number.isSafeInteger(size) || size < 0) {
      throw new Error(`Invalid TAR entry size for ${entryPath}`);
    }

    const contentStart = offset + BLOCK_SIZE;
    const contentEnd = contentStart + size;
    if (contentEnd > archive.length) {
      throw new Error(`Truncated TAR entry: ${entryPath}`);
    }

    if (type === "\0" || type === "0") {
      if (size > MAX_FILE_BYTES) throw new Error(`TAR entry exceeds size limit: ${entryPath}`);
      totalFileBytes += size;
      if (totalFileBytes > MAX_TOTAL_FILE_BYTES) throw new Error("TAR files exceed total size limit");
      if (files.length >= MAX_FILES) throw new Error(`TAR contains more than ${MAX_FILES} files`);
      const safePath = safeArchivePath(entryPath, requiredPrefix);
      files.push({ path: safePath, bytes: archive.slice(contentStart, contentEnd) });
    } else if (type !== "5") {
      throw new Error(`Unsupported TAR entry type ${JSON.stringify(type)}: ${entryPath}`);
    }

    offset = contentStart + Math.ceil(size / BLOCK_SIZE) * BLOCK_SIZE;
  }

  if (!files.length) throw new Error("TAR archive contains no files");
  return files;
}

function safeArchivePath(entryPath: string, requiredPrefix: string): string {
  const normalized = entryPath.replaceAll("\\", "/");
  if (!normalized.startsWith(requiredPrefix)) {
    throw new Error(`TAR entry is outside ${requiredPrefix}: ${entryPath}`);
  }
  const relative = normalized.slice(requiredPrefix.length);
  const segments = relative.split("/");
  if (!relative || segments.some((segment) => !segment || segment === "." || segment === "..")) {
    throw new Error(`Unsafe TAR entry path: ${entryPath}`);
  }
  return segments.join("/");
}

function readString(bytes: Uint8Array, offset: number, length: number): string {
  const end = bytes.indexOf(0, offset);
  const boundedEnd = end === -1 || end > offset + length ? offset + length : end;
  return new TextDecoder().decode(bytes.subarray(offset, boundedEnd));
}
