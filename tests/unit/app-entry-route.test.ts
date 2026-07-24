import { describe, expect, it } from "vitest";
import { selectAppEntry } from "../../src/app/select-app-entry.ts";

describe("selectAppEntry", () => {
  it("keeps every ordinary route on the duel app", () => {
    expect(selectAppEntry("")).toBe("duel");
    expect(selectAppEntry("#/unknown")).toBe("duel");
  });

  it("selects only the isolated deck builder prototype hash", () => {
    expect(selectAppEntry("#/prototype/deck-builder")).toBe(
      "deck-builder-prototype",
    );
  });
});
