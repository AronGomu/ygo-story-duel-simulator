import type { StageMode } from "../../shell/index.ts";

/** Which of the editor's three surfaces the user is looking at. Above the
    stage breakpoint all three are on screen at once and the value only says
    which one a selection would have moved to. */
export type EditorPane = "catalog" | "deck" | "details";
export type EditorLayoutMode = "panels" | "tabs";

export function selectEditorLayoutMode(stageMode: StageMode): EditorLayoutMode {
  return stageMode === "stage" ? "panels" : "tabs";
}

/** Panels show deck beside catalog; tabs open catalog so entry focus has a
    mounted card-name field. */
export function defaultPane(mode: EditorLayoutMode = "panels"): EditorPane {
  return mode === "tabs" ? "catalog" : "deck";
}

/** Adding is a repeated action: the pane the add came from is the pane the
    next add comes from too, so a tap never costs a tab switch. */
export function paneAfterAdd(current: EditorPane): EditorPane {
  return current;
}

/** An explicit selection — a card the user asked about rather than moved —
    is only worth a pane change where the details are not already visible. */
export function paneAfterSelect(
  current: EditorPane,
  mode: EditorLayoutMode,
): EditorPane {
  return mode === "tabs" ? "details" : current;
}
