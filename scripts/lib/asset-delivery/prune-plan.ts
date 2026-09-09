import type { Sha256 } from "./identity.ts";

export interface PruneCandidate {
  readonly path: string;
  readonly bytes: number;
  readonly sha256: Sha256;
}
export interface PrunePlan {
  readonly schemaVersion: 1;
  readonly scope: "local" | "remote";
  readonly basisSha256: Sha256;
  readonly candidates: readonly PruneCandidate[];
}

import {
  array,
  assertSorted,
  hash,
  literal,
  object,
  version,
} from "./schema.ts";
import { compareCodePoints } from "./canonical-json.ts";
import { parseFileDigest } from "./file-digest.ts";
import { parseObjectRef } from "./object-ref.ts";
import { assertManagedPath, assertNoPathCollisions } from "./path-guards.ts";
export function parsePruneCandidate(value: unknown): PruneCandidate {
  return parseFileDigest(value);
}
export function parsePrunePlan(value: unknown): PrunePlan {
  const plan = object(value, {
    schemaVersion: version,
    scope: literal("local", "remote"),
    basisSha256: hash,
    candidates: array(parsePruneCandidate),
  });
  for (const candidate of plan.candidates) {
    if (plan.scope === "local") assertManagedPath(candidate.path);
    else
      parseObjectRef({
        key: candidate.path,
        bytes: candidate.bytes,
        sha256: candidate.sha256,
      });
  }
  assertNoPathCollisions(plan.candidates.map((file) => file.path));
  assertSorted(plan.candidates, (left, right) =>
    compareCodePoints(left.path, right.path),
  );
  return plan;
}
