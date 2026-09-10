import type { ZipFileReader } from "./zip-file-reader.ts";
import { fail } from "./failure.ts";

const U32 = 0xffffffff;
function reject(): never {
  return fail("ASSET_ARCHIVE_REJECTED");
}
function u64(bytes: Buffer, offset: number): number {
  const value = bytes.readBigUInt64LE(offset);
  if (value > BigInt(Number.MAX_SAFE_INTEGER)) reject();
  return Number(value);
}
/** Only sentinel-required ZIP64 fields, in APPNOTE order; no optional extras. */
function sizes(
  extra: Buffer,
  fields: readonly number[],
  sentinels: readonly number[],
  player: boolean,
): number[] {
  const length = fields.reduce(
    (sum, value, i) => sum + (value === sentinels[i] ? (i === 3 ? 4 : 8) : 0),
    0,
  );
  if (!length) {
    if (extra.length) reject();
    return [...fields];
  }
  if (
    player ||
    extra.length !== length + 4 ||
    extra.readUInt16LE(0) !== 1 ||
    extra.readUInt16LE(2) !== length
  )
    reject();
  let offset = 4;
  return fields.map((value, i) => {
    if (value !== sentinels[i]) return value;
    const result = i === 3 ? extra.readUInt32LE(offset) : u64(extra, offset);
    offset += i === 3 ? 4 : 8;
    return result;
  });
}
/** Validate contiguous ZIP records without reading payloads. zip.js separately checks CRC/content. */
export async function verifyZipStructure(
  reader: ZipFileReader,
  player: boolean,
  expectedCount: number,
): Promise<void> {
  const read = async (offset: number, length: number): Promise<Buffer> => {
    if (offset < 0 || offset + length > reader.size) reject();
    return Buffer.from(await reader.readUint8Array(offset, length));
  };
  const endOffset = reader.size - 22;
  const end = await read(endOffset, 22);
  if (end.readUInt32LE(0) !== 0x06054b50 || end.readUInt16LE(20)) reject();
  let count = end.readUInt16LE(10);
  let directorySize = end.readUInt32LE(12);
  let directoryOffset = end.readUInt32LE(16);
  let directoryEnd = endOffset;
  const locator = endOffset >= 20 ? await read(endOffset - 20, 20) : null;
  const zip64 = locator?.readUInt32LE(0) === 0x07064b50;
  if (zip64) {
    if (
      player ||
      locator!.readUInt32LE(4) !== 0 ||
      locator!.readUInt32LE(16) !== 1
    )
      reject();
    directoryEnd = u64(locator!, 8);
    if (directoryEnd + 56 !== endOffset - 20) reject();
    const record = await read(directoryEnd, 56);
    if (
      record.readUInt32LE(0) !== 0x06064b50 ||
      u64(record, 4) !== 44 ||
      record.readUInt32LE(16) ||
      record.readUInt32LE(20) ||
      u64(record, 24) !== u64(record, 32)
    )
      reject();
    const values = [u64(record, 32), u64(record, 40), u64(record, 48)];
    for (const [i, value] of [count, directorySize, directoryOffset].entries())
      if (value !== (i === 0 ? 0xffff : U32) && value !== values[i]) reject();
    [count, directorySize, directoryOffset] = values as [
      number,
      number,
      number,
    ];
    if (
      ![0, 0xffff].includes(end.readUInt16LE(4)) ||
      ![0, 0xffff].includes(end.readUInt16LE(6)) ||
      ![count, 0xffff].includes(end.readUInt16LE(8))
    )
      reject();
  } else if (
    end.readUInt16LE(4) ||
    end.readUInt16LE(6) ||
    end.readUInt16LE(8) !== count ||
    count === 0xffff ||
    directorySize === U32 ||
    directoryOffset === U32
  )
    reject();
  if (
    count !== expectedCount ||
    directoryOffset + directorySize !== directoryEnd
  )
    reject();
  let centralOffset = directoryOffset;
  let localOffset = 0;
  for (let index = 0; index < count; index++) {
    const central = await read(centralOffset, 46);
    if (
      central.readUInt32LE(0) !== 0x02014b50 ||
      central.readUInt16LE(32) ||
      central.readUInt32LE(12) !== 0x00210000 ||
      central.readUInt16LE(10) ||
      central.readUInt16LE(36) ||
      central.readUInt32LE(38)
    )
      reject();
    const flags = central.readUInt16LE(8);
    if ((flags & ~0x808) !== 0 || !(flags & 0x800)) reject();
    const nameLength = central.readUInt16LE(28);
    const extraLength = central.readUInt16LE(30);
    if (!nameLength || nameLength > 512) reject();
    const name = await read(centralOffset + 46, nameLength);
    const [unpacked, packed, offset, disk] = sizes(
      await read(centralOffset + 46 + nameLength, extraLength),
      [
        central.readUInt32LE(24),
        central.readUInt32LE(20),
        central.readUInt32LE(42),
        central.readUInt16LE(34),
      ],
      [U32, U32, U32, 0xffff],
      player,
    );
    if (disk || offset !== localOffset || packed !== unpacked) reject();
    centralOffset += 46 + nameLength + extraLength;
    if (centralOffset > directoryEnd) reject();
    const local = await read(localOffset, 30);
    if (
      local.readUInt32LE(0) !== 0x04034b50 ||
      local.readUInt16LE(6) !== flags ||
      local.readUInt16LE(8) ||
      local.readUInt32LE(10) !== 0x00210000 ||
      local.readUInt16LE(26) !== nameLength ||
      !(await read(localOffset + 30, nameLength)).equals(name)
    )
      reject();
    const localExtraLength = local.readUInt16LE(28);
    const [localUnpacked, localPacked] = sizes(
      await read(localOffset + 30 + nameLength, localExtraLength),
      [local.readUInt32LE(22), local.readUInt32LE(18)],
      [U32, U32],
      player,
    );
    const crc = central.readUInt32LE(16);
    const descriptor = Boolean(flags & 8);
    if (
      (!descriptor &&
        (localUnpacked !== unpacked ||
          localPacked !== packed ||
          local.readUInt32LE(14) !== crc)) ||
      (descriptor &&
        ((localUnpacked !== 0 && localUnpacked !== unpacked) ||
          (localPacked !== 0 && localPacked !== packed) ||
          (local.readUInt32LE(14) !== 0 && local.readUInt32LE(14) !== crc)))
    )
      reject();
    localOffset += 30 + nameLength + localExtraLength + packed!;
    if (descriptor) {
      const signed =
        (await read(localOffset, 4)).readUInt32LE(0) === 0x08074b50;
      if (signed) localOffset += 4;
      const wide =
        local.readUInt32LE(18) === U32 || local.readUInt32LE(22) === U32;
      const data = await read(localOffset, wide ? 20 : 12);
      if (
        data.readUInt32LE(0) !== crc ||
        (wide ? u64(data, 4) : data.readUInt32LE(4)) !== packed ||
        (wide ? u64(data, 12) : data.readUInt32LE(8)) !== unpacked
      )
        reject();
      localOffset += data.length;
    }
    if (localOffset > directoryOffset) reject();
  }
  if (centralOffset !== directoryEnd || localOffset !== directoryOffset)
    reject();
}
