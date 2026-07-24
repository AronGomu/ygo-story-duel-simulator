import { describe, expect, it } from "vitest";
import {
  parseReviewLink,
  serializeReviewLink,
  type ReviewState,
} from "../../../src/prototype/review/review-link.ts";

const state: ReviewState = {
  screen: "map",
  choice: "trust-rin",
  map: "available-completed",
  outcome: "loss",
  missingAssets: true,
  storageFailure: true,
  reducedMotion: true,
};

describe("review link", () => {
  it("serializes supported state into bounded allowlisted query", () => {
    const query = serializeReviewLink(state);
    expect(query.length).toBeLessThan(240);
    expect(query).not.toContain("{");
    expect(parseReviewLink(query)).toEqual(state);
  });

  it("falls back safely for malformed and unknown values", () => {
    expect(
      parseReviewLink(
        "?screen=<script>&choice=unknown&extra=%7B%22code%22%3A1%7D",
      ),
    ).toEqual({
      screen: "launcher",
      choice: null,
      map: "default",
      outcome: null,
      missingAssets: false,
      storageFailure: false,
      reducedMotion: false,
    });
  });

  it("restores copied supported review state", () => {
    const copied = `https://example.test/prototype.html${serializeReviewLink(state)}`;
    expect(parseReviewLink(new URL(copied).search)).toEqual(state);
  });
});
