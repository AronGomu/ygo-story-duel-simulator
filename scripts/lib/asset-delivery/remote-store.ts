import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { Upload } from "@aws-sdk/lib-storage";
import type { AssetDeliveryConfig } from "./config.ts";
import { MAX_ARCHIVE_BYTES } from "./archive-limits.ts";
import { MAX_METADATA_BYTES } from "./canonical-json.ts";
import { AssetDeliveryError, fail } from "./failure.ts";
import { assertSafePath } from "./path-guards.ts";

export interface RemoteRead {
  readonly bytes: Uint8Array;
  readonly etag: string;
}
export interface RemoteDigest {
  readonly bytes: number;
  readonly sha256: string;
  readonly etag: string;
}
export interface RemotePutOptions {
  readonly ifMatch?: string;
  readonly ifNoneMatch?: true;
  readonly cacheControl?: "no-store" | "public,max-age=31536000,immutable";
  readonly contentType?: "application/json" | "application/zip";
}
export interface RemoteDeleteOptions {
  readonly ifMatch?: string;
}
export interface RemoteObjectStore {
  read(key: string, limit?: number): Promise<RemoteRead | null>;
  digest(key: string, limit?: number): Promise<RemoteDigest | null>;
  putBytes(
    key: string,
    bytes: Uint8Array,
    options?: RemotePutOptions,
  ): Promise<{ readonly etag: string }>;
  putFile(
    key: string,
    file: string,
    options?: RemotePutOptions,
  ): Promise<{ readonly etag: string }>;
  delete(key: string, options?: RemoteDeleteOptions): Promise<void>;
}

export class RemotePreconditionError extends Error {
  constructor() {
    super("remote precondition failed");
    this.name = "RemotePreconditionError";
  }
}

const MULTIPART_PART_BYTES = 64 * 1024 * 1024;
const REQUEST_TIMEOUT_MS = 120_000;

function isMissing(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    (("name" in error &&
      ["NoSuchKey", "NotFound"].includes(String(error.name))) ||
      ("$metadata" in error &&
        typeof error.$metadata === "object" &&
        error.$metadata !== null &&
        "httpStatusCode" in error.$metadata &&
        error.$metadata.httpStatusCode === 404))
  );
}
function isPrecondition(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    (("name" in error && String(error.name) === "PreconditionFailed") ||
      ("$metadata" in error &&
        typeof error.$metadata === "object" &&
        error.$metadata !== null &&
        "httpStatusCode" in error.$metadata &&
        error.$metadata.httpStatusCode === 412))
  );
}
function etag(value: unknown): string {
  if (typeof value !== "string" || !value) fail("ASSET_NETWORK_FAILED");
  return value;
}
async function bodyChunks(body: unknown): Promise<AsyncIterable<Uint8Array>> {
  if (
    typeof body !== "object" ||
    body === null ||
    !(Symbol.asyncIterator in body)
  )
    fail("ASSET_NETWORK_FAILED");
  return body as AsyncIterable<Uint8Array>;
}
function stopBody(body: unknown): void {
  if (
    typeof body === "object" &&
    body !== null &&
    "destroy" in body &&
    typeof body.destroy === "function"
  )
    body.destroy();
}

/** Node-only R2 adapter. Provider errors are translated without exposing bodies or signed URLs. */
export class R2ObjectStore implements RemoteObjectStore {
  readonly config: AssetDeliveryConfig;
  readonly client: S3Client;

  constructor(config: AssetDeliveryConfig, client: S3Client) {
    this.config = config;
    this.client = client;
  }
  private input(key: string): { Bucket: string; Key: string } {
    return {
      Bucket: this.config.bucket,
      Key: `${this.config.keyPrefix}${assertSafePath(key)}`,
    };
  }
  async read(
    key: string,
    limit = MAX_METADATA_BYTES,
  ): Promise<RemoteRead | null> {
    assertSafePath(key);
    try {
      const output = await this.client.send(
        new GetObjectCommand(this.input(key)),
        { abortSignal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) },
      );
      const declared = output.ContentLength;
      if (declared !== undefined && declared > limit) {
        stopBody(output.Body);
        fail("ASSET_LIMIT_EXCEEDED", key);
      }
      const chunks: Uint8Array[] = [];
      let size = 0;
      for await (const chunk of await bodyChunks(output.Body)) {
        size += chunk.byteLength;
        if (size > limit) {
          stopBody(output.Body);
          fail("ASSET_LIMIT_EXCEEDED", key);
        }
        chunks.push(chunk);
      }
      return { bytes: Buffer.concat(chunks, size), etag: etag(output.ETag) };
    } catch (error) {
      if (isMissing(error)) return null;
      if (error instanceof AssetDeliveryError) throw error;
      fail("ASSET_NETWORK_FAILED", key);
    }
  }
  async digest(
    key: string,
    limit = MAX_ARCHIVE_BYTES,
  ): Promise<RemoteDigest | null> {
    assertSafePath(key);
    try {
      const output = await this.client.send(
        new GetObjectCommand(this.input(key)),
        { abortSignal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) },
      );
      if (output.ContentLength !== undefined && output.ContentLength > limit) {
        stopBody(output.Body);
        fail("ASSET_LIMIT_EXCEEDED", key);
      }
      const digest = createHash("sha256");
      let size = 0;
      for await (const chunk of await bodyChunks(output.Body)) {
        size += chunk.byteLength;
        if (size > limit) {
          stopBody(output.Body);
          fail("ASSET_LIMIT_EXCEEDED", key);
        }
        digest.update(chunk);
      }
      return {
        bytes: size,
        sha256: digest.digest("hex"),
        etag: etag(output.ETag),
      };
    } catch (error) {
      if (isMissing(error)) return null;
      if (error instanceof AssetDeliveryError) throw error;
      fail("ASSET_NETWORK_FAILED", key);
    }
  }
  async putBytes(
    key: string,
    bytes: Uint8Array,
    options: RemotePutOptions = {},
  ): Promise<{ readonly etag: string }> {
    assertSafePath(key);
    try {
      const output = await this.client.send(
        new PutObjectCommand({
          ...this.input(key),
          Body: bytes,
          ContentLength: bytes.byteLength,
          CacheControl: options.cacheControl,
          ContentType: options.contentType,
          IfMatch: options.ifMatch,
          IfNoneMatch: options.ifNoneMatch ? "*" : undefined,
        }),
        { abortSignal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) },
      );
      return { etag: etag(output.ETag) };
    } catch (error) {
      if (isPrecondition(error)) throw new RemotePreconditionError();
      fail("ASSET_NETWORK_FAILED", key);
    }
  }
  async putFile(
    key: string,
    file: string,
    options: RemotePutOptions = {},
  ): Promise<{ readonly etag: string }> {
    assertSafePath(key);
    try {
      const info = await stat(file);
      if (!info.isFile() || info.size > MAX_ARCHIVE_BYTES)
        fail("ASSET_LIMIT_EXCEEDED", key);
      if (info.size <= MULTIPART_PART_BYTES)
        return await this.putStream(key, file, info.size, options);
      const upload = new Upload({
        client: this.client,
        queueSize: 3,
        partSize: MULTIPART_PART_BYTES,
        leavePartsOnError: false,
        params: {
          ...this.input(key),
          Body: createReadStream(file),
          ContentLength: info.size,
          CacheControl: options.cacheControl,
          ContentType: options.contentType,
        },
      });
      const output = await upload.done();
      return { etag: etag(output.ETag) };
    } catch (error) {
      if (error instanceof AssetDeliveryError) throw error;
      fail("ASSET_NETWORK_FAILED", key);
    }
  }
  private async putStream(
    key: string,
    file: string,
    size: number,
    options: RemotePutOptions,
  ): Promise<{ readonly etag: string }> {
    try {
      const output = await this.client.send(
        new PutObjectCommand({
          ...this.input(key),
          Body: createReadStream(file),
          ContentLength: size,
          CacheControl: options.cacheControl,
          ContentType: options.contentType,
          IfMatch: options.ifMatch,
          IfNoneMatch: options.ifNoneMatch ? "*" : undefined,
        }),
        { abortSignal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) },
      );
      return { etag: etag(output.ETag) };
    } catch (error) {
      if (isPrecondition(error)) throw new RemotePreconditionError();
      fail("ASSET_NETWORK_FAILED", key);
    }
  }
  async delete(key: string, options: RemoteDeleteOptions = {}): Promise<void> {
    assertSafePath(key);
    try {
      await this.client.send(
        new DeleteObjectCommand({
          ...this.input(key),
          IfMatch: options.ifMatch,
        }),
        { abortSignal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) },
      );
    } catch (error) {
      if (isPrecondition(error)) throw new RemotePreconditionError();
      fail("ASSET_NETWORK_FAILED", key);
    }
  }
}

export function createR2ObjectStore(
  config: AssetDeliveryConfig,
  environment: Readonly<Record<string, string | undefined>>,
): { readonly store: R2ObjectStore; readonly destroy: () => void } {
  const account = environment.ASSET_R2_ACCOUNT_ID;
  const accessKeyId = environment.ASSET_R2_ACCESS_KEY_ID;
  const secretAccessKey = environment.ASSET_R2_SECRET_ACCESS_KEY;
  if (!/^[a-f0-9]{32}$/.test(account ?? "") || !accessKeyId || !secretAccessKey)
    fail("ASSET_CONFIG_INVALID");
  const client = new S3Client({
    endpoint: `https://${account}.r2.cloudflarestorage.com`,
    region: "auto",
    credentials: { accessKeyId, secretAccessKey },
    maxAttempts: 3,
    followRegionRedirects: false,
    requestHandler: {
      connectionTimeout: 10_000,
      requestTimeout: REQUEST_TIMEOUT_MS,
    },
  });
  return {
    store: new R2ObjectStore(config, client),
    destroy: () => client.destroy(),
  };
}
