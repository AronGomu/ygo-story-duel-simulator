// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/svelte";
import { afterEach, describe, expect, it } from "vitest";
import CardTile from "../../../src/prototypes/deck-builder/components/CardTile.svelte";

afterEach(() => cleanup());

describe("missing-card placeholder", () => {
  it("retains the card code without inventing card metadata", () => {
    const { container } = render(CardTile, {
      card: null,
      code: 99999999,
      limit: 3,
      currentCopies: 1,
    });
    expect(
      screen.getByRole("button", { name: /Missing card 99999999/ }),
    ).toBeTruthy();
    expect(container.querySelector(".missing")).toBeTruthy();
    expect(container.textContent).not.toContain("Blue-Eyes");
  });
});
