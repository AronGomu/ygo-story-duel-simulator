import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";

const remote = process.env.ASSET_DELIVERY_FIXTURE_REMOTE;
if (!remote) throw new Error("ASSET_DELIVERY_FIXTURE_REMOTE is required");
const resolvedRemote = path.resolve(remote);

function objectPath(url: URL): string | null {
  if (
    url.protocol !== "https:" ||
    url.hostname !== "assets.example" ||
    !url.pathname.startsWith("/ascencio-assets/v1/")
  )
    return null;
  const key = url.pathname.slice("/ascencio-assets/v1/".length);
  if (
    !key ||
    key.split("/").some((part) => !part || part === "." || part === "..")
  )
    return null;
  const candidate = path.resolve(resolvedRemote, ...key.split("/"));
  return candidate.startsWith(`${resolvedRemote}${path.sep}`)
    ? candidate
    : null;
}

globalThis.fetch = async (input, init) => {
  const url = new URL(
    typeof input === "string" || input instanceof URL ? input : input.url,
  );
  const file = objectPath(url);
  if (!file) return new Response(null, { status: 404 });
  let bytes: Uint8Array;
  try {
    bytes = await readFile(file);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT")
      return new Response(null, { status: 404 });
    throw error;
  }
  const etag = `"${createHash("sha256").update(bytes).digest("hex")}"`;
  const range = new Headers(init?.headers).get("range");
  if (range) {
    const match = /^bytes=(\d+)-$/.exec(range);
    if (!match) return new Response(null, { status: 416 });
    const offset = Number(match[1]);
    if (offset >= bytes.byteLength) return new Response(null, { status: 416 });
    const body = bytes.subarray(offset);
    return new Response(Buffer.from(body), {
      status: 206,
      headers: {
        "accept-ranges": "bytes",
        "content-length": String(body.byteLength),
        "content-range": `bytes ${offset}-${bytes.byteLength - 1}/${bytes.byteLength}`,
        etag,
      },
    });
  }
  return new Response(Buffer.from(bytes), {
    status: 200,
    headers: {
      "accept-ranges": "bytes",
      "content-length": String(bytes.byteLength),
      etag,
    },
  });
};
