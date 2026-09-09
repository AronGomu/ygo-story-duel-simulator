import { ASSET_SOURCES } from "./lib/asset-roots.ts";
import { acquireAssetDeliveryLock } from "./lib/asset-delivery/local-lock.ts";
import { createHash } from "node:crypto";
import { mkdir, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readCappedResponseBody } from "./lib/capped-response-body.ts";
import { isJpeg, validJpegFileSize } from "./lib/images.ts";

/* Acquires the Yu-Gi-Oh! card back the duel field renders behind every hidden
   card. The bytes carry the same unapproved redistribution posture as the card
   art, so they land in ignored `assets/shared/` rather than in the repository, and
   a tree that never ran this keeps the drawn SVG back.

   Pinned 2026-09-02: https://images.ygoprodeck.com/images/cards/back_high.jpg
   returned HTTP 200 image/jpeg, 44,343 bytes, sha256
   8b3fee7055b0b819ff3f84bb3c91274cd207f9f3a33966e239c3095b90f9c656. The digest
   is recorded rather than enforced: upstream re-encodes its art occasionally,
   and this file is a decoration whose absence is already a supported state. */

const CARD_BACK_URL =
  "https://images.ygoprodeck.com/images/cards/back_high.jpg";
const USER_AGENT = "YGO-Story-Duel-Simulator/0.1 asset importer";
/* The pinned image is 44,343 bytes, so this clears it by roughly 180x. It
   exists because an endless upstream body has no ceiling otherwise:
   `arrayBuffer()` allocates outside the V8 heap, and reached 15.7 GB RSS in one
   15 s fetch window when measured. */
const MAX_CARD_BACK_BYTES = 8 * 1024 * 1024;

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(scriptDirectory, "..");
const outputPath = path.join(projectRoot, ASSET_SOURCES.cardBack.source);
const relativeOutput = path
  .relative(projectRoot, outputPath)
  .replaceAll(path.sep, "/");

const releaseLock = await acquireAssetDeliveryLock(projectRoot);
try {
  await main();
} finally {
  await releaseLock();
}

async function main(): Promise<void> {
  const existingBytes = await validJpegFileSize(outputPath);
  if (existingBytes !== null) {
    console.log(
      JSON.stringify(
        { status: "skipped", output: relativeOutput, bytes: existingBytes },
        null,
        2,
      ),
    );
    return;
  }

  const response = await fetch(CARD_BACK_URL, {
    headers: { "user-agent": USER_AGENT },
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) {
    process.stderr.write(
      `${CARD_BACK_URL} returned HTTP ${response.status} ${response.statusText}\n`,
    );
    process.exitCode = 1;
    return;
  }

  const body = await readCappedResponseBody(
    response,
    MAX_CARD_BACK_BYTES,
    "card-back.jpg",
  );
  if (body.status === "too-large") {
    process.stderr.write(`${CARD_BACK_URL}: ${body.error}\n`);
    process.exitCode = 1;
    return;
  }
  if (!isJpeg(body.bytes)) {
    process.stderr.write(
      `${CARD_BACK_URL} returned ${response.headers.get("content-type") ?? "unknown"}, expected a JPEG\n`,
    );
    process.exitCode = 1;
    return;
  }

  await mkdir(path.dirname(outputPath), { recursive: true });
  const temporary = `${outputPath}.tmp-${process.pid}`;
  await writeFile(temporary, body.bytes);
  await rm(outputPath, { force: true });
  await rename(temporary, outputPath);

  console.log(
    JSON.stringify(
      {
        status: "ok",
        source: CARD_BACK_URL,
        output: relativeOutput,
        bytes: body.bytes.byteLength,
        sha256: createHash("sha256").update(body.bytes).digest("hex"),
      },
      null,
      2,
    ),
  );
}
