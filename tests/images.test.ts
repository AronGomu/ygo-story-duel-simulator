import assert from "node:assert/strict";
import test from "node:test";
import { isJpeg } from "../scripts/lib/images.ts";

test("isJpeg requires complete JPEG start and end markers", () => {
  assert.equal(isJpeg(new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0xff, 0xd9])), true);
  assert.equal(isJpeg(new Uint8Array([0x89, 0x50, 0x4e, 0x47])), false);
  assert.equal(isJpeg(new Uint8Array([0xff, 0xd8, 0xff, 0xe0])), false);
  assert.equal(isJpeg(new Uint8Array([0xff, 0xd8])), false);
});
