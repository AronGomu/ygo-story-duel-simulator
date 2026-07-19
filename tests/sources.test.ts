import assert from "node:assert/strict";
import test from "node:test";
import {
  validateGitRef,
  validatePinnedRevision,
} from "../scripts/lib/sources.ts";

test("Git source refs accept branches, tags and commit hashes", () => {
  assert.doesNotThrow(() => validateGitRef("master"));
  assert.doesNotThrow(() => validateGitRef("refs/tags/v1.2.3"));
  assert.doesNotThrow(() => validateGitRef("ed2e32c31c85bfa1fbbd37ffbb41265dd9f90ef7"));
});

test("pinned source revisions must match the checked-out commit", () => {
  const pinned = "ed2e32c31c85bfa1fbbd37ffbb41265dd9f90ef7";
  assert.doesNotThrow(() => validatePinnedRevision(pinned, pinned));
  assert.throws(
    () => validatePinnedRevision(pinned, "f".repeat(40)),
    /Pinned source revision mismatch/,
  );
  assert.doesNotThrow(() => validatePinnedRevision("review-branch", pinned));
});

test("Git source refs reject option and refspec injection", () => {
  for (const ref of ["--upload-pack=evil", "main:other", "main..other", "main^{}", "bad ref"] ) {
    assert.throws(() => validateGitRef(ref), /Unsafe or invalid Git ref/);
  }
});
