import assert from "node:assert/strict";
import test from "node:test";
import { validateGitRef } from "../scripts/lib/sources.ts";

test("Git source refs accept branches, tags and commit hashes", () => {
  assert.doesNotThrow(() => validateGitRef("master"));
  assert.doesNotThrow(() => validateGitRef("refs/tags/v1.2.3"));
  assert.doesNotThrow(() => validateGitRef("ed2e32c31c85bfa1fbbd37ffbb41265dd9f90ef7"));
});

test("Git source refs reject option and refspec injection", () => {
  for (const ref of ["--upload-pack=evil", "main:other", "main..other", "main^{}", "bad ref"] ) {
    assert.throws(() => validateGitRef(ref), /Unsafe or invalid Git ref/);
  }
});
