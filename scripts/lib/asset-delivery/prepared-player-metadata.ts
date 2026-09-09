import type { Sha256 } from "./identity.ts";
import type { FileDigest } from "./file-digest.ts";

export interface PreparedPlayerMetadata {
  readonly schemaVersion: 1;
  readonly sourceInputs: readonly FileDigest[];
  readonly runtimeSnapshotId: Sha256;
  readonly runtimeCardCodes: readonly number[];
  readonly chapters: readonly {
    readonly id: "chapter-01";
    readonly title: string;
    readonly storyContentId: "prototype-prologue-v1" | null;
    readonly setIds: readonly string[];
    readonly cardCodes: readonly number[];
    readonly opponentIds: readonly string[];
  }[];
}

import {
  array,
  assertSorted,
  hash,
  integer,
  literal,
  nullable,
  object,
  text,
  version,
} from "./schema.ts";
import { parseFileDigests } from "./file-digest.ts";
import { fail } from "./failure.ts";
import { compareCodePoints } from "./canonical-json.ts";
const cardCode = (value: unknown): number => {
  const code = integer(value);
  if (code === 0 || code > 0xffffffff) fail();
  return code;
};
export function parsePreparedPlayerMetadata(
  value: unknown,
): PreparedPlayerMetadata {
  const metadata = object(value, {
    schemaVersion: version,
    sourceInputs: parseFileDigests,
    runtimeSnapshotId: hash,
    runtimeCardCodes: array(cardCode, (v) => v),
    chapters: array(
      (v) =>
        object(v, {
          id: literal("chapter-01"),
          title: text,
          storyContentId: nullable(literal("prototype-prologue-v1")),
          setIds: array(text, (v) => v, 2048),
          cardCodes: array(cardCode, (v) => v),
          opponentIds: array(text, (v) => v),
        }),
      (chapter) => chapter.id,
      1,
    ),
  });
  assertSorted(metadata.runtimeCardCodes, (left, right) => left - right);
  for (const chapter of metadata.chapters) {
    assertSorted(chapter.cardCodes, (left, right) => left - right);
    assertSorted(chapter.setIds, compareCodePoints);
    assertSorted(chapter.opponentIds, compareCodePoints);
  }
  return metadata;
}
