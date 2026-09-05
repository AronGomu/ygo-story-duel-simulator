import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const REQUIRED_TOKENS = [
  "--bg",
  "--surface",
  "--surface-raised",
  "--border",
  "--text",
  "--muted",
  "--accent",
  "--accent-strong",
  "--legal",
  "--selected",
  "--danger",
  "--warning",
  "--focus-ring",
  "--space-1",
  "--space-2",
  "--space-3",
  "--space-4",
  "--space-5",
  "--space-6",
  "--radius-sm",
  "--radius-md",
  "--radius-lg",
  "--font-ui",
  "--text-xs",
  "--text-sm",
  "--text-md",
  "--text-lg",
  "--motion-fast",
  "--motion-base",
  "--duel-field-layer-surface",
  "--duel-field-layer-label",
  "--duel-field-layer-control",
  "--duel-field-layer-menu",
];

const SCROLLBAR_TOKENS = [
  "--scrollbar-track",
  "--scrollbar-thumb",
  "--scrollbar-thumb-hover",
  "--scrollbar-thumb-active",
  "--scrollbar-border",
] as const;

describe("design tokens", () => {
  it("token file declares every required token exactly once", () => {
    const tokens = readFileSync("src/styles/tokens.css", "utf8");
    for (const token of REQUIRED_TOKENS) {
      const declarations = tokens.match(new RegExp(`^\\s*${token}:`, "gm"));
      expect(declarations, `${token} declaration count`).toHaveLength(1);
    }
  });

  it("retunes VariantB tokens to the owner-approved values", () => {
    const tokens = readFileSync("src/styles/tokens.css", "utf8");
    for (const declaration of [
      "--glass: rgba(150, 175, 215, 0.02);",
      "--glass-strong: rgba(150, 175, 215, 0.036);",
      "--gold-line: rgba(211, 178, 104, 0.6);",
      "--chamfer: 6px;",
      "--ls-display: 0.16em;",
    ]) {
      expect(tokens).toContain(declaration);
    }
  });

  it("app stylesheet has no raw colors", () => {
    const css = stripComments(readFileSync("src/styles/app.css", "utf8"));
    expect(css.match(/#[0-9a-fA-F]{3,8}\b/g)).toBeNull();
    expect(css.match(/\brgba?\(/g)).toBeNull();
    expect(css.match(/\bhsla?\(/g)).toBeNull();
  });

  it("app stylesheet imports tokens first", () => {
    const css = stripComments(readFileSync("src/styles/app.css", "utf8"));
    const firstStatement = css
      .split("\n")
      .map((line) => line.trim())
      .find((line) => line.length > 0);
    expect(firstStatement).toBe('@import "./tokens.css";');
  });

  it("semantic tokens are distinct", () => {
    const tokens = readFileSync("src/styles/tokens.css", "utf8");
    const values = ["--legal", "--selected", "--focus-ring"].map((token) => {
      const match = tokens.match(new RegExp(`^\\s*${token}:\\s*([^;]+);`, "m"));
      expect(match, `${token} value`).not.toBeNull();
      return match![1]!.trim();
    });
    expect(new Set(values).size).toBe(3);
  });
});

describe("global styles", () => {
  it("declares Basilica Slate tokens for every native scrollbar state", () => {
    const tokens = readFileSync("src/styles/tokens.css", "utf8");
    for (const token of SCROLLBAR_TOKENS) {
      expect(
        tokens.match(new RegExp(`^\\s*${token}:`, "gm")),
        token,
      ).toHaveLength(1);
    }
    expect(tokens).toContain("--scrollbar-track: var(--surface-sunken);");
    expect(tokens).toContain("--scrollbar-thumb-hover: var(--border-light);");
    expect(tokens).toContain("--scrollbar-thumb-active: var(--accent-strong);");
    expect(tokens).toContain("--scrollbar-border: var(--border);");
  });

  it("brands visible native scrollbars globally without changing overlay hosts", () => {
    const css = readFileSync("src/styles/app.css", "utf8");
    const universal = ruleBlock(css, "* {");
    expect(universal).toContain(
      "scrollbar-color: var(--scrollbar-thumb) var(--scrollbar-track)",
    );
    expect(universal).toContain("scrollbar-width: thin");
    for (const selector of [
      "*::-webkit-scrollbar {",
      "*::-webkit-scrollbar-track {",
      "*::-webkit-scrollbar-thumb {",
      "*::-webkit-scrollbar-thumb:hover {",
      "*::-webkit-scrollbar-thumb:active {",
    ]) {
      expect(css, `${selector} missing`).toContain(selector);
    }
    expect(css).toContain("@media (forced-colors: active)");
    const forcedColorsStart = css.indexOf("@media (forced-colors: active)");
    expect(forcedColorsStart).toBeGreaterThan(-1);
    const forcedColors = css.slice(
      forcedColorsStart,
      css.indexOf("\nbody {", forcedColorsStart),
    );
    expect(forcedColors).toContain("scrollbar-color: auto");
    expect(forcedColors).not.toContain("display: none");
  });

  it("scopes native-hide declarations to every custom overlay host", () => {
    const hosts = [
      ["src/styles/app.css", ".card-preview-panel__text"],
      ["src/styles/app.css", ".duel-field-hand-band__viewport"],
      ["src/deck-editor/components/CardCatalog.svelte", ".results"],
    ] as const;
    for (const [file, selector] of hosts) {
      const source = readFileSync(file, "utf8");
      expect(
        ruleBlock(source, `${selector} {`),
        `${file} ${selector}`,
      ).toContain("scrollbar-width: none");
      expect(
        ruleBlock(source, `${selector}::-webkit-scrollbar {`),
        `${file} ${selector}`,
      ).toContain("display: none");
    }
  });

  it("keeps zone-list native chrome on shared scrollbar tokens", () => {
    const css = readFileSync("src/styles/app.css", "utf8");
    const entries = ruleBlock(css, ".zone-list-dialog__entries {", 0);
    expect(entries).toContain(
      "scrollbar-color: var(--scrollbar-thumb) var(--scrollbar-track)",
    );
    expect(css).toContain(
      ".zone-list-dialog__entries::-webkit-scrollbar-thumb:hover {",
    );
    expect(css).toContain(
      ".zone-list-dialog__entries::-webkit-scrollbar-thumb:active {",
    );

    const forcedColorsStart = css.indexOf(
      "@media (forced-colors: active)",
      css.indexOf("@media (forced-colors: active)") + 1,
    );
    expect(forcedColorsStart).toBeGreaterThan(-1);
    expect(
      ruleBlock(css, ".zone-list-dialog__entries {", forcedColorsStart),
    ).toContain("scrollbar-color: auto");
    expect(
      ruleBlock(css, ".zone-list-dialog__entries {", forcedColorsStart),
    ).toContain("scrollbar-width: auto");
    expect(
      ruleBlock(
        css,
        ".zone-list-dialog__entries::-webkit-scrollbar {",
        forcedColorsStart,
      ),
    ).toContain("height: auto");
    expect(
      ruleBlock(
        css,
        ".zone-list-dialog__entries::-webkit-scrollbar-thumb {",
        forcedColorsStart,
      ),
    ).toContain("background: CanvasText");
  });

  it("gives custom overlay thumbs visible forced-color system styling", () => {
    const css = readFileSync("src/styles/app.css", "utf8");
    const forcedColorsStart = css.indexOf(
      "@media (forced-colors: active)",
      css.indexOf("@media (forced-colors: active)") + 1,
    );
    expect(forcedColorsStart).toBeGreaterThan(-1);
    const overlayForcedColorsStart = css.lastIndexOf(
      ".overlay-scrollbar__thumb {",
    );
    expect(overlayForcedColorsStart).toBeGreaterThan(forcedColorsStart);
    const overlayThumb = ruleBlock(
      css,
      ".overlay-scrollbar__thumb {",
      overlayForcedColorsStart,
    );
    expect(overlayThumb).toContain("background: CanvasText");
    expect(overlayThumb).toContain("forced-color-adjust: none");
  });

  it("declares a global .visually-hidden clip utility", () => {
    const css = readFileSync("src/styles/app.css", "utf8");
    expect(css).toContain(".visually-hidden");
    expect(css).toContain("clip: rect(0 0 0 0)");
  });

  it("scopes the full-height duel grid to the shell region, not an app entry attribute", () => {
    const css = readFileSync("src/styles/app.css", "utf8");
    expect(css).not.toContain('#app[data-app-entry="duel"]');
    const region = ruleBlock(css, ".shell-region--duel {");
    expect(region).toContain("height: var(--stage-h, 100svh)");
    expect(region).toContain("display: grid");
    expect(region).toContain("grid-template-rows: auto minmax(0, 1fr)");
  });

  /* T4: the stage is the app's single layout box — centred inside `#app`,
     clipping its own overflow so `body` never scrolls in any mode. */
  it("centres a letterboxed stage that owns every axis of overflow", () => {
    const css = readFileSync("src/styles/app.css", "utf8");
    expect(ruleBlock(css, "\nbody {")).toContain("overflow: hidden");
    const root = ruleBlock(css, "\n#app {");
    expect(root).toContain("height: 100svh");
    expect(root).toContain("display: grid");
    expect(root).toContain("place-items: center");
    expect(root).toContain("background: var(--bg)");
    const stage = ruleBlock(css, ".app-stage {");
    expect(stage).toContain("width: var(--stage-w)");
    expect(stage).toContain("height: var(--stage-h)");
    expect(stage).toContain("margin: var(--space-2)");
    expect(stage).toContain("overflow: hidden");
    /* The box must be derived in CSS, not published from `AppShell`: a
       JS-published box trails a viewport change by at least a frame, so
       anything measuring right after a resize reads the previous stage. */
    expect(stage).toContain(
      "--stage-viewport-w: calc(100vw - var(--space-2) * 2)",
    );
    expect(stage).toContain(
      "--stage-viewport-h: calc(100svh - var(--space-2) * 2)",
    );
    expect(css).toContain(
      "@media (max-width: 1023.98px) and (orientation: portrait)",
    );
    const decks = ruleBlock(css, ".shell-region--decks {");
    expect(decks).toContain("min-height: 0");
    expect(decks).toContain("overflow: hidden");
  });

  /* The duel must measure the stage, not the viewport, or it keeps its old
     full-viewport height inside a letterboxed box. The field column reserves
     the fixed preview and rail inside that letterboxed width even though the
     duel route widens `--stage-w` to the viewport; the phase bar is stacked
     above the board rather than beside it, so it costs height, not width. */
  it("sizes the duel against the stage box with a viewport fallback", () => {
    const css = readFileSync("src/styles/app.css", "utf8");
    expect(ruleBlock(css, "main.is-duel-viewport {")).toContain(
      "height: var(--stage-h, 100svh)",
    );
    const slot = ruleBlock(css, ".duel-field-slot {");
    expect(slot).toContain(
      "width: calc(\n    var(--stage-h, 100svh) * 16 / 9 - var(--preview-w) - var(--rail-min)\n  )",
    );
    expect(slot).toContain("height: calc(100% - var(--phase-bar-h))");
    expect(slot).not.toContain("width: calc(var(--stage-w");
    expect(slot).toContain("margin-inline: var(--duel-field-margin, 0px)");
  });

  /* The duel is the only route that spends the pillarbox, and only above the
     breakpoint. Losing either half of that condition would stretch the shared
     stage for every other domain, or hand a phone's bars to a cramped rail. */
  it("lets only the duel route spend the pillarbox above the breakpoint", () => {
    const css = readFileSync("src/styles/app.css", "utf8");
    const bleed = ruleBlock(
      css,
      '.app-stage[data-stage-route="free-play"],\n  .app-stage[data-stage-route="duel-session"] {',
    );
    expect(bleed).toContain("--stage-w: var(--stage-viewport-w)");
    // The inset is only ever paid out of the reclaimed bar, so an exactly-16:9
    // viewport keeps the board it has today.
    expect(bleed).toContain("--duel-field-margin: clamp(");
    expect(bleed).toContain(
      "calc((var(--stage-viewport-w) - var(--stage-h) * 16 / 9) / 2)",
    );
    expect(bleed).toContain("var(--duel-field-inset)");
    expect(css.slice(0, css.indexOf(bleed))).toMatch(
      /@media \(min-width: 1024px\) \{\s*$/,
    );
  });

  it("keeps acceptance-only field sizing out of the production stylesheet", () => {
    const productionCss = readFileSync("src/styles/app.css", "utf8");
    const acceptanceCss = readFileSync("src/styles/acceptance.css", "utf8");
    const acceptanceEntry = readFileSync("src/acceptance-main.ts", "utf8");
    expect(productionCss).not.toContain(".acceptance-card-list-field");
    expect(acceptanceCss).toContain(".acceptance-card-list-field");
    expect(acceptanceEntry).toContain('import "./styles/acceptance.css"');
  });

  it("duel field does not contain overscroll", () => {
    const css = readFileSync("src/styles/app.css", "utf8");
    const block = duelFieldBlock(css);
    expect(block).not.toContain("overscroll-behavior: contain");
    expect(block).not.toContain("overflow: auto");
  });

  it("duel field is not height-capped on small screens", () => {
    const css = readFileSync("src/styles/app.css", "utf8");
    expect(css).not.toContain("max-height: calc(100svh - 1rem)");
  });

  it("uses one full-height three-column shell", () => {
    const css = readFileSync("src/styles/app.css", "utf8");
    const shell = ruleBlock(css, ".duel-shell {");
    expect(shell).toContain("height: var(--stage-h, 100svh)");
    expect(shell).toContain(
      "grid-template-columns: var(--preview-w) auto minmax(var(--rail-min), 1fr)",
    );
    expect(shell).toContain("grid-template-rows: minmax(0, 1fr)");
    expect(shell).toContain("overflow: hidden");
    expect(css).toContain("--preview-w: 15.5rem");
    expect(css).toContain("--rail-min: 11rem");
    expect(css).toContain("--phase-bar-h: 3rem");
  });

  it("bounds preview art by viewport height so effect text keeps scroll space", () => {
    const css = readFileSync("src/styles/app.css", "utf8");
    const art = ruleBlock(css, ".card-preview-panel__art img {");
    expect(art).toContain(
      "max-height: min(22rem, calc(var(--stage-h, 100svh) * 0.48))",
    );
    expect(art).toContain("object-fit: contain");
  });

  /* Effect text is prose in a 15.5rem column: justification would open rivers
     between the words, so the flow stays left-aligned and says so explicitly
     rather than relying on an inherited default. */
  it("preview effect text is not justified", () => {
    const css = readFileSync("src/styles/app.css", "utf8");
    const text = ruleBlock(css, ".card-preview-panel__text {");
    expect(text).not.toContain("text-align: justify");
    expect(text).toContain("text-align: left");
  });

  /* The body renders three children with stats and two without, so a fixed
     two-row grid template handed the free space to whichever child landed in
     the flexible row — the stats line, which then stretched ~390px tall and
     pushed the effect text to the bottom of the panel. A column flex box is
     shape agnostic: name and stats size to content and the text region takes
     the rest, with or without the optional stats row. */
  it("preview body is a column whose text region takes the free space", () => {
    const css = readFileSync("src/styles/app.css", "utf8");
    const body = ruleBlock(css, ".card-preview-panel__body {");
    expect(body).toContain("display: flex");
    expect(body).toContain("flex-direction: column");
    expect(body).not.toContain("grid-template-rows");
    expect(ruleBlock(css, ".card-preview-panel__text-region {")).toContain(
      "flex: 1 1 auto",
    );
  });

  /* One gap law in the panel body: the flex `gap` is the only thing between
     name, stats and effect text. A margin on any of the three rows would add a
     second, larger gap under it and break that rhythm.

     The name is the row that has to be held to it explicitly. It is an `h2`,
     so it arrives carrying the global heading margin, and a flex gap does not
     collapse with a margin the way stacked block margins do — the two add up.
     Asserting the `gap` alone left that unread, which is how name→stats shipped
     at 0.90rem against stats→text's 0.35rem. */
  it("preview name, stats and effect text share the body gap", () => {
    const css = readFileSync("src/styles/app.css", "utf8");
    expect(ruleBlock(css, ".card-preview-panel__stats {")).toContain(
      "margin: 0;",
    );
    expect(ruleBlock(css, ".card-preview-panel__body {")).toContain(
      "gap: 0.35rem",
    );
    /* The global rule this cancels, so a heading margin change cannot quietly
       re-open the gap: whatever `h2` is worth elsewhere, it is worth nothing
       inside this panel. */
    expect(ruleBlock(css, "h2,\nh3,\nh4 {")).toMatch(/margin-bottom:\s*\S+;/);
    expect(ruleBlock(css, ".card-preview-panel__body h2 {")).toContain(
      "margin-bottom: 0;",
    );
  });

  it("preview text keeps its own scroll region", () => {
    const css = readFileSync("src/styles/app.css", "utf8");
    expect(ruleBlock(css, ".card-preview-panel__text {")).toContain(
      "overflow-y: auto",
    );
  });

  it("board is explicit geometry without width-only stretch", () => {
    const css = readFileSync("src/styles/app.css", "utf8");
    const block = ruleBlock(css, ".duel-field-board {");
    expect(block).toContain("width: 100%");
    expect(block).toContain("height: 100%");
    expect(block).not.toContain("aspect-ratio");
  });

  it("board uses explicit geometry while interaction controls keep 44px floors", () => {
    const css = readFileSync("src/styles/app.css", "utf8");
    expect(ruleBlock(css, ".duel-field-board {")).toContain("height: 100%");
    expect(ruleBlock(css, ".duel-field-card__target {")).toContain(
      "min-width: max(100%, 2.75rem)",
    );
    expect(ruleBlock(css, ".duel-field-scroll-region {")).toContain(
      "overflow: hidden",
    );
  });

  it("the duel field root never scrolls, so windows cannot be panned away", () => {
    const css = readFileSync("src/styles/app.css", "utf8");
    const block = duelFieldBlock(css);
    expect(block).toContain("overflow: hidden");
    expect(block).toContain("position: relative");
  });

  it("declares concentric px zone slots six pixels wider than cards", () => {
    const css = readFileSync("src/styles/app.css", "utf8");
    const slot = ruleBlock(css, ".duel-field-zone__slot {");
    expect(slot).toContain("+ 6px");
    expect(slot).toContain("translate(-50%, -50%)");
  });

  /* Item 2 (2026-09-02, owner): an empty pile must not read as a covered
     card — no purple pile gradient, no purple border. It wears the same
     neutral outline and fill as an empty zone, hover included, since an
     empty pile is still hoverable. */
  it("an empty pile paints the neutral zone fill, not the pile chrome", () => {
    const css = readFileSync("src/styles/app.css", "utf8");
    const block = ruleBlock(css, ".duel-field-stack.is-empty {");
    expect(block).toContain("var(--field-zone-fill)");
    expect(block).toContain("var(--field-zone-outline)");
    expect(block).not.toContain("var(--stack-accent)");
    expect(block).not.toContain("var(--stack-surface)");
    expect(css).toContain(
      ".duel-field-stack:hover:not(:disabled):not(.is-empty)",
    );
  });

  it("the actionable halo is green, not orange", () => {
    const css = readFileSync("src/styles/app.css", "utf8");
    const block = ruleBlock(
      css,
      ".duel-field-zone.is-actionable,\n.duel-field-card.is-actionable .duel-field-card__art {",
    );
    expect(block).toContain("var(--success)");
    expect(block).not.toContain("var(--warning)");
  });

  /* Item 12 (2026-08-27, owner): the pile halo is orange, unlike every other
     actionable halo — an actionable pile points at where the game is asking,
     not at a card the player can read and play. The list entries inside the
     pile stay green, because those are the playable cards themselves. */
  it("actionable pile halos are orange, list halos stay green", () => {
    const css = readFileSync("src/styles/app.css", "utf8");
    const stack = ruleBlock(css, ".duel-field-stack.is-actionable {");
    expect(stack).toContain("var(--selected)");
    expect(stack).not.toContain("var(--success)");
    expect(stack).not.toContain("var(--legal)");
    const list = ruleBlock(css, ".zone-list-entry.is-actionable img {");
    expect(list).toContain("var(--success)");
    expect(list).not.toContain("var(--warning)");
  });

  it("selected halos are orange, overriding legal green", () => {
    const css = readFileSync("src/styles/app.css", "utf8");
    const field = ruleBlock(
      css,
      ".duel-field-zone.is-selected,\n.duel-field-card.is-selected .duel-field-card__art {",
    );
    expect(field).toContain("var(--warning)");
    expect(field).not.toContain("var(--success)");
    const list = ruleBlock(css, ".zone-list-entry.is-selected img {");
    expect(list).toContain("var(--warning)");
    expect(list).not.toContain("var(--success)");
  });

  it("unavailable target halos stay red through hover and focus", () => {
    const css = readFileSync("src/styles/app.css", "utf8");
    const unavailable = ruleBlock(
      css,
      ".zone-list-entry.is-unavailable:not(.is-selected) img,",
    );
    expect(unavailable).toContain(":hover img");
    expect(unavailable).toContain(":focus-within img");
    expect(unavailable).toContain("border-color: var(--danger)");
    expect(unavailable).toContain(
      "color-mix(in srgb, var(--danger) 65%, transparent)",
    );
    expect(unavailable).not.toContain("var(--warning)");
  });

  it("drop candidate is green with a translucent fill, distinct from plain legal", () => {
    const css = readFileSync("src/styles/app.css", "utf8");
    const block = ruleBlock(css, ".duel-field-zone.is-drop-candidate {");
    expect(block).toContain("border-color: var(--success)");
    expect(block).toMatch(
      /background: color-mix\(in srgb, var\(--legal\) \d+%, transparent\)/,
    );
    expect(block).toContain("box-shadow");
  });

  it("keyboard focus is a neutral outline, independent of legal/selected colours", () => {
    const css = readFileSync("src/styles/app.css", "utf8");
    const block = ruleBlock(
      css,
      ".duel-field-zone.is-navigation-active:focus-visible,",
    );
    expect(block).toContain("outline: 3px solid var(--ink)");
    expect(block).toContain("outline-offset: 2px");
    expect(block).not.toContain("var(--success)");
    expect(block).not.toContain("var(--warning)");
  });

  it("feedback target and default field line are teal; attack stays danger", () => {
    const css = readFileSync("src/styles/app.css", "utf8");
    const target = ruleBlock(
      css,
      ".duel-field-card.is-feedback-target .duel-field-card__art,",
    );
    expect(target).toContain("var(--accent)");
    expect(target).not.toContain("var(--warning)");
    const line = ruleBlock(css, ".field-lines line {");
    expect(line).toContain("stroke: var(--accent)");
    const attackLine = ruleBlock(css, ".field-lines.is-attack line {");
    expect(attackLine).toContain("var(--danger)");
  });

  it("the action/phase badge at the opponent hand position (item 26) is gone from the stylesheet", () => {
    const css = readFileSync("src/styles/app.css", "utf8");
    expect(css).not.toContain(".duel-field-feedback");
  });

  it("card entries hover-scale 1.35 and list interaction states scale 1.6", () => {
    const css = readFileSync("src/styles/app.css", "utf8");
    const card = ruleBlock(
      css,
      ".duel-field-card {\n  z-index: var(--duel-field-layer-card);",
    );
    expect(card).toContain("transition: transform 120ms ease-out");
    const list = ruleBlock(css, ".zone-list-entry {");
    expect(list).toContain("transition: transform 120ms ease-out");
    // Board cards lost their hover/focus zoom (owner feedback item 7), so the
    // hand lift below is the only surviving 1.35x on a field card.
    expect(css).not.toContain(
      ".duel-field-card.is-identity-known:not(.is-hand-item):not(.is-pinned):is(\n    :hover,\n    :focus-within\n  ) {\n  transform: translate(-50%, -50%) scale(1.35);",
    );
    const handHover = ruleBlock(
      css,
      ".duel-field-card.is-identity-known.is-hand-item:not(.is-pinned):focus-within {",
    );
    expect(handHover).toContain("scale(1.35)");
    const listSelector =
      ".zone-list-entry:is(:hover, :focus-within, .is-selected, .is-menu-open) {";
    const listZoom = ruleBlock(
      css,
      listSelector,
      css.indexOf(listSelector) + listSelector.length,
    );
    expect(listZoom).toContain("scale(1.6)");
    expect(ruleBlock(css, ".zone-list-entry.is-hover-suppressed {")).toContain(
      "transform: none",
    );
  });

  it("hand item transform-origin is bottom for player, top for opponent; field origin is centre", () => {
    const css = readFileSync("src/styles/app.css", "utf8");
    const card = ruleBlock(
      css,
      ".duel-field-card {\n  z-index: var(--duel-field-layer-card);",
    );
    expect(card).toContain("transform-origin: center");
    const handItem = ruleBlock(css, ".duel-field-card.is-hand-item {");
    expect(handItem).toContain("transform-origin: center bottom");
    const opponentHand = ruleBlock(
      css,
      ".duel-field-card.is-hand-item.is-opponent {",
    );
    expect(opponentHand).toContain("transform-origin: center top");
  });

  it("reduced motion disables card/list zoom transform and transition", () => {
    const css = readFileSync("src/styles/app.css", "utf8");
    const blocks = [
      ...css.matchAll(
        /@media \(prefers-reduced-motion: reduce\) \{[\s\S]*?\n\}\n/g,
      ),
    ].map((match) => match[0]);
    const zoomBlock = blocks.find((block) =>
      block.includes(".duel-field-card,"),
    );
    expect(zoomBlock).toBeDefined();
    expect(zoomBlock).toContain("transition: none");
    expect(zoomBlock).toContain("transform: none");
  });

  /* T16: a target answer button is the only control on a list entry in target
     mode, so it carries the field-wide 44px minimum itself. */
  it("off-field target buttons keep the 44px minimum and a single choice fills its tile", () => {
    const css = readFileSync("src/styles/app.css", "utf8");
    const button = ruleBlock(css, ".zone-list-entry__target {");
    expect(button).toContain("min-width: 2.75rem");
    expect(button).toContain("min-height: 2.75rem");
    const single = ruleBlock(css, ".zone-list-entry__targets.is-single {");
    expect(single).toContain("inset: 0");
  });

  it("hovered/focused/pinned card parent rises above normal card/stack/zone siblings", () => {
    const css = readFileSync("src/styles/app.css", "utf8");
    const block = ruleBlock(
      css,
      ".duel-field-card:is(:hover, :focus-within),\n.duel-field-card.is-pinned {",
    );
    expect(block).toContain("var(--duel-field-layer-card-raised)");
    const tokens = readFileSync("src/styles/tokens.css", "utf8");
    expect(tokens).toContain("--duel-field-layer-card-raised: 35");
    expect(tokens).toContain("--duel-field-layer-card: 30");
  });

  /* jsdom loads no stylesheet, so no component test can observe `display`, and
     the e2e only ever reaches the chips through the pinned path. Without this
     row both reveal triggers could be deleted with the suite still green. */
  it("chips use square branded controls with complete interaction states", () => {
    const css = readFileSync("src/styles/app.css", "utf8");
    const enlargedChip = ruleBlock(
      css,
      ".duel-field-card .card-action-chip,\n.hand-zoom-overlay .card-action-chip {",
    );
    expect(enlargedChip).toContain("border-radius: 0;");
    const chip = ruleBlock(css, "button.card-action-chip {");
    expect(chip).toContain("border: 1px solid var(--gold-line)");
    expect(chip).toContain("border-radius: 0");
    expect(chip).toContain("cursor: pointer");
    const hover = ruleBlock(
      css,
      "button.card-action-chip:hover:not(:disabled) {",
    );
    expect(hover).toContain("background: var(--selected-strong)");
    const focus = ruleBlock(css, "button.card-action-chip:focus-visible {");
    expect(focus).toContain("outline: 2px solid var(--focus-ring)");
    const disabled = ruleBlock(css, "button.card-action-chip:disabled {");
    expect(disabled).toContain("cursor: not-allowed");
    expect(disabled).toContain("background: var(--neutral)");
  });

  it("zoom halo styles preserve legal, selected and selection-family semantics", () => {
    const css = readFileSync("src/styles/app.css", "utf8");
    const legal = ruleBlock(
      css,
      ".hand-zoom-overlay.is-legal .hand-zoom-overlay__art {",
    );
    expect(legal).toContain("var(--legal)");
    const selected = ruleBlock(
      css,
      ".hand-zoom-overlay.is-selected .hand-zoom-overlay__art {",
    );
    expect(selected).toContain("border: 3px solid var(--selected)");
    expect(selected).toContain("box-shadow:");
    expect(selected).toContain("var(--selected)");
    const dashedLegal = ruleBlock(
      css,
      ".hand-zoom-overlay.is-selection-candidate.is-legal .hand-zoom-overlay__art {",
    );
    expect(dashedLegal).toContain("border: 3px dashed var(--success)");
    expect(dashedLegal).toContain("box-shadow: none");
    const dashedSelected = ruleBlock(
      css,
      ".hand-zoom-overlay.is-selection-candidate.is-selected .hand-zoom-overlay__art {",
    );
    expect(dashedSelected).toContain("border: 3px dashed var(--selected)");
    expect(dashedSelected).toContain("box-shadow: none");
  });

  it("chips are hidden until hover, focus or a pin reveals them", () => {
    const css = readFileSync("src/styles/app.css", "utf8");
    const chips = ruleBlock(css, "\n.card-action-chips {");
    expect(chips).toContain("display: none");
    /* 2026-08-27 item 2: anchored on the card's bottom edge and growing up.
       The height cap is what keeps a hand card's chips inside the band's
       clipped scrollport, which the old centring used to buy — past it the
       stack scrolls rather than overflowing the card's top edge. */
    expect(chips).toContain("top: auto");
    expect(chips).toContain("bottom: 0");
    expect(chips).toContain("flex-direction: column-reverse");
    expect(chips).toContain("height: fit-content");
    expect(chips).toContain("max-height: 100%");
    expect(chips).toContain("overflow-y: auto");
    /* The overlay's own copy inherits that anchor instead of setting its own,
       itself, so it may not redeclare an edge; all it adds is the reveal and
       the hit testing its pointer-transparent parent gave up. */
    const overlayChips = ruleBlock(
      css,
      ".hand-zoom-overlay .card-action-chips {",
    );
    expect(overlayChips).toContain("display: flex");
    expect(overlayChips).toContain("pointer-events: auto");
    expect(overlayChips).not.toContain("top:");
    expect(overlayChips).not.toContain("bottom:");
    const reveal = ruleBlock(
      css,
      ".duel-field-card.is-actionable:hover .card-action-chips,\n.duel-field-card.is-actionable:focus-within .card-action-chips,\n.duel-field-card.is-pinned .card-action-chips {",
    );
    expect(reveal).toContain("display: flex");
  });

  /* The phase pane is narrow, so the engine label needs the shared chip's
     no-wrap rule. Without it `End Battle Phase` can break over several rows
     and no jsdom test can see the layout defect. */
  it("phase chips never wrap their labels", () => {
    const css = readFileSync("src/styles/app.css", "utf8");
    expect(ruleBlock(css, "\n.phase-chip {")).toContain("white-space: nowrap");
  });

  it("phase chips keep the 44px control minimum", () => {
    const css = readFileSync("src/styles/app.css", "utf8");
    expect(ruleBlock(css, "\n.phase-chip {")).toContain("min-block-size: 44px");
  });

  /* Both bands centre their cluster with an `auto` margin on the *outer* side
     of each end card. Which physical side that is depends on the flex
     direction: the opponent band is `row-reverse`, so its first child sits on
     the right and the plain `:first-child { margin-left: auto }` pair lands both
     margins inside the cluster — three opponent cards then spread to the band's
     two edges instead of grouping. jsdom computes no layout, so only the
     selector pairing can be pinned here. */
  it("both hand bands centre their cards, the mirrored opponent band included", () => {
    const css = normalizeWhitespace(readFileSync("src/styles/app.css", "utf8"));
    const outer = (
      side: "left" | "right",
      localEnd: "first" | "last",
    ): string =>
      `.duel-field-hand-band:not(.is-opponent) .duel-field-hand-band__viewport > .duel-field-card.is-hand-item:${localEnd}-child, .duel-field-hand-band.is-opponent .duel-field-hand-band__viewport > .duel-field-card.is-hand-item:${localEnd === "first" ? "last" : "first"}-child { margin-${side}: auto; }`;
    expect(css).toContain(outer("left", "first"));
    expect(css).toContain(outer("right", "last"));
  });

  /* Measured in headless Chromium 1.61.1 on 2026-08-21: `justify-content: safe
     center` does centre both bands while the hand fits, but `safe` falls back to
     writing-mode start, not flex start. Under `row-reverse` that puts the
     overflow on the scroll-origin side: with 12 cards the viewport reported
     `scrollWidth === clientWidth`, a scroll range of `[0, 0]` and 0% of the first
     card visible — an opponent hand wider than its band became unreachable. The
     auto margins collapse to zero on overflow instead and leave the scroll
     extent alone, so the viewport must not align its content at all. */
  it("hand viewport never aligns its content, so overflow stays reachable", () => {
    const css = readFileSync("src/styles/app.css", "utf8");
    const block = ruleBlock(css, "\n.duel-field-hand-band__viewport {");
    expect(block).toContain("overflow-x: auto");
    expect(block).not.toContain("justify-content");
  });

  /* T5: the fanned hand droops its outer cards below the band box and
     `overflow-y: hidden` clips at the padding edge, so the viewport has to
     carry the arc's headroom itself. Under the global `border-box` the
     padding alone would only shrink the content box, leaving the clip edge
     where it was: the matching height growth is what moves the clip edge
     under the deepest card corner. The 0.17 factor is measured, not chosen:
     the deepest corner is the 0.12 droop plus the bottom corner's sweep
     through the 6deg fan, and Chromium clipped the outermost card of a five
     card hand by 3.22px at 0.14. */
  it("hand viewport reserves clip headroom for the fan arc", () => {
    const css = readFileSync("src/styles/app.css", "utf8");
    const block = ruleBlock(css, "\n.duel-field-hand-band__viewport {");
    expect(block).toContain(
      "padding-bottom: calc(var(--hand-card-height) * 0.17)",
    );
    expect(block).toContain(
      "height: calc(100% + var(--hand-card-height) * 0.17)",
    );
    expect(block).toContain("overflow-y: hidden");
  });

  it("opponent hand band keeps its mirrored direction", () => {
    const css = readFileSync("src/styles/app.css", "utf8");
    expect(
      ruleBlock(
        css,
        ".duel-field-hand-band.is-opponent .duel-field-hand-band__viewport {",
      ),
    ).toContain("flex-direction: row-reverse");
  });

  // T8: both hands render through HandBand, which paints no border,
  // background or ZoneControl at all — there is no dashed hand-zone
  // treatment left to make transparent for the opponent specifically.
  it("hand band paints no border or background", () => {
    const css = readFileSync("src/styles/app.css", "utf8");
    expect(css).not.toContain('.duel-field-zone[data-zone-kind="hand"]');
    expect(css).not.toContain('.duel-field-zone[data-zone-id="p1:hand"]');
    const block = ruleBlock(css, ".duel-field-hand-band {");
    expect(block).not.toContain("border");
    expect(block).not.toContain("background");
  });

  it("drag ghost is fixed, pointer-transparent and layered above field windows", () => {
    const css = readFileSync("src/styles/app.css", "utf8");
    expect(readFileSync("src/styles/tokens.css", "utf8")).toContain(
      "--duel-field-layer-drag-ghost: 150",
    );
    const block = ruleBlock(css, ".drag-ghost {");
    expect(block).toContain("position: fixed");
    expect(block).toContain("pointer-events: none");
    expect(block).toContain("z-index: var(--duel-field-layer-drag-ghost)");
    expect(block).toContain("scale(var(--drag-ghost-lift-scale, 1.08))");
    expect(block).toContain("box-shadow");
  });

  it("reduced motion strips the drag ghost's lift transform", () => {
    const css = readFileSync("src/styles/app.css", "utf8");
    const reducedMotionBlockStart = css.indexOf(
      "@media (prefers-reduced-motion: reduce) {\n  .drag-ghost {",
    );
    expect(reducedMotionBlockStart).toBeGreaterThan(-1);
    const block = ruleBlock(css, ".drag-ghost {", reducedMotionBlockStart);
    expect(block).toContain(
      "transform: translate3d(var(--drag-ghost-x), var(--drag-ghost-y), 0)",
    );
    expect(block).not.toContain("scale(");
  });
});

function stripComments(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, "");
}

function normalizeWhitespace(css: string): string {
  return stripComments(css).replace(/\s+/g, " ");
}

function ruleBlock(css: string, selectorStart: string, fromIndex = 0): string {
  const start = css.indexOf(selectorStart, fromIndex);
  if (start === -1) throw new Error(`Selector not found: ${selectorStart}`);
  const end = css.indexOf("}", start);
  return css.slice(start, end + 1);
}

function duelFieldBlock(css: string): string {
  return ruleBlock(css, ".duel-field {");
}

/* T16: raw colour ban across the three restyled domains. */
describe("domain raw colour ban (T16)", () => {
  const RAW_COLOUR_RE = /#[0-9a-fA-F]{3,8}\b|\brgba?\(|\bhsla?\(/;
  const DOMAIN_ROOTS = ["src/shell", "src/deck-editor", "src/story"];

  const collectFiles = (dir: string): string[] => {
    const entries = readdirSync(dir, { withFileTypes: true });
    return entries.flatMap((e) => {
      const fullPath = join(dir, e.name);
      if (e.isDirectory()) return collectFiles(fullPath);
      if (e.isFile() && (e.name.endsWith(".svelte") || e.name.endsWith(".css")))
        return [fullPath];
      return [];
    });
  };

  it("no raw hex / rgb / hsl literals in shell, deck-editor or story styles", () => {
    const hits: string[] = [];
    for (const root of DOMAIN_ROOTS) {
      for (const file of collectFiles(root)) {
        const source = readFileSync(file, "utf8");
        const styleMatch = source.match(/<style[^>]*>([\s\S]*?)<\/style>/g);
        const blocks = styleMatch
          ? styleMatch.map((b) =>
              b.replace(/<style[^>]*>/, "").replace(/<\/style>/, ""),
            )
          : file.endsWith(".css")
            ? [source]
            : [];
        for (const block of blocks) {
          const stripped = block.replace(/\/\*[\s\S]*?\*\//g, "");
          const lines = stripped.split("\n");
          for (let i = 0; i < lines.length; i++) {
            if (RAW_COLOUR_RE.test(lines[i]!)) {
              hits.push(`${file}:${i + 1}: ${lines[i]!.trim()}`);
            }
          }
        }
      }
    }
    expect(hits, "raw colours found").toEqual([]);
  });
});

describe("primitives.css (T16)", () => {
  const PRIMITIVE_CLASSES = [
    ".ui-button",
    ".ui-button--primary",
    ".ui-button--secondary",
    ".ui-button--danger",
    ".ui-panel",
    ".ui-overlay",
    ".ui-field",
    ".ui-focusable:focus-visible",
    ".ui-chamfer",
    ".ui-glass-panel",
    ".ui-dialog-panel",
    ".ui-dialog-title",
  ];

  it("primitives.css declares each .ui-* class at least once", () => {
    const css = readFileSync("src/styles/primitives.css", "utf8");
    for (const cls of PRIMITIVE_CLASSES) {
      expect(css, `${cls} not found in primitives.css`).toContain(cls);
    }
  });

  it("primitives.css contains no raw colour literals", () => {
    const css = readFileSync("src/styles/primitives.css", "utf8");
    const stripped = css.replace(/\/\*[\s\S]*?\*\//g, "");
    expect(stripped.match(/#[0-9a-fA-F]{3,8}\b/g)).toBeNull();
    expect(stripped.match(/\brgba?\(/g)).toBeNull();
    expect(stripped.match(/\bhsla?\(/g)).toBeNull();
  });

  it("app.css imports primitives.css after tokens.css", () => {
    const css = readFileSync("src/styles/app.css", "utf8");
    const tokensIdx = css.indexOf('@import "./tokens.css"');
    const primitivesIdx = css.indexOf('@import "./primitives.css"');
    expect(tokensIdx, "tokens.css import missing").toBeGreaterThan(-1);
    expect(primitivesIdx, "primitives.css import missing").toBeGreaterThan(-1);
    expect(primitivesIdx).toBeGreaterThan(tokensIdx);
  });
});

describe("deck editor sizing", () => {
  it("the shared preview width is card sized", () => {
    const css = readFileSync("src/styles/app.css", "utf8");
    const rootMatches = css.match(/--preview-w:\s*15\.5rem;/g);
    expect(
      rootMatches,
      "root --preview-w should be 15.5rem exactly once",
    ).toHaveLength(1);
    const subMatches = css.match(/--preview-w:\s*13\.5rem;/g);
    expect(
      subMatches,
      "sub-breakpoint --preview-w should be 13.5rem exactly once",
    ).toHaveLength(1);
  });

  const editorComponentPaths = (dir = "src/deck-editor"): string[] =>
    readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
      const fullPath = join(dir, entry.name);
      if (entry.isDirectory()) return editorComponentPaths(fullPath);
      return entry.isFile() && entry.name.endsWith(".svelte") ? [fullPath] : [];
    });

  /* ADR-042 §1. Fixed-position overlays are the exception: a modal is painted
     over the whole window, not inside the letterboxed stage, so the viewport is
     the right unit for its `max-height`. Everything that lays out inside the
     stage must read `--stage-h`. */
  const VIEWPORT_SIZED_EDITOR_OVERLAYS = new Set([
    "src/deck-editor/components/LoadDeckDialog.svelte",
    "src/deck-editor/components/YdkExport.svelte",
    "src/deck-editor/components/YdkImport.svelte",
  ]);

  it("the editor lays out from the stage, not the viewport", () => {
    const components = editorComponentPaths();
    expect(components.length).toBeGreaterThan(5);
    for (const file of components) {
      if (VIEWPORT_SIZED_EDITOR_OVERLAYS.has(file)) continue;
      expect(
        readFileSync(file, "utf8"),
        `${file} must size itself from --stage-h, not 100vh`,
      ).not.toContain("100vh");
    }
  });

  it("every viewport-sized exception is a fixed overlay that still exists", () => {
    for (const file of VIEWPORT_SIZED_EDITOR_OVERLAYS) {
      const source = readFileSync(file, "utf8");
      expect(
        source,
        `${file} no longer uses 100vh; drop the exception`,
      ).toContain("100vh");
      expect(source, `${file} is not a fixed overlay`).toContain(
        "position: fixed",
      );
    }
  });
});
