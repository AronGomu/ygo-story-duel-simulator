// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/svelte";
import { afterEach, describe, expect, it, vi } from "vitest";
import ValidationIssues from "../../../src/prototypes/deck-builder/components/ValidationIssues.svelte";
import { stateFixture } from "../../fixtures/deck-builder.ts";

afterEach(() => cleanup());

describe("deck validation UI", () => {
  it("shows actionable issues only when validation has warnings/errors", () => {
    const validation = stateFixture().current!.deck.validation;
    const onfocusissue = vi.fn();
    render(ValidationIssues, { validation, onfocusissue });
    expect(screen.getByRole("heading", { name: "Deck checks" })).toBeTruthy();
    expect(
      screen.getByRole("button", { name: /Main Deck needs 40 more/ }),
    ).toBeTruthy();
  });

  it("renders no expanded panel for an issue-free summary", () => {
    render(ValidationIssues, {
      validation: { status: "valid", issues: [], rulesetRevision: "r1" },
      onfocusissue: vi.fn(),
    });
    expect(screen.queryByRole("heading", { name: "Deck checks" })).toBeNull();
  });
});
