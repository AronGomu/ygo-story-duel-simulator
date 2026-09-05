import { describe, expect, it } from "vitest";
import {
  defaultPane,
  paneAfterAdd,
  paneAfterSelect,
  selectEditorLayoutMode,
} from "../../../src/deck-editor/layout/editor-layout.ts";

describe("selectEditorLayoutMode", () => {
  it("keeps the three-panel desktop layout on the stage", () => {
    expect(selectEditorLayoutMode("stage")).toBe("panels");
  });

  it("maps both mobile modes to tabs", () => {
    expect(selectEditorLayoutMode("mobile-portrait")).toBe("tabs");
    expect(selectEditorLayoutMode("mobile-landscape")).toBe("tabs");
  });
});

describe("pane selection", () => {
  it("opens on the deck by default", () => {
    expect(defaultPane()).toBe("deck");
  });

  it("opens tabbed editors on catalog for entry focus", () => {
    expect(defaultPane("tabs")).toBe("catalog");
  });

  it("stays on the catalog after an add, so a second card is one tap away", () => {
    expect(paneAfterAdd("catalog")).toBe("catalog");
    expect(paneAfterAdd("deck")).toBe("deck");
  });

  it("shows details for an explicit selection only when panes are tabbed", () => {
    expect(paneAfterSelect("catalog", "tabs")).toBe("details");
    expect(paneAfterSelect("catalog", "panels")).toBe("catalog");
    expect(paneAfterSelect("deck", "panels")).toBe("deck");
  });
});
