import type { PackedFile } from "../contracts/packed-file.ts";
import { compare, paths } from "../parsers/schema.ts";
import { failure, verifyBytes } from "../content-verification.ts";

/** Player producer emits canonical STORE-only ZIPs. Reject every other dialect. */
export async function extractVerifiedPart(
  bytes: Uint8Array,
  files: readonly PackedFile[],
  write: (file: PackedFile, bytes: Uint8Array) => Promise<void>,
): Promise<void> {
  const reject = (): never => {
    throw failure("CONTENT_ARCHIVE_REJECTED");
  };
  if (
    bytes.length > 20971520 ||
    bytes.length < 22 ||
    files.length > 2048 ||
    files.reduce((n, f) => n + f.bytes, 0) > 33554432
  )
    reject();
  try {
    paths(files.map((f) => f.entry));
  } catch {
    reject();
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const u16 = (offset: number) => {
    if (offset < 0 || offset + 2 > bytes.length) reject();
    return view.getUint16(offset, true);
  };
  const u32 = (offset: number) => {
    if (offset < 0 || offset + 4 > bytes.length) reject();
    return view.getUint32(offset, true);
  };
  const end = bytes.length - 22;
  if (
    u32(end) !== 0x06054b50 ||
    u16(end + 4) ||
    u16(end + 6) ||
    u16(end + 20) ||
    u16(end + 8) !== files.length ||
    u16(end + 10) !== files.length
  )
    reject();
  const directory = u32(end + 16);
  if (directory + u32(end + 12) !== end) reject();
  let central = directory;
  let local = 0;
  const decoder = new TextDecoder("utf-8", { fatal: true });
  for (const file of [...files].sort((a, b) => compare(a.entry, b.entry))) {
    if (file.bytes > 16777216 || /\.(zip|gz|7z|rar|tar)$/i.test(file.entry))
      reject();
    if (
      u32(central) !== 0x02014b50 ||
      u16(central + 10) ||
      u32(central + 12) !== 0x00210000 ||
      u16(central + 30) ||
      u16(central + 32) ||
      u16(central + 34) ||
      u16(central + 36) ||
      u32(central + 38) ||
      u32(central + 42) !== local ||
      u32(central + 20) !== file.bytes ||
      u32(central + 24) !== file.bytes
    )
      reject();
    const flags = u16(central + 8);
    const nameLength = u16(central + 28);
    if (
      flags & ~0x808 ||
      !(flags & 0x800) ||
      !nameLength ||
      nameLength > 512 ||
      central + 46 + nameLength > end
    )
      reject();
    let name: string;
    try {
      name = decoder.decode(
        bytes.subarray(central + 46, central + 46 + nameLength),
      );
    } catch {
      reject();
    }
    if (
      name! !== file.entry ||
      u32(local) !== 0x04034b50 ||
      u16(local + 6) !== flags ||
      u16(local + 8) ||
      u32(local + 10) !== 0x00210000 ||
      u16(local + 26) !== nameLength ||
      u16(local + 28)
    )
      reject();
    for (let i = 0; i < nameLength; i++)
      if (bytes[local + 30 + i] !== bytes[central + 46 + i]) reject();
    const crc = u32(central + 16);
    const descriptor = Boolean(flags & 8);
    if (
      (!descriptor &&
        (u32(local + 14) !== crc ||
          u32(local + 18) !== file.bytes ||
          u32(local + 22) !== file.bytes)) ||
      (descriptor &&
        (![0, crc].includes(u32(local + 14)) ||
          ![0, file.bytes].includes(u32(local + 18)) ||
          ![0, file.bytes].includes(u32(local + 22))))
    )
      reject();
    const start = local + 30 + nameLength;
    local = start + file.bytes;
    if (local > directory) reject();
    const payload = bytes.subarray(start, local);
    let actualCrc = 0xffffffff;
    for (const byte of payload) {
      actualCrc ^= byte;
      for (let bit = 0; bit < 8; bit++)
        actualCrc = (actualCrc >>> 1) ^ (actualCrc & 1 ? 0xedb88320 : 0);
    }
    if ((actualCrc ^ 0xffffffff) >>> 0 !== crc) reject();
    if (descriptor) {
      if (u32(local) === 0x08074b50) local += 4;
      if (
        u32(local) !== crc ||
        u32(local + 4) !== file.bytes ||
        u32(local + 8) !== file.bytes
      )
        reject();
      local += 12;
    }
    await verifyBytes(payload, file);
    await write(file, payload);
    central += 46 + nameLength;
  }
  if (central !== end || local !== directory) reject();
}
