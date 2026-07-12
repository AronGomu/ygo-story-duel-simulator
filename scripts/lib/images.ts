import { open, stat } from "node:fs/promises";

export function isJpeg(bytes: Uint8Array): boolean {
  return (
    bytes.length >= 4 &&
    bytes[0] === 0xff &&
    bytes[1] === 0xd8 &&
    bytes[bytes.length - 2] === 0xff &&
    bytes[bytes.length - 1] === 0xd9
  );
}

export async function validJpegFileSize(filePath: string): Promise<number | null> {
  try {
    const fileStat = await stat(filePath);
    if (!fileStat.isFile() || fileStat.size < 1_000) return null;
    const handle = await open(filePath, "r");
    try {
      const signatures = Buffer.alloc(4);
      await handle.read(signatures, 0, 2, 0);
      await handle.read(signatures, 2, 2, fileStat.size - 2);
      return isJpeg(signatures) ? fileStat.size : null;
    } finally {
      await handle.close();
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}
