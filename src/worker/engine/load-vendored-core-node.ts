import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import {
  OcgCoreAdapter,
  type CoreInitializationOptions,
} from "./OcgCoreAdapter.ts";

export async function loadVendoredCoreNode(
  options: Omit<CoreInitializationOptions, "wasmBinary"> = {},
): Promise<OcgCoreAdapter> {
  const wasmPath = fileURLToPath(
    new URL(
      "../../../vendor/ocgcore-wasm/0.1.2/lib/ocgcore.sync.wasm",
      import.meta.url,
    ),
  );
  const bytes = await readFile(wasmPath);
  const wasmBinary = bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength,
  ) as ArrayBuffer;
  return OcgCoreAdapter.initialize({ ...options, wasmBinary });
}
