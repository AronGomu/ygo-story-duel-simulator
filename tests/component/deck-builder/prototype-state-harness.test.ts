// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/svelte";
import { userEvent } from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import PrototypeStateHarness from "../../../src/prototypes/deck-builder/components/PrototypeStateHarness.svelte";
import {
  applyPrototypeReviewState,
  PROTOTYPE_REVIEW_STATE_GROUPS,
} from "../../../src/prototypes/deck-builder/fixtures/states.ts";
import { PROTOTYPE_RULESET } from "../../../src/decks/catalog/pinned-ruleset.ts";
import {
  prototypeCatalogMap,
  stateFixture,
} from "../../fixtures/deck-builder.ts";

afterEach(() => cleanup());

describe("prototype state harness", () => {
  it("exposes deterministic review fixtures without mutating live state", async () => {
    const onchange = vi.fn();
    render(PrototypeStateHarness, { value: "live", onchange });
    await userEvent
      .setup()
      .selectOptions(screen.getByLabelText("State fixture"), "main-41");
    expect(onchange).toHaveBeenCalledWith("main-41");

    const live = stateFixture();
    const fixture = applyPrototypeReviewState(
      live,
      "main-41",
      prototypeCatalogMap,
      PROTOTYPE_RULESET,
    );
    expect(fixture.current?.deck.main).toHaveLength(41);
    expect(live.current?.deck.main).toHaveLength(0);
  });

  it("classifies every required scope state", () => {
    expect(PROTOTYPE_REVIEW_STATE_GROUPS.map(({ area }) => area)).toEqual([
      "Entry",
      "Library",
      "Editor",
      "Save",
      "History",
      "Catalog",
      "Details",
      "Drag",
      "Validation",
      "Import",
      "Export",
      "Delete",
      "Resolver",
    ]);
    expect(
      PROTOTYPE_REVIEW_STATE_GROUPS.every(({ states }) => states.length >= 3),
    ).toBe(true);
  });

  it("provides loading, failure, and conflict states", () => {
    const live = stateFixture();
    expect(
      applyPrototypeReviewState(
        live,
        "loading",
        prototypeCatalogMap,
        PROTOTYPE_RULESET,
      ).mode,
    ).toBe("loading");
    expect(
      applyPrototypeReviewState(
        live,
        "save-failure",
        prototypeCatalogMap,
        PROTOTYPE_RULESET,
      ).saveState,
    ).toBe("failed");
    expect(
      applyPrototypeReviewState(
        live,
        "revision-conflict",
        prototypeCatalogMap,
        PROTOTYPE_RULESET,
      ).saveState,
    ).toBe("conflict");
  });
});
