import assert from "node:assert/strict";
import test from "node:test";
import { readTarFiles } from "../scripts/lib/tar.ts";

test("readTarFiles extracts regular package files", () => {
  const archive = createTar("package/lib/ocgcore.sync.wasm", new Uint8Array([0, 97, 115, 109]));
  const files = readTarFiles(archive, "package/");
  assert.equal(files[0]?.path, "lib/ocgcore.sync.wasm");
  assert.deepEqual(files[0]?.bytes, new Uint8Array([0, 97, 115, 109]));
});

test("readTarFiles rejects paths outside the package root", () => {
  const archive = createTar("../escaped", new Uint8Array([1]));
  assert.throws(() => readTarFiles(archive, "package/"), /outside package/);
});

function createTar(name: string, content: Uint8Array): Uint8Array {
  const contentBlocks = Math.ceil(content.length / 512);
  const archive = new Uint8Array(512 + contentBlocks * 512 + 1024);
  const header = archive.subarray(0, 512);
  header.set(new TextEncoder().encode(name), 0);
  const size = content.length.toString(8).padStart(11, "0") + "\0";
  header.set(new TextEncoder().encode(size), 124);
  header[156] = "0".charCodeAt(0);
  archive.set(content, 512);
  return archive;
}
