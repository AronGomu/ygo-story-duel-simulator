// @vitest-environment jsdom

import { readFileSync } from "fs";
import { cleanup, render } from "@testing-library/svelte";
import { afterEach, describe, expect, it } from "vitest";
import DeckWorkspace from "../../../src/deck-editor/components/DeckWorkspace.svelte";
import { PROTOTYPE_RULESET } from "../../../src/decks/catalog/pinned-ruleset.ts";
import {
  deckFixture,
  prototypeCatalogMap,
} from "../../fixtures/deck-editor.ts";

afterEach(() => cleanup());

const WORKSPACE_SOURCE = readFileSync(
  "src/deck-editor/components/DeckWorkspace.svelte",
  "utf8",
);

describe("deck workspace selector contract", () => {
  it("exposes every deck zone through its data-cy", () => {
    const { container } = render(DeckWorkspace, {
      deck: deckFixture(3),
      catalog: prototypeCatalogMap,
      ruleset: PROTOTYPE_RULESET,
    });
    for (const zone of ["main", "extra", "side"])
      expect(
        container.querySelector(`[data-cy="deck-zone-${zone}"]`),
        `deck-zone-${zone} is missing`,
      ).not.toBeNull();
  });

  it("reserves its native scrollbar gutter before overflow", () => {
    expect(WORKSPACE_SOURCE).toMatch(
      /\.workspace\s*\{[^}]*scrollbar-gutter:\s*stable;/s,
    );
    expect(WORKSPACE_SOURCE).toMatch(
      /\.workspace\.filled\s*\{[^}]*scrollbar-gutter:\s*auto;/s,
    );
  });

  it("keeps the side deck header present while its body starts collapsed", () => {
    const { container } = render(DeckWorkspace, {
      deck: deckFixture(0),
      catalog: prototypeCatalogMap,
      ruleset: PROTOTYPE_RULESET,
    });
    expect(
      container.querySelector('[data-cy="deck-zone-toggle-side"]'),
    ).not.toBeNull();
    expect(
      container.querySelector('[data-cy="deck-zone-drop-area-side"]'),
    ).toBeNull();
  });
});
