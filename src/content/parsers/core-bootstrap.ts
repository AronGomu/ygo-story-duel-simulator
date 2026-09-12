import type {
  CoreBootstrap,
  CoreChapterId,
} from "../contracts/core-bootstrap.ts";
import {
  array,
  hash,
  integer,
  invalid,
  literal,
  record,
  text,
  unique,
} from "./schema.ts";

const CHAPTER_ID = /^chapter-(0[1-9]|[1-9][0-9])$/;
const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

function absoluteUrl(value: string): URL {
  if (
    value.length > 2048 ||
    !value.endsWith("/") ||
    /[\\%?#\s\p{Cc}]/u.test(value)
  )
    invalid();
  try {
    const url = new URL(value);
    if (
      url.href !== value ||
      !url.hostname ||
      url.username ||
      url.password ||
      url.pathname
        .slice(1, -1)
        .split("/")
        .some((segment) => segment === "." || segment === "..")
    )
      invalid();
    return url;
  } catch (error) {
    if (error instanceof TypeError) invalid();
    throw error;
  }
}

function deliveryBaseUrl(value: unknown, appBaseUrl: string): string {
  if (typeof value !== "string") invalid();
  const app = absoluteUrl(appBaseUrl);
  const url = value === "./" ? app : absoluteUrl(value);
  if (url.protocol === "https:") return url.href;
  if (
    url.protocol !== "http:" ||
    !LOOPBACK_HOSTS.has(url.hostname) ||
    !LOOPBACK_HOSTS.has(app.hostname) ||
    url.origin !== app.origin
  )
    invalid();
  return url.href;
}

export function parseCoreBootstrap(
  value: unknown,
  appBaseUrl: string,
): CoreBootstrap {
  const v = record(value, [
    "schemaVersion",
    "appSchemaVersion",
    "contentSchemaVersion",
    "hashAlgorithm",
    "delivery",
    "chapters",
  ]);
  const chapters = array(
    v.chapters,
    (value) => {
      const chapter = record(value, ["id", "title", "description"]);
      if (typeof chapter.id !== "string" || !CHAPTER_ID.test(chapter.id))
        invalid();
      return {
        id: chapter.id as CoreChapterId,
        title: text(chapter.title),
        description: text(chapter.description),
      };
    },
    99,
  );
  if (chapters.length === 0) invalid();
  unique(chapters, ({ id }) => id);

  let delivery: CoreBootstrap["delivery"] = null;
  if (v.delivery !== null) {
    const candidate = record(v.delivery, ["baseUrl", "index"]);
    const index = record(candidate.index, ["sha256", "bytes"]);
    delivery = {
      baseUrl: deliveryBaseUrl(candidate.baseUrl, appBaseUrl),
      index: {
        sha256: hash(index.sha256),
        bytes: integer(index.bytes, 1048576, 1),
      },
    };
  }

  return {
    schemaVersion: literal(v.schemaVersion, 1),
    appSchemaVersion: literal(v.appSchemaVersion, 1),
    contentSchemaVersion: literal(v.contentSchemaVersion, 2),
    hashAlgorithm: literal(v.hashAlgorithm, "SHA-256"),
    delivery,
    chapters,
  };
}
