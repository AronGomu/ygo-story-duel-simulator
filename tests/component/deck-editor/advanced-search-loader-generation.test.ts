// @vitest-environment jsdom

import { describe, expect, it, vi } from "vitest";
import {
  openAdvancedSearch,
  type AdvancedSearchHost,
} from "../../../src/deck-editor/advanced-search-loader.ts";

function host(): AdvancedSearchHost {
  return {
    disposed: false,
    generation: 0,
    session: null,
    read: vi.fn(),
    onchange: vi.fn(),
    reset: vi.fn(),
    onopenchange: vi.fn(),
  };
}

describe("advanced search loader generation", () => {
  it("drops an open superseded before its async boundary", async () => {
    const value = host();
    const pending = openAdvancedSearch(value);
    value.generation += 1;

    await pending;
    expect(value.read).not.toHaveBeenCalled();
    expect(value.session).toBeNull();
  });

  it("drops an open after host disposal", async () => {
    const value = host();
    value.disposed = true;

    await openAdvancedSearch(value);
    expect(value.read).not.toHaveBeenCalled();
    expect(value.session).toBeNull();
  });
});
