import { Reader } from "@zip.js/zip.js";
import type { FileHandle } from "node:fs/promises";
import { STREAM_CHUNK_BYTES } from "./freeze-file.ts";
import { fail } from "./failure.ts";

/** Random-access metadata reads and sequential archive input stay bounded. */
export class ZipFileReader extends Reader<FileHandle> {
  readonly handle: FileHandle;
  constructor(handle: FileHandle, size: number) {
    super(handle);
    this.handle = handle;
    this.size = size;
  }
  override async readUint8Array(
    offset: number,
    length: number,
  ): Promise<Uint8Array> {
    if (
      !Number.isSafeInteger(offset) ||
      offset < 0 ||
      !Number.isSafeInteger(length) ||
      length < 0
    )
      fail("ASSET_ARCHIVE_REJECTED");
    const size = Math.min(length, this.size - offset);
    // zip.js buffers the central directory even with getEntriesGenerator; cap metadata allocation.
    if (size < 0 || size > 32 * 1024 * 1024) fail("ASSET_LIMIT_EXCEEDED");
    // zip.js expects Uint8Array.slice to copy, not Buffer.slice's shared view.
    const buffer = new Uint8Array(size);
    let read = 0;
    while (read < size) {
      const { bytesRead } = await this.handle.read(
        buffer,
        read,
        Math.min(STREAM_CHUNK_BYTES, size - read),
        offset + read,
      );
      if (!bytesRead) fail("ASSET_INTEGRITY_FAILED");
      read += bytesRead;
    }
    return buffer;
  }
  override createReadable(
    options: { offset?: number; size?: number } = {},
  ): ReadableStream<Uint8Array> {
    let offset = options.offset ?? 0;
    const end = offset + (options.size ?? this.size - offset);
    return new ReadableStream(
      {
        pull: async (controller) => {
          if (offset >= end) {
            controller.close();
            return;
          }
          const bytes = await this.readUint8Array(
            offset,
            Math.min(STREAM_CHUNK_BYTES, end - offset),
          );
          offset += bytes.length;
          controller.enqueue(bytes);
        },
      },
      { highWaterMark: 0 },
    );
  }
}
