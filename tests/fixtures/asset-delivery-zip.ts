import { createHash } from "node:crypto";
import { ZipWriter } from "@zip.js/zip.js";
import type { ZipWriterConstructorOptions } from "@zip.js/zip.js";

/** T1 SDK API fixture only; not an asset bundler. ZIP64 auto-selected when needed. */
export const ZIP_OPTIONS = {
  level: 0,
  bufferedWrite: false,
  keepOrder: true,
  dataDescriptor: true,
  dataDescriptorSignature: true,
  rawLastModDate: 0x00210000,
  extendedTimestamp: false,
  ntfsTimestamp: false,
  msDosCompatible: true,
  versionMadeBy: 20,
  externalFileAttributes: 0,
  internalFileAttributes: 0,
  useUnicodeFileNames: true,
  useWebWorkers: false,
  useCompressionStream: false,
} satisfies ZipWriterConstructorOptions;

// Fixture is three bytes. Large-file/OS evidence belongs to bundler acceptance.
const chunks: Uint8Array[] = [];
const writer = new ZipWriter(
  new WritableStream<Uint8Array>({
    write(chunk) {
      chunks.push(chunk);
    },
  }),
  ZIP_OPTIONS,
);
await writer.add(
  "assets/story/é.psd",
  new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new Uint8Array([1, 2, 3]));
      controller.close();
    },
  }),
  { comment: "" },
);
await writer.close(new Uint8Array());
const zip = Buffer.concat(chunks);
const central = zip.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]));
const extras: number[] = [];
const extraStart = 30 + zip.readUInt16LE(26);
for (
  let i = extraStart;
  i < extraStart + zip.readUInt16LE(28);
  i += 4 + zip.readUInt16LE(i + 2)
)
  extras.push(zip.readUInt16LE(i));
console.log(
  JSON.stringify({
    sha256: createHash("sha256").update(zip).digest("hex"),
    bytes: zip.length,
    method: zip.readUInt16LE(8),
    rawLastModDate: zip.readUInt32LE(10),
    utf8: (zip.readUInt16LE(6) & 0x0800) !== 0,
    attributes: zip.readUInt32LE(central + 38),
    commentLength: zip.readUInt16LE(central + 32),
    extras,
  }),
);
