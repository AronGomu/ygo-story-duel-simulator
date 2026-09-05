import { mkdir, readFile, writeFile } from "node:fs/promises";
import {
  expect,
  test,
  type CDPSession,
  type Locator,
  type Page,
  type TestInfo,
} from "@playwright/test";
import { buildActiveCardDataManifest } from "../scripts/lib/active-card-data-manifest.ts";
import { buildActiveCardTextManifest } from "../scripts/lib/active-card-text-manifest.ts";
import { buildActiveImageManifest } from "../scripts/lib/active-image-manifest.ts";
import {
  PROTOTYPE_RULESET,
  quantityLimit,
} from "../src/decks/catalog/pinned-ruleset.ts";
import { packagedCatalog } from "../src/decks/catalog/packaged-catalog.ts";
import {
  DECK_DATABASE_NAME,
  LEGACY_DECK_DATABASE_NAME,
} from "../src/decks/deck-database.ts";
import {
  computeFieldGeometry,
  perspectiveVirtualHeight,
} from "../src/battle/field/duel-field-geometry.ts";
import {
  FIELD_CAMERA_PX,
  FIELD_TILT_DEG,
} from "../src/battle/field/perspective.ts";
import { duelFieldRenderFailureUrl } from "../tests/fixtures/duel-field-component-failure.ts";

interface BrowserCapture {
  readonly commands: readonly Readonly<Record<string, unknown>>[];
  readonly events: readonly Readonly<Record<string, unknown>>[];
  readonly workers: number;
  readonly terminations: number;
  readonly imageUrls: {
    readonly created: readonly string[];
    readonly revoked: readonly string[];
    readonly active: ReadonlySet<string>;
  };
  readonly eventPaints: Array<{
    readonly type: string;
    readonly receivedAt: number;
    readonly paintedAt: number;
    readonly duration: number;
  }>;
  readonly longTasks: Array<{
    readonly name: string;
    readonly duration: number;
  }>;
  readonly listeners: { readonly added: number; readonly removed: number };
}

declare global {
  interface Window {
    readonly __duelCapture: BrowserCapture;
  }
}

interface CapturedStateEvent {
  readonly type: "state";
  readonly state: {
    readonly snapshotId: string;
    readonly players: readonly [
      { readonly hand: readonly unknown[]; readonly handCount: number },
      { readonly hand: readonly unknown[]; readonly handCount: number },
    ];
  };
}

interface CapturedPromptEvent {
  readonly type: "prompt";
  readonly prompt: { readonly id: string; readonly kind: string };
}

const LOCAL_DECK_NAME = "E2E Local Deck";

/* The catalog the running build offers, rebuilt here from the same manifests
   `vite.config.ts` compiles into it. Reading the fixture instead would make
   this scenario vacuous the moment packaging and the editor disagreed — which
   is precisely the failure it exists to catch. */
const PACKAGED_CATALOG = (() => {
  const codes = new Set(
    buildActiveImageManifest(process.cwd(), "duel-smoke").files.map(
      ({ code }) => code,
    ),
  );
  return packagedCatalog(
    buildActiveCardDataManifest(process.cwd(), codes),
    buildActiveCardTextManifest(process.cwd(), codes),
  );
})();

/* Derived from the packaged catalog rather than written out, so a packaging
   change cannot leave this deck quietly illegal and the scenario quietly
   vacuous. */
const LOCAL_DECK_MAIN: readonly number[] = (() => {
  const codes = PACKAGED_CATALOG.filter(
    (card) =>
      card.canonicalZone === "main" &&
      quantityLimit(PROTOTYPE_RULESET, card.code) === 3,
  ).map(({ code }) => code);
  return Array.from({ length: 40 }, (_, index) => codes[index % codes.length]!);
})();

function ydkSource(main: readonly number[]): string {
  return ["#main", ...main.map(String), "#extra", "!side", ""].join("\n");
}

async function deleteDeckDatabases(page: Page): Promise<void> {
  await page.evaluate(
    async (names: readonly string[]) => {
      for (const name of names)
        await new Promise<void>((resolve) => {
          const request = indexedDB.deleteDatabase(name);
          request.onsuccess = () => resolve();
          request.onerror = () => resolve();
          request.onblocked = () => resolve();
        });
    },
    [DECK_DATABASE_NAME, LEGACY_DECK_DATABASE_NAME],
  );
}

/* ADR-054: `#/duel` redirects to free play, which opens on the match setup
   itself. The match is a state of that route rather than a route of its own,
   so a reload lands on the seats again and has to start a second one. */
async function openDuel(page: Page, url = "./#/duel"): Promise<void> {
  await page.goto(url);
}

/* T17: both seats are chosen in the shell's match setup, and the duel starts
   from the request it builds rather than from a picker of its own. Start is
   dead until the free-play library has answered, which is what the wait is. */
async function startPresetDuel(page: Page): Promise<void> {
  const start = page.locator('[data-cy="deck-select-start"]');
  await expect(start).toBeEnabled({ timeout: 120_000 });
  await start.click();
}

const RESPONSIVE_VIEWPORTS = [
  { id: "VP-01", width: 1366, height: 768 },
  { id: "VP-02", width: 1920, height: 1080 },
  { id: "VP-03", width: 2560, height: 1440 },
] as const;

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    const capture = {
      commands: [] as unknown[],
      events: [] as unknown[],
      workers: 0,
      terminations: 0,
      imageUrls: {
        created: [] as string[],
        revoked: [] as string[],
        active: new Set<string>(),
      },
      eventPaints: [] as Array<{
        type: string;
        receivedAt: number;
        paintedAt: number;
        duration: number;
      }>,
      longTasks: [] as Array<{ name: string; duration: number }>,
      listeners: { added: 0, removed: 0 },
    };
    Object.defineProperty(window, "__duelCapture", { value: capture });

    const nativeCreateObjectURL = URL.createObjectURL.bind(URL);
    const nativeRevokeObjectURL = URL.revokeObjectURL.bind(URL);
    URL.createObjectURL = (object: Blob | MediaSource): string => {
      const url = nativeCreateObjectURL(object);
      capture.imageUrls.created.push(url);
      capture.imageUrls.active.add(url);
      return url;
    };
    URL.revokeObjectURL = (url: string): void => {
      capture.imageUrls.revoked.push(url);
      capture.imageUrls.active.delete(url);
      nativeRevokeObjectURL(url);
    };

    const nativeAddEventListener = EventTarget.prototype.addEventListener;
    const nativeRemoveEventListener = EventTarget.prototype.removeEventListener;
    EventTarget.prototype.addEventListener = function (
      type: string,
      callback: EventListenerOrEventListenerObject | null,
      options?: AddEventListenerOptions | boolean,
    ): void {
      if (
        this === window ||
        this === document ||
        this === document.body ||
        this === document.documentElement
      )
        capture.listeners.added += 1;
      return Reflect.apply(nativeAddEventListener, this, [
        type,
        callback,
        options,
      ]) as void;
    };
    EventTarget.prototype.removeEventListener = function (
      type: string,
      callback: EventListenerOrEventListenerObject | null,
      options?: EventListenerOptions | boolean,
    ): void {
      if (
        this === window ||
        this === document ||
        this === document.body ||
        this === document.documentElement
      )
        capture.listeners.removed += 1;
      return Reflect.apply(nativeRemoveEventListener, this, [
        type,
        callback,
        options,
      ]) as void;
    };

    try {
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries())
          capture.longTasks.push({
            name: entry.name,
            duration: entry.duration,
          });
      }).observe({ entryTypes: ["longtask"] });
    } catch {
      // Long Task API may be unavailable in non-Chromium hygiene projects.
    }

    const NativeWorker = window.Worker;
    const nativePostMessage = NativeWorker.prototype.postMessage;
    const nativeTerminate = NativeWorker.prototype.terminate;
    Object.defineProperty(NativeWorker.prototype, "postMessage", {
      configurable: true,
      value: function (
        this: Worker,
        message: unknown,
        options?: StructuredSerializeOptions | Transferable[],
      ): void {
        capture.commands.push(structuredClone(message));
        Reflect.apply(
          nativePostMessage,
          this,
          options === undefined ? [message] : [message, options],
        );
      },
    });

    class InspectableWorker extends NativeWorker {
      constructor(scriptURL: string | URL, options?: WorkerOptions) {
        super(scriptURL, options);
        capture.workers += 1;
        this.addEventListener("message", (event) => {
          capture.events.push(structuredClone(event.data));
          const receivedAt = performance.now();
          const eventType =
            typeof event.data === "object" &&
            event.data !== null &&
            "type" in event.data &&
            typeof event.data.type === "string"
              ? event.data.type
              : "unknown";
          requestAnimationFrame(() => {
            requestAnimationFrame(() => {
              const paintedAt = performance.now();
              capture.eventPaints.push({
                type: eventType,
                receivedAt,
                paintedAt,
                duration: paintedAt - receivedAt,
              });
            });
          });
        });
      }

      terminate(): void {
        capture.terminations += 1;
        Reflect.apply(nativeTerminate, this, []);
      }
    }
    Object.defineProperty(window, "Worker", {
      configurable: true,
      value: InspectableWorker,
    });
  });
});

test("the root route shows the main menu without booting the duel", async ({
  page,
}) => {
  const requests: string[] = [];
  page.on("request", (request) => requests.push(request.url()));
  await page.goto("./");

  await expect(page.locator('[data-cy="main-menu-title"]')).toBeVisible();
  /* Continue is absent on a profile that has never played, so the entries a
     fresh install meets are these four, Free Play last. */
  for (const entry of ["new-game", "load", "settings", "free-play"])
    await expect(page.locator(`[data-cy="main-menu-${entry}"]`)).toBeVisible();
  await expect(page.locator('[data-cy="main-menu-continue"]')).toHaveCount(0);
  await expect(
    page.getByRole("heading", { name: "Choose your deck" }),
  ).toHaveCount(0);
  expect(requests.some((url) => /\/runtime\/|\.wasm(?:$|\?)/.test(url))).toBe(
    false,
  );

  /* Deciding whether to offer Continue must not conjure the story-saves
     database: `createStorySaveRepository` builds the `saves` store only on
     `upgradeneeded`, so a database the menu created could never be saved
     into. This is the production browser's own verdict on that. */
  expect(
    await page.evaluate(async () =>
      (await indexedDB.databases()).map(({ name }) => name),
    ),
  ).not.toContain("ygo-story-saves");

  await page.locator('[data-cy="main-menu-free-play"]').click();
  expect(new URL(page.url()).hash).toBe("#/free-play");

  /* ADR-054: the entry lands on the seats themselves. The menu that used to
     stand here offered Start a match, Deck builder and Return; the first was a
     click that named the screen behind it, and the other two are now Open and
     Back in the selection screen's own footer. T20: those seats are the shared
     deck-selection screen, so the duel's own picker — which fixed the opponent
     — must not appear here either. */
  await expect(page.locator('[data-cy="deck-select-screen"]')).toBeVisible({
    timeout: 120_000,
  });
  await expect(page.locator('[data-cy="deck-select-title"]')).toHaveText(
    "Select Deck",
  );
  await expect(page.locator('[data-cy="deck-select-back"]')).toBeVisible();
  const deckActions = page.locator('[data-cy="deck-select-kebab"]');
  await expect(deckActions).toBeVisible();
  await deckActions.click();
  await expect(page.locator('[data-cy="deck-select-open"]')).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.locator('[data-cy="deck-picker"]')).toHaveCount(0);

  /* Both seats are offered before the card database behind the library has
     answered: the bundled decks are compiled into this build, so Start is live
     on the first paint rather than after a fetch. */
  await expect(
    page.locator('[data-cy="deck-tile-preset:mvp-player"]'),
  ).toHaveCount(1);

  await startPresetDuel(page);
  await expect(page.locator('[data-cy="deck-picker"]')).toHaveCount(0);

  /* The match is a state of the route, so the way back to the seats is an item
     of the duel's own menu rather than a route the player navigates. */
  await page.locator('[data-cy="duel-right-rail-options"]').click();
  await page.locator('[data-cy="menu-dialog-leave-match-button"]').click();
  await expect(page.locator('[data-cy="deck-select-screen"]')).toBeVisible();
  expect(new URL(page.url()).hash).toBe("#/free-play");

  /* Create is the library path when only bundled presets are available. In
     compact mode it lives inside the deck-actions menu. */
  await page.locator('[data-cy="deck-select-kebab"]').click();
  await page.locator('[data-cy="deck-select-create"]').click();
  expect(new URL(page.url()).hash).toBe("#/free-play/decks");
});

test("free-play deck tiles keep names and info inside card bounds", async ({
  page,
}) => {
  await page.goto("./#/free-play");

  const tile = page.locator('[data-cy="deck-tile-preset:mvp-player"]');
  await expect(tile).toBeVisible({ timeout: 120_000 });
  const art = tile.locator("img.art");
  await expect(art).toHaveCount(1, { timeout: 120_000 });
  await expect
    .poll(() =>
      art.evaluate(
        (image) =>
          image instanceof HTMLImageElement &&
          image.complete &&
          image.naturalWidth > 0,
      ),
    )
    .toBe(true);

  const tileBox = await tile.boundingBox();
  expect(tileBox).not.toBeNull();
  for (const part of ["name", "tags"]) {
    const box = await tile
      .locator(`[data-cy="deck-tile-${part}-preset:mvp-player"]`)
      .boundingBox();
    expect(box).not.toBeNull();
    expect(box!.y).toBeGreaterThanOrEqual(tileBox!.y);
    expect(box!.y + box!.height).toBeLessThanOrEqual(
      tileBox!.y + tileBox!.height,
    );
  }
});

test("free-play deck grid adds columns and fills tracks from available width", async ({
  page,
}) => {
  async function gridMetrics(): Promise<{
    readonly columns: readonly number[];
    readonly tileWidth: number;
  }> {
    return page.locator('[data-cy="deck-select-grid"]').evaluate((grid) => {
      const firstTile = grid.firstElementChild;
      if (!(firstTile instanceof HTMLElement))
        throw new Error("Deck grid has no tile");
      return {
        columns: getComputedStyle(grid)
          .gridTemplateColumns.split(" ")
          .map(Number.parseFloat),
        tileWidth: firstTile.getBoundingClientRect().width,
      };
    });
  }

  await page.setViewportSize({ width: 1366, height: 768 });
  await page.goto("./#/free-play");
  await expect(page.locator('[data-cy="deck-select-grid"]')).toBeVisible({
    timeout: 120_000,
  });
  const narrower = await gridMetrics();

  await page.setViewportSize({ width: 1920, height: 1080 });
  const wider = await gridMetrics();

  await page.setViewportSize({ width: 390, height: 844 });
  const phone = await gridMetrics();

  expect(wider.columns.length).toBeGreaterThan(narrower.columns.length);
  expect(phone.columns).toHaveLength(1);
  expect(narrower.tileWidth).toBeCloseTo(narrower.columns[0]!, 0);
  expect(wider.tileWidth).toBeCloseTo(wider.columns[0]!, 0);
  expect(phone.tileWidth).toBeCloseTo(phone.columns[0]!, 0);
});

test("production bundle initializes the real Worker and sends one opaque choice once", async ({
  page,
}) => {
  const requests: string[] = [];
  page.on("request", (request) => requests.push(request.url()));
  const startupBeganAt = Date.now();
  await openDuel(page);
  await startPresetDuel(page);

  /* Without the removed "Shuffle Deck" idle command, an opening Main Phase
     with no legal global action beyond ending the turn never mounts the
     conditional field action bar (`fieldActionBarRequired`), so readiness is
     asserted on the field's own prompt-kind marker and the preview panel's
     status line instead of the bar's title node. */
  await expect(
    page.locator('[data-cy="duel-field"][data-prompt-kind="idleCommand"]'),
  ).toBeVisible({ timeout: 120_000 });
  await expect(
    page.locator('[data-cy="duel-right-rail-status-title"]', {
      hasText: "Choose a Main Phase action",
    }),
  ).toBeVisible({ timeout: 120_000 });
  expect(Date.now() - startupBeganAt).toBeLessThan(15_000);
  await enableDuelHud(page);
  await expect(page.getByRole("heading", { name: "Your turn" })).toBeVisible();
  await expect(
    page.locator('[data-cy="duel-right-rail-life-points-0"]'),
  ).toBeVisible();
  const field = page.getByRole("region", { name: "Duel field" });
  await expect(field).toBeVisible();
  // T8: hand zones paint no ZoneControl/`data-zone-id`. T11: the bundled
  // pairs are Link-free, so the duel runs under Master Rule 3 with no shared
  // Extra Monster Zones at all — 32 physical zones minus the 2 hand zones
  // leaves 30 painted ones.
  await expect(field.locator("[data-zone-id]")).toHaveCount(30);
  await expect(
    field.locator('[data-zone-id^="shared:extraMonster"]'),
  ).toHaveCount(0);
  // The top-right status pills (T3) are gone; the split phase bar beside the
  // field is the current-phase indicator now.
  await expect(page.locator('[data-cy="phase-bar"]')).toBeVisible();
  const currentPhaseChip = page.locator(
    '[data-cy="phase-bar-you-draw"].is-current, [data-cy="phase-bar-you-standby"].is-current, [data-cy="phase-bar-you-main1"].is-current',
  );
  await expect(currentPhaseChip).toHaveCount(1);
  await expect(
    page.locator('[data-cy="duel-right-rail-life-points-0"]'),
  ).toHaveText("LP 8000");
  await expect(
    page.locator('[data-cy="duel-right-rail-life-points-1"]'),
  ).toHaveText("LP 8000");
  // Round 3 (T10): the header labels each life total by role, not deck/
  // archetype name — those never render anywhere in the header or field.
  const headerText = await page
    .locator('[data-cy="duel-right-rail"]')
    .textContent();
  for (const catalogName of [
    "Blue-Eyes White Dragon",
    "Dark Magician",
    "Red-Eyes Black Dragon",
    "Elemental HERO Sparkman",
    "Cyber Dragon",
    "Blackwing Armor Master",
  ])
    expect(headerText ?? "").not.toContain(catalogName);
  await expect(
    field.getByRole("article", { name: /Hidden opponent hand card/ }).first(),
  ).toBeVisible();
  await expect(field.getByRole("img").first()).toHaveAttribute("src", /.+/);

  const promptTitle = page.locator('[data-cy="duel-right-rail-status-title"]', {
    hasText: "Choose a Main Phase action",
  });
  await expect(promptTitle).toBeVisible();

  await page.locator('[data-cy="duel-right-rail-options"]').click();
  await page.locator('[data-cy="menu-dialog-settings-button"]').click();
  await expect(page.locator('[data-cy="settings-engine-version"]')).toHaveText(
    /ocgcore 11\.0/,
  );
  await page.locator('[data-cy="settings-dialog-close-button"]').click();

  const capture = await readCapture(page);
  const ready = capture.events.find((event) => event.type === "ready");
  expect(ready).toEqual({
    type: "ready",
    coreVersion: [11, 0],
    snapshotId: expect.stringMatching(/^[a-f0-9]{64}$/),
    activeImageManifestSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
  });
  const stateEvents = capture.events.filter(
    (event) => event.type === "state",
  ) as unknown as CapturedStateEvent[];
  expect(stateEvents.length).toBeGreaterThan(0);
  for (const event of stateEvents) {
    expect(event.state.players[1].hand).toEqual([]);
    expect(event.state.players[1].handCount).toBeGreaterThan(0);
  }
  const runtimeManifest = JSON.parse(
    await readFile("generated/runtime/current/manifest.json", "utf8"),
  ) as { readonly snapshotId: string };
  expect(stateEvents.at(-1)?.state.snapshotId).toBe(runtimeManifest.snapshotId);

  expect(
    requests.some((url) =>
      url.includes("/ygo-story-duel/runtime/current/manifest.json"),
    ),
  ).toBe(true);
  expect(
    requests.some((url) =>
      url.includes("/ygo-story-duel/runtime/engine/ocgcore.sync.wasm"),
    ),
  ).toBe(true);
  expect(
    requests
      .filter((url) => url.includes("/runtime/"))
      .every((url) => url.includes("/ygo-story-duel/runtime/")),
  ).toBe(true);
  expect(
    requests.some((url) =>
      /\/ygo-story-duel\/runtime\/images\/\d+\.jpg$/.test(url),
    ),
  ).toBe(true);

  const prompt = capture.events.find(
    (event) => event.type === "prompt",
  ) as unknown as CapturedPromptEvent | undefined;
  expect(prompt).toBeDefined();
  const endTurn = page.locator('[data-cy="field-end-turn-button"]');
  await endTurn.evaluate((element) => {
    (element as HTMLButtonElement).click();
    (element as HTMLButtonElement).click();
  });
  await expect
    .poll(async () => {
      const latest = await readCapture(page);
      return latest.commands.filter(
        (command) =>
          command.type === "respond" && command.promptId === prompt?.prompt.id,
      ).length;
    })
    .toBe(1);

  const commands = (await readCapture(page)).commands;
  expect(JSON.stringify(commands)).not.toMatch(
    /"seed"|"deckOrder"|"startupScript"|"programmed"|"mode"/,
  );
});

test("duel settings downloads the current diagnostic trace", async ({
  page,
}) => {
  await openDuel(page);
  await startPresetDuel(page);
  const field = page.locator(
    '[data-cy="duel-field"][data-prompt-kind="idleCommand"]',
  );
  await expect(field).toBeVisible({ timeout: 120_000 });
  const promptId = await readLatestPromptId(page);
  expect(promptId).toBeDefined();
  await page.locator('[data-cy="field-end-turn-button"]').click();
  await expect
    .poll(async () => await countResponsesTo(page, promptId!))
    .toBe(1);

  await openSettingsDialog(page);
  const downloadButton = page.locator(
    '[data-cy="settings-download-diagnostics-button"]',
  );
  await expect(downloadButton).toBeEnabled();
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    downloadButton.click(),
  ]);
  expect(download.suggestedFilename()).toMatch(
    /^ygo-duel-diagnostics-[a-f0-9]{12}\.json$/,
  );
  const downloadPath = await download.path();
  if (downloadPath === null) throw new Error("Diagnostic download has no path");
  const diagnostics = JSON.parse(await readFile(downloadPath, "utf8")) as {
    readonly trace: {
      readonly snapshotId: string;
      readonly entries: readonly { readonly kind: string }[];
    };
  };
  expect(diagnostics.trace.entries.map(({ kind }) => kind)).toEqual(
    expect.arrayContaining(["prompt", "response"]),
  );

  await expect
    .poll(
      async () =>
        await page.evaluate(async () => {
          const database = await new Promise<IDBDatabase>((resolve, reject) => {
            const request = indexedDB.open("ygo-story-duel");
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
          });
          try {
            return await new Promise<number>((resolve, reject) => {
              const request = database
                .transaction("debugRuns", "readonly")
                .objectStore("debugRuns")
                .count();
              request.onsuccess = () => resolve(request.result);
              request.onerror = () => reject(request.error);
            });
          } finally {
            database.close();
          }
        }),
    )
    .toBeGreaterThan(0);
});

test("the match setup persists a chosen pair and Change decks returns without auto-start", async ({
  page,
}) => {
  await openDuel(page);
  const setup = page.locator('[data-cy="deck-select-screen"]');
  await expect(setup).toBeVisible({ timeout: 120_000 });
  expect(
    (await readCapture(page)).commands.filter(
      (command) => command.type === "startDuel",
    ),
  ).toHaveLength(0);

  const yourSeat = page.locator('[data-cy="duel-start-your-deck-name"]');
  const opponentSeat = page.locator(
    '[data-cy="duel-start-opponent-deck-name"]',
  );
  await expect(
    page.locator('[data-cy="deck-tile-press-preset:burning-abyss"]'),
  ).toBeEnabled({ timeout: 120_000 });
  await page
    .locator('[data-cy="deck-tile-press-preset:burning-abyss"]')
    .click();
  /* T17: the opponent seat is a choice now, and T20 makes the choice the cards
     themselves — pressing their seat card hands the grid to their seat. Picking
     a deck that is neither seat's default is what proves the request carries it
     rather than the Shaddoll the duel's own picker used to assign. */
  await page.locator('[data-cy="duel-start-opponent-deck"]').click();
  await page.locator('[data-cy="deck-tile-press-preset:nekroz"]').click();

  await page.locator('[data-cy="deck-select-start"]').click();
  await expect(page.locator('[data-cy="duel-field"]')).toBeVisible({
    timeout: 120_000,
  });
  expect(
    (await readCapture(page)).commands.filter(
      (command) => command.type === "startDuel",
    ),
  ).toEqual([
    {
      type: "startDuel",
      duelId: "bundled-v1:burning-abyss:vs:nekroz",
      player: { kind: "preset", deckId: "burning-abyss" },
      opponent: { kind: "preset", deckId: "nekroz" },
    },
  ]);
  expect(
    await page.evaluate(
      () =>
        (
          JSON.parse(localStorage.getItem("ygo.ui.v3") ?? "null") as {
            freePlayPairing: unknown;
          } | null
        )?.freePlayPairing,
    ),
  ).toEqual({ player: "preset:burning-abyss", opponent: "preset:nekroz" });
  expect(
    await page.evaluate(() => localStorage.getItem("ygo.ui.v1")),
  ).toBeNull();

  await page.reload();
  await expect(setup).toBeVisible({ timeout: 120_000 });
  await expect(yourSeat).toHaveText("Burning Abyss");
  await expect(opponentSeat).toHaveText("Nekroz");

  await startPresetDuel(page);
  await expect(page.locator('[data-cy="duel-field"]')).toBeVisible({
    timeout: 120_000,
  });
  await surrenderThroughMenu(page);
  await expect(
    page.getByRole("heading", { name: "Duel surrendered" }),
  ).toBeVisible();
  /* Change decks resets the session, and the request that started this match
     must not fire a second time into it: the duel dispatches a request once
     per identity, and its own picker is what the reset opens. */
  await page.locator('[data-cy="duel-result-change-decks-button"]').click();
  await expect(page.locator('[data-cy="deck-picker"]')).toBeVisible({
    timeout: 120_000,
  });
  await expect
    .poll(
      async () =>
        (await readCapture(page)).commands.filter(
          (command) => command.type === "startDuel",
        ).length,
    )
    .toBe(1);
});

test("a local deck built from the packaged catalog is offered and duels", async ({
  page,
}) => {
  await page.goto("./#/decks");
  await deleteDeckDatabases(page);
  await page.reload();

  /* Imported through the library rather than seeded through `#/admin`: this is
     the shortest path a player could also walk from an empty library to a deck
     the pinned ruleset accepts, and it goes through the editor's own catalog
     on the way. */
  await page.locator('[data-cy="deck-library-import"]').click();
  await page
    .locator('[data-cy="deck-ydk-import-name-input"]')
    .fill(LOCAL_DECK_NAME);
  await page
    .locator('[data-cy="deck-ydk-import-source-input"]')
    .fill(ydkSource(LOCAL_DECK_MAIN));
  await page.locator('[data-cy="deck-ydk-import-preview"]').click();
  /* The editor's catalog is the packaged card set itself, so every code the
     duel can draw is a code the editor knows. */
  await expect(
    page.locator('[data-cy="deck-ydk-import-unknown-codes"]'),
  ).toHaveCount(0);
  await page.locator('[data-cy="deck-ydk-import-commit"]').click();
  await expect(page.locator('[data-cy="deck-name-input"]')).toHaveValue(
    LOCAL_DECK_NAME,
  );
  /* Closing the import dialog means its async mutation returned true after the
     repository write. The editor no longer keeps a transient import message. */
  await expect(page.locator('[data-cy="deck-ydk-import"]')).toHaveCount(0);
  await expect(
    page.locator('[data-cy="deck-editor-layout"]'),
  ).not.toHaveAttribute("aria-busy", "true");

  await openDuel(page);
  await expect(page.locator('[data-cy="deck-select-screen"]')).toBeVisible({
    timeout: 120_000,
  });

  /* The deck a player just built is offered, because the editor may only offer
     cards this build packages and the picker only offers decks it can draw —
     one derivation, so the two sets cannot disagree. */
  const localTile = page
    .locator('[data-cy="deck-select-grid"] [data-cy^="deck-tile-local:"]')
    .filter({ hasText: LOCAL_DECK_NAME });
  await expect(localTile).toHaveCount(1, { timeout: 120_000 });

  await localTile.locator('[data-cy^="deck-tile-press-local:"]').click();
  await expect(
    page.locator('[data-cy="duel-start-your-deck-name"]'),
  ).toHaveText(LOCAL_DECK_NAME);
  await expect(
    page.locator('[data-cy="deck-select-block-notice"]'),
  ).toHaveCount(0);

  await page.locator('[data-cy="deck-select-start"]').click();
  await expect(page.locator('[data-cy="duel-field"]')).toBeVisible({
    timeout: 120_000,
  });
  /* A visible field is the engine's own answer: the Worker built a duel from
     these forty codes rather than refusing them. */
  await expect(
    page.locator('[data-cy="duel-field"][data-prompt-kind]'),
  ).toBeVisible({ timeout: 120_000 });

  const startCommands = (await readCapture(page)).commands.filter(
    (command) => command.type === "startDuel",
  );
  expect(startCommands).toHaveLength(1);
  expect(startCommands[0]?.duelId).toBe("local-v1:local:vs:shaddoll");
  /* The editor stores a deck in its own display order, so the dispatched list
     is compared as the multiset it is rather than the order it was typed. */
  const dispatched = startCommands[0]?.player as {
    readonly kind: string;
    readonly main: readonly number[];
    readonly extra: readonly number[];
    readonly side: readonly number[];
  };
  expect(dispatched.kind).toBe("cards");
  expect([...dispatched.main].sort()).toEqual([...LOCAL_DECK_MAIN].sort());
  expect(dispatched.extra).toEqual([]);
  expect(dispatched.side).toEqual([]);
  expect(startCommands[0]?.opponent).toEqual({
    kind: "preset",
    deckId: "shaddoll",
  });
});

test("a local deck the pinned ruleset refuses is never offered", async ({
  page,
}) => {
  await page.goto("./#/decks");
  await deleteDeckDatabases(page);
  await page.reload();

  await page.locator('[data-cy="deck-library-import"]').click();
  await page
    .locator('[data-cy="deck-ydk-import-name-input"]')
    .fill("Thirty Nine");
  await page
    .locator('[data-cy="deck-ydk-import-source-input"]')
    .fill(ydkSource(LOCAL_DECK_MAIN.slice(0, 39)));
  await page.locator('[data-cy="deck-ydk-import-preview"]').click();
  await page.locator('[data-cy="deck-ydk-import-commit"]').click();
  await expect(page.locator('[data-cy="deck-name-input"]')).toHaveValue(
    "Thirty Nine",
  );

  await openDuel(page);
  await expect(page.locator('[data-cy="deck-select-screen"]')).toBeVisible({
    timeout: 120_000,
  });
  await expect(
    page.locator('[data-cy="deck-tile-preset:mvp-player"]'),
  ).toHaveCount(1, { timeout: 120_000 });
  /* The starter deck the editor seeded is a legal local tile, so local decks
     may well be in the grid; what must never appear is the deck the ruleset
     refused, and the grid is what fills both seats. */
  await expect(
    page
      .locator('[data-cy="deck-select-grid"] [data-cy^="deck-tile-"]')
      .filter({ hasText: "Thirty Nine" }),
  ).toHaveCount(0);
});

test("panels stay hidden until settings enable them", async ({ page }) => {
  await openDuel(page);
  await startPresetDuel(page);
  await expect(
    page.locator('[data-cy="duel-field"][data-prompt-kind]'),
  ).toBeVisible({ timeout: 120_000 });

  await expect(page.locator('[data-cy="duel-hud"]')).toHaveCount(0);
  await expect(page.locator('[data-cy="workspace-grid"]')).toHaveCount(0);

  await enableDuelHud(page);
  await enableWorkspace(page);

  await expect(page.locator('[data-cy="duel-hud"]')).toBeVisible();
  await expect(page.locator('[data-cy="workspace-grid"]')).toBeVisible();
});

test("zone visuals persist through reload and Reset settings restores defaults", async ({
  page,
}) => {
  const board = page.locator('[data-cy="duel-field-board"]');
  const zone = board
    .locator(".duel-field-zone:not(.is-actionable):not(.is-selected)")
    .first();
  const zoneLabel = zone.locator(".duel-field-zone__label");
  const card = board.locator(".duel-field-card:visible").first();
  const count = board.locator(".duel-field-stack__count").first();

  await openDuel(page);
  await startPresetDuel(page);
  await expect(board).toBeVisible({ timeout: 120_000 });
  await expect(zone).not.toHaveCSS("border-top-color", "rgba(0, 0, 0, 0)");
  await expect(zoneLabel).toBeVisible();
  await expect(card).toBeVisible();
  await expect(card).not.toHaveCSS("box-shadow", "none");
  const zoneAriaLabel = await zone.getAttribute("aria-label");
  if (zoneAriaLabel === null) throw new Error("Zone has no accessible label");
  await expect(count).toBeVisible();

  await openSettingsDialog(page);
  await page
    .locator('[data-cy="settings-show-zone-outlines-checkbox"]')
    .uncheck();
  await page
    .locator('[data-cy="settings-show-zone-counts-checkbox"]')
    .uncheck();
  await page
    .locator('[data-cy="settings-show-card-shadows-checkbox"]')
    .uncheck();
  await page
    .locator('[data-cy="settings-show-zone-labels-checkbox"]')
    .uncheck();
  await expect(board).toHaveAttribute("data-zone-outlines", "false");
  await expect(board).toHaveAttribute("data-zone-counts", "false");
  await expect(board).toHaveAttribute("data-card-shadows", "false");
  await expect(board).toHaveAttribute("data-zone-labels", "false");
  await expect(zone).toHaveCSS("border-top-color", "rgba(0, 0, 0, 0)");
  await expect(zoneLabel).toHaveCSS("display", "none");
  await expect(zone).toHaveAttribute("aria-label", zoneAriaLabel);
  await expect(card).toHaveCSS("box-shadow", "none");
  await expect(count).toBeHidden();
  await page.locator('[data-cy="settings-dialog-close-button"]').click();
  expect(
    await page.evaluate(() =>
      JSON.parse(localStorage.getItem("ygo.ui.v2") ?? "null"),
    ),
  ).toEqual({
    version: 2,
    windows: { zoneList: null, confirm: null },
    /* The player seat follows the stored default deck, whose id is generated
       when the starter deck seeds, so only the fixed opponent is pinned. */
    decks: {
      playerKey: expect.any(String),
      opponentKey: "preset:shaddoll",
    },
    settings: {
      showZoneOutlines: false,
      showZoneCounts: false,
      showCardShadows: false,
      showZoneLabels: false,
    },
  });

  await page.reload();
  await startPresetDuel(page);
  await expect(board).toBeVisible({ timeout: 120_000 });
  await expect(board).toHaveAttribute("data-zone-outlines", "false");
  await expect(board).toHaveAttribute("data-zone-counts", "false");
  await expect(board).toHaveAttribute("data-card-shadows", "false");
  await expect(board).toHaveAttribute("data-zone-labels", "false");
  await expect(zone).toHaveCSS("border-top-color", "rgba(0, 0, 0, 0)");
  await expect(zoneLabel).toHaveCSS("display", "none");
  await expect(zone).toHaveAttribute("aria-label", zoneAriaLabel);
  await expect(card).toHaveCSS("box-shadow", "none");
  await expect(count).toBeHidden();

  await openSettingsDialog(page);
  await expect(
    page.locator('[data-cy="settings-show-card-shadows-checkbox"]'),
  ).not.toBeChecked();
  await expect(
    page.locator('[data-cy="settings-show-zone-labels-checkbox"]'),
  ).not.toBeChecked();
  await page.locator('[data-cy="settings-reset-button"]').click();
  await expect(
    page.locator('[data-cy="settings-show-zone-outlines-checkbox"]'),
  ).toBeChecked();
  await expect(
    page.locator('[data-cy="settings-show-zone-counts-checkbox"]'),
  ).toBeChecked();
  await expect(
    page.locator('[data-cy="settings-show-card-shadows-checkbox"]'),
  ).toBeChecked();
  await expect(
    page.locator('[data-cy="settings-show-zone-labels-checkbox"]'),
  ).toBeChecked();
  await expect(board).toHaveAttribute("data-zone-outlines", "true");
  await expect(board).toHaveAttribute("data-zone-counts", "true");
  await expect(board).toHaveAttribute("data-card-shadows", "true");
  await expect(board).toHaveAttribute("data-zone-labels", "true");
  await expect(zone).not.toHaveCSS("border-top-color", "rgba(0, 0, 0, 0)");
  await expect(zoneLabel).toBeVisible();
  await expect(zone).toHaveAttribute("aria-label", zoneAriaLabel);
  await expect(card).not.toHaveCSS("box-shadow", "none");
  await expect(count).toBeVisible();
  await page.locator('[data-cy="settings-dialog-close-button"]').click();
  expect(
    await page.evaluate(() =>
      JSON.parse(localStorage.getItem("ygo.ui.v2") ?? "null"),
    ),
  ).toEqual({
    version: 2,
    windows: { zoneList: null, confirm: null },
    /* The player seat follows the stored default deck, whose id is generated
       when the starter deck seeds, so only the fixed opponent is pinned. */
    decks: {
      playerKey: expect.any(String),
      opponentKey: "preset:shaddoll",
    },
    settings: {
      showZoneOutlines: true,
      showZoneCounts: true,
      showCardShadows: true,
      showZoneLabels: true,
    },
  });
  expect(
    await page.evaluate(() => localStorage.getItem("ygo.ui.v1")),
  ).toBeNull();

  await page.reload();
  await startPresetDuel(page);
  await expect(board).toBeVisible({ timeout: 120_000 });
  await expect(board).toHaveAttribute("data-zone-outlines", "true");
  await expect(board).toHaveAttribute("data-zone-counts", "true");
  await expect(board).toHaveAttribute("data-card-shadows", "true");
  await expect(board).toHaveAttribute("data-zone-labels", "true");
  await expect(zone).not.toHaveCSS("border-top-color", "rgba(0, 0, 0, 0)");
  await expect(zoneLabel).toBeVisible();
  await expect(zone).toHaveAttribute("aria-label", zoneAriaLabel);
  await expect(card).not.toHaveCSS("box-shadow", "none");
  await expect(count).toBeVisible();
});

test("duel HUD keeps hidden stacks count-only and tray image work mounted on demand", async ({
  page,
}, testInfo) => {
  const imageRequests: string[] = [];
  page.on("request", (request) => {
    if (/\/runtime\/images\/\d+\.jpg$/.test(request.url()))
      imageRequests.push(request.url());
  });
  await openDuel(page);
  await startPresetDuel(page);
  await enableDuelHud(page);

  const hud = page.getByRole("region", { name: "Duel HUD" });
  await expect(hud).toBeVisible({ timeout: 120_000 });
  await expect(hud.getByText(/8,000 LP/).first()).toBeVisible();
  await expect(hud.getByText(/Turn \d+/)).toBeVisible();
  await expect(hud.getByText(/main 1|draw|standby|battle|end/)).toBeVisible();

  const opponentDeck = hud.getByRole("region", {
    name: /Opponent Deck, \d+ cards/,
  });
  await expect(opponentDeck.getByText("Count only")).toBeVisible();
  await expect(
    opponentDeck.getByRole("button", { name: /Open Opponent Deck/ }),
  ).toHaveCount(0);
  await expect(hud.locator("[data-card-code]")).toHaveCount(0);

  const beforeTray = imageRequests.length;
  const ownExtra = hud.getByRole("button", {
    name: /Open Your Extra Deck tray, \d+ cards/,
  });
  if ((await ownExtra.count()) > 0) {
    await ownExtra.click();
    const tray = page.getByRole("region", { name: "Your Extra Deck tray" });
    await expect(tray).toBeVisible();
    expect(
      await tray.getByRole("button", { name: /^Inspect / }).count(),
    ).toBeLessThanOrEqual(24);
    await tray
      .getByRole("button", { name: "Close Your Extra Deck tray" })
      .click();
    await expect(tray).toHaveCount(0);
    await expect(ownExtra).toBeFocused();
  }
  expect(imageRequests.length).toBe(beforeTray);

  const screenshotPath = testInfo.outputPath("df-11-hud.png");
  await page.screenshot({ path: screenshotPath, fullPage: true });
  await testInfo.attach("df-11-hud", {
    path: screenshotPath,
    contentType: "image/png",
  });
  const networkPath = testInfo.outputPath("df-11-privacy-network.json");
  await writeFile(
    networkPath,
    JSON.stringify(
      {
        activeImageRequests: imageRequests,
        trayAddedRequests: imageRequests.length - beforeTray,
        opponentDeckContentsMounted: false,
      },
      null,
      2,
    ),
  );
  await testInfo.attach("df-11-privacy-network", {
    path: networkPath,
    contentType: "application/json",
  });
});

test("repeated restart replaces the Worker and clears presentation state", async ({
  page,
}) => {
  await openDuel(page);
  await startPresetDuel(page);
  for (let cycle = 1; cycle <= 2; cycle += 1) {
    await expect(
      page.locator('[data-cy="duel-field"][data-prompt-kind]'),
    ).toBeVisible({
      timeout: 120_000,
    });
    if (cycle === 1) {
      await page.locator('[data-cy="duel-right-rail-options"]').click();
      await page.locator('[data-cy="menu-dialog-surrender-button"]').click();
      await page
        .locator('[data-cy="menu-dialog-surrender-cancel-button"]')
        .click();
      // Cancelling returns to the menu's main view (still open); reopen the
      // surrender confirmation from there rather than the outer trigger,
      // which sits behind the still-open dialog backdrop.
      await page.locator('[data-cy="menu-dialog-surrender-button"]').click();
      await page
        .locator('[data-cy="menu-dialog-surrender-confirm-button"]')
        .click();
    } else {
      await surrenderThroughMenu(page);
    }
    const surrenderedHeading = page.getByRole("heading", {
      name: "Duel surrendered",
    });
    await expect(surrenderedHeading).toBeVisible();
    await expect(surrenderedHeading).toBeFocused();
    await page.getByRole("button", { name: "Start another duel" }).click();
    await expect
      .poll(async () => (await readCapture(page)).workers)
      .toBe(cycle + 1);
  }
  await expect(
    page.locator('[data-cy="duel-field"][data-prompt-kind]'),
  ).toBeVisible({
    timeout: 120_000,
  });
  const capture = await readCapture(page);
  expect(
    capture.commands.filter(({ type }) => type === "dispose"),
  ).toHaveLength(2);
  expect(
    capture.commands.filter(({ type }) => type === "initialize"),
  ).toHaveLength(3);
});

test("refresh during loading and after completion starts a clean duel", async ({
  page,
}, testInfo) => {
  let releaseManifest!: () => void;
  let markBlocked!: () => void;
  const manifestBlocked = new Promise<void>((resolve) => {
    markBlocked = resolve;
  });
  const manifestRelease = new Promise<void>((resolve) => {
    releaseManifest = resolve;
  });
  let blockFirstManifest = true;
  await page.route("**/runtime/current/manifest.json", async (route) => {
    if (blockFirstManifest) {
      blockFirstManifest = false;
      markBlocked();
      await manifestRelease;
    }
    await route.continue();
  });

  await openDuel(page);
  await manifestBlocked;
  const reloadDuringLoading = page.reload();
  releaseManifest();
  await reloadDuringLoading;
  await startPresetDuel(page);
  await expect(
    page.locator('[data-cy="duel-field"][data-prompt-kind]'),
  ).toBeVisible({
    timeout: 120_000,
  });

  await surrenderThroughMenu(page);
  await expect(
    page.getByRole("heading", { name: "Duel surrendered" }),
  ).toBeVisible();
  const diagnosticDownload = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download diagnostics" }).click();
  const download = await diagnosticDownload;
  expect(download.suggestedFilename()).toMatch(
    /^ygo-duel-diagnostics-.*\.json$/,
  );
  const downloadPath = testInfo.outputPath(
    "duel-diagnostics-CONTAINS-PRODUCTION-SEED.json",
  );
  await download.saveAs(downloadPath);
  const diagnostic = JSON.parse(await readFile(downloadPath, "utf8")) as {
    readonly trace: { readonly sensitivity: string };
  };
  expect(diagnostic.trace.sensitivity).toBe("contains-production-seed");
  await page.reload();
  await startPresetDuel(page);
  await expect(
    page.locator('[data-cy="duel-field"][data-prompt-kind]'),
  ).toBeVisible({
    timeout: 120_000,
  });
  await expect(
    page.getByRole("heading", { name: "Duel surrendered" }),
  ).toHaveCount(0);
});

test("mounted card image leases return to baseline across tray, restart, and destroy", async ({
  page,
}, testInfo) => {
  await openDuel(page);
  await startPresetDuel(page);
  await enableDuelHud(page);
  await expect(
    page.locator('[data-cy="duel-field"][data-prompt-kind]'),
  ).toBeVisible({
    timeout: 120_000,
  });
  await expect
    .poll(async () => {
      const state = await mountedImageLeaseState(page);
      return state.activeCount > 0 && state.activeMatchesMounted;
    })
    .toBe(true);
  const baseline = await mountedImageLeaseState(page);
  const revokedBefore = await page.evaluate(
    () => window.__duelCapture.imageUrls.revoked.length,
  );

  const ownExtra = page.getByRole("button", {
    name: /Open Your Extra Deck tray, \d+ cards/,
  });
  if ((await ownExtra.count()) > 0) {
    await ownExtra.click();
    await expect(
      page.getByRole("region", { name: "Your Extra Deck tray" }),
    ).toBeVisible();
    await page
      .getByRole("button", { name: "Close Your Extra Deck tray" })
      .click();
    await expect
      .poll(async () => mountedImageLeaseState(page))
      .toEqual(baseline);
  }

  await surrenderThroughMenu(page);
  await expect(
    page.getByRole("heading", { name: "Duel surrendered" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Start another duel" }).click();
  await expect(
    page.locator('[data-cy="duel-field"][data-prompt-kind]'),
  ).toBeVisible({
    timeout: 120_000,
  });
  await expect
    .poll(async () => {
      const state = await mountedImageLeaseState(page);
      return state.activeCount > 0 && state.activeMatchesMounted;
    })
    .toBe(true);
  const restarted = await mountedImageLeaseState(page);
  expect(restarted.activeUrls).not.toEqual(baseline.activeUrls);
  expect(
    restarted.activeUrls.filter((url) => baseline.activeUrls.includes(url)),
  ).toEqual([]);
  expect(
    await page.evaluate(() => window.__duelCapture.imageUrls.revoked.length),
  ).toBeGreaterThan(revokedBefore);

  const evidence = await page.evaluate(() => ({
    created: window.__duelCapture.imageUrls.created.length,
    revoked: window.__duelCapture.imageUrls.revoked.length,
    active: window.__duelCapture.imageUrls.active.size,
  }));
  const evidencePath = testInfo.outputPath("df-13-object-url-lifecycle.json");
  await writeFile(
    evidencePath,
    JSON.stringify({ baseline, restarted, ...evidence }, null, 2),
  );
  await testInfo.attach("df-13-object-url-lifecycle", {
    path: evidencePath,
    contentType: "application/json",
  });

  await page.goto("about:blank");
  await expect
    .poll(async () =>
      page.evaluate(() => window.__duelCapture.imageUrls.active.size),
    )
    .toBe(0);
});

test("slow image preload cannot delay a legal Worker response", async ({
  page,
}, testInfo) => {
  let markBlocked!: () => void;
  let releaseImages!: () => void;
  const blocked = new Promise<void>((resolve) => (markBlocked = resolve));
  const released = new Promise<void>((resolve) => (releaseImages = resolve));
  let first = true;
  await page.route(/\/runtime\/images\/\d+\.jpg$/, async (route) => {
    if (first) {
      first = false;
      markBlocked();
    }
    await released;
    await route.abort("failed");
  });

  await openDuel(page);
  await startPresetDuel(page);
  await blocked;
  const controls = page.locator('[data-cy="duel-field"][data-prompt-kind]');
  await expect(controls).toBeVisible({ timeout: 120_000 });
  await expect(controls.getByRole("button").first()).toBeEnabled();
  const field = page.getByRole("region", { name: "Duel field" });
  await expect(field.getByRole("img").first()).toHaveAttribute(
    "src",
    /^data:image\/svg\+xml/,
  );
  const capture = await readCapture(page);
  const prompt = capture.events.find(
    (event) => event.type === "prompt",
  ) as unknown as CapturedPromptEvent;
  await page.locator('[data-cy="field-end-turn-button"]').click();
  await expect
    .poll(
      async () =>
        (await readCapture(page)).commands.filter(
          (command) =>
            command.type === "respond" && command.promptId === prompt.prompt.id,
        ).length,
    )
    .toBe(1);
  const evidencePath = testInfo.outputPath("df-13-nonblocking-input.json");
  await writeFile(
    evidencePath,
    JSON.stringify(
      {
        imagePreloadSettled: false,
        workerResponseCount: 1,
        fieldImageSource: await field
          .getByRole("img")
          .first()
          .getAttribute("src"),
      },
      null,
      2,
    ),
  );
  await testInfo.attach("df-13-nonblocking-input", {
    path: evidencePath,
    contentType: "application/json",
  });
  releaseImages();
});

test("missing active images use deterministic placeholders without blocking input", async ({
  page,
}) => {
  await page.route(/\/runtime\/images\/\d+\.jpg$/, (route) =>
    route.abort("failed"),
  );
  await openDuel(page);
  await startPresetDuel(page);
  const controls = page.locator('[data-cy="duel-field"][data-prompt-kind]');
  await expect(controls).toBeVisible({ timeout: 120_000 });
  await expect(
    page.locator(".image-warning").getByText(/card images? .*placeholder/i),
  ).toBeVisible();
  const promptImage = controls.locator("img").first();
  await expect(promptImage).toHaveAttribute("src", /^data:image\/svg\+xml/);
  await expect(controls.getByRole("button").first()).toBeEnabled();
});

test("forced Worker initialization timeout terminates and replaces the Worker", async ({
  page,
}) => {
  await page.addInitScript(() => {
    const nativeSetTimeout = window.setTimeout;
    window.setTimeout = ((
      handler: TimerHandler,
      timeout?: number,
      ...args: unknown[]
    ) =>
      nativeSetTimeout(
        handler,
        timeout === 120_000 ? 1 : timeout,
        ...args,
      )) as typeof window.setTimeout;
  });
  await openDuel(page);
  await startPresetDuel(page);
  const timeoutHeading = page.getByRole("heading", {
    name: /Duel Worker did not initialize within 120000ms/,
  });
  await expect(timeoutHeading).toBeVisible({ timeout: 30_000 });
  await expect(timeoutHeading).toBeFocused();
  await expect
    .poll(async () => (await readCapture(page)).terminations)
    .toBeGreaterThan(0);
  expect((await readCapture(page)).workers).toBeGreaterThanOrEqual(2);
});

test("injected DOM field failure preserves fallback controls and one opaque response", async ({
  page,
}) => {
  await openDuel(page, `${duelFieldRenderFailureUrl()}#/duel`);
  await startPresetDuel(page);
  await expect(
    page.getByRole("heading", { name: "Interactive field could not render" }),
  ).toBeVisible({ timeout: 120_000 });
  await expect(
    page.getByText("Injected duel field component failure"),
  ).toHaveCount(0);
  await page.locator('[data-cy="duel-right-rail-options"]').click();
  await expect(
    page.locator('[data-cy="menu-dialog-surrender-button"]'),
  ).toBeVisible();
  await page.locator('[data-cy="menu-dialog-close-button"]').click();
  // The interactive field failed to render, so the field surface can never
  // host this prompt; reveal the workspace so the docked prompt panel can.
  await enableWorkspace(page);
  const promptControls = page.locator("[data-prompt-kind]");
  await expect(promptControls).toBeVisible();
  const prompt = (await readCapture(page)).events.find(
    (event) => event.type === "prompt",
  ) as unknown as CapturedPromptEvent | undefined;
  expect(prompt).toBeDefined();
  const endTurn = promptControls.getByRole("button", {
    name: "End turn",
    exact: true,
  });
  await endTurn.evaluate((element) => {
    (element as HTMLButtonElement).click();
    (element as HTMLButtonElement).click();
  });
  await expect
    .poll(
      async () =>
        (await readCapture(page)).commands.filter(
          (command) =>
            command.type === "respond" &&
            command.promptId === prompt?.prompt.id,
        ).length,
    )
    .toBe(1);
  await page.getByRole("button", { name: "Retry duel field" }).click();
  await expect(page.getByRole("region", { name: "Duel field" })).toBeVisible();
});

test("rail reduced motion keeps three thinking dots visible and static", async ({
  page,
}) => {
  await page.addInitScript(() => {
    const postMessage = Worker.prototype.postMessage;
    Object.defineProperty(Worker.prototype, "postMessage", {
      configurable: true,
      value: function (
        this: Worker,
        message: unknown,
        options?: StructuredSerializeOptions | Transferable[],
      ): void {
        if (
          typeof message === "object" &&
          message !== null &&
          "type" in message &&
          message.type === "respond"
        )
          return;
        Reflect.apply(postMessage, this, [message, options]);
      },
    });
  });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await openDuel(page);
  await startPresetDuel(page);
  const endTurn = page.locator('[data-cy="field-end-turn-button"]');
  await expect(endTurn).toBeEnabled({ timeout: 120_000 });
  await endTurn.click();

  const dotsContainer = page.locator('[data-cy="duel-right-rail-status-dots"]');
  await expect(dotsContainer).toBeVisible();
  const dots = dotsContainer.locator("i");
  await expect(dots).toHaveCount(3);
  for (let index = 0; index < 3; index += 1)
    await expect(dots.nth(index)).toBeVisible();
  const styles = await Promise.all(
    Array.from({ length: 3 }, (_, index) =>
      dots.nth(index).evaluate((element) => {
        const style = getComputedStyle(element);
        return {
          animationName: style.animationName,
          opacity: Number(style.opacity),
          visibility: style.visibility,
        };
      }),
    ),
  );
  expect(styles).toHaveLength(3);
  for (const [index, style] of styles.entries()) {
    expect(style, `dot ${index + 1} reduced-motion style`).toEqual({
      animationName: "none",
      opacity: 1,
      visibility: "visible",
    });
  }
});

test("smallest supported layout preserves controls and honors reduced motion", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1366, height: 768 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await openDuel(page);
  await startPresetDuel(page);
  await expect(page.locator("[data-prompt-kind]")).toBeVisible({
    timeout: 120_000,
  });
  const fieldRegion = page.getByRole("region", { name: "Duel field" });
  await expect(fieldRegion).toBeVisible();
  const dimensions = await fieldRegion
    .locator('[data-cy="duel-field-scroll-region"]')
    .evaluate((element) => ({
      clientWidth: element.clientWidth,
      scrollWidth: element.scrollWidth,
      clientHeight: element.clientHeight,
      scrollHeight: element.scrollHeight,
      bodyWidth: document.body.scrollWidth,
      viewportWidth: window.innerWidth,
    }));
  expect(dimensions.scrollWidth).toBeLessThanOrEqual(
    dimensions.clientWidth + 1,
  );
  expect(dimensions.scrollHeight).toBeLessThanOrEqual(
    dimensions.clientHeight + 1,
  );
  expect(dimensions.bodyWidth).toBeLessThanOrEqual(dimensions.viewportWidth);
  const firstDecision = page.locator("[data-prompt-kind] button").first();
  const box = await firstDecision.boundingBox();
  expect(box?.height).toBeGreaterThanOrEqual(44);
  expect(box?.width).toBeGreaterThanOrEqual(44);
});

test("wheel over the duel field never scrolls the default duel page", async ({
  page,
}) => {
  // Narrow (<80rem) and short (<=48rem) at once: the combined constrained
  // layout the ticket's requirements name explicitly.
  await page.setViewportSize({ width: 900, height: 420 });
  await openDuel(page);
  await startPresetDuel(page);
  await expect(page.locator("[data-prompt-kind]")).toBeVisible({
    timeout: 120_000,
  });
  const main = page.locator('[data-cy="app-main"]');
  await expect(main).toHaveAttribute("data-duel-viewport", "true");
  const field = page.locator('[data-cy="duel-field"]');
  await expect(field).toBeVisible();
  const box = await field.boundingBox();
  if (box === null) throw new Error("Duel field has no bounding box");
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.wheel(0, 400);
  // A wheel over the field may still scroll the field's own internal
  // overflow (asserted elsewhere); it must never move the page itself.
  await page.waitForTimeout(200);
  expect(await page.evaluate(() => window.scrollY)).toBe(0);
});

test("default duel occupies exactly one viewport at every supported viewport", async ({
  page,
}) => {
  await openDuel(page);
  await startPresetDuel(page);
  await expect(page.locator("[data-prompt-kind]")).toBeVisible({
    timeout: 120_000,
  });
  const main = page.locator('[data-cy="app-main"]');
  const field = page.locator('[data-cy="duel-field"]');

  // 1280×720 is Playwright's own default viewport (unexercised by
  // `RESPONSIVE_VIEWPORTS`) and sits exactly on the wide/narrow breakpoint
  // (79rem = 1264px), so it gets its own explicit check alongside the named
  // viewport table.
  const viewportsUnderTest = [
    { id: "VP-DEFAULT", width: 1280, height: 720 },
    ...RESPONSIVE_VIEWPORTS,
  ] as const;

  for (const viewport of viewportsUnderTest) {
    await page.setViewportSize({
      width: viewport.width,
      height: viewport.height,
    });
    await page.evaluate(() => window.scrollTo(0, 0));
    const label =
      "zoomEquivalent" in viewport
        ? `${viewport.id} ${viewport.zoomEquivalent}`
        : viewport.id;
    await expect(main).toHaveAttribute("data-duel-viewport", "true");

    await expect(async () => {
      const metrics = await page.evaluate(() => ({
        documentScrollHeight: document.documentElement.scrollHeight,
        bodyScrollHeight: document.body.scrollHeight,
        innerHeight: window.innerHeight,
      }));
      expect(
        metrics.documentScrollHeight,
        `${label} document must not overflow the viewport`,
      ).toBeLessThanOrEqual(metrics.innerHeight + 1);
      expect(
        metrics.bodyScrollHeight,
        `${label} body must not overflow the viewport`,
      ).toBeLessThanOrEqual(metrics.innerHeight + 1);
    }).toPass();

    await expect(field).toBeVisible();
    const box = await field.boundingBox();
    if (box === null)
      throw new Error(`${label} duel field has no bounding box`);
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.wheel(0, 400);
    await page.waitForTimeout(100);
    expect(
      await page.evaluate(() => window.scrollY),
      `${label} wheel over the field must not move the page`,
    ).toBe(0);

    await assertSharesShellColumns(page, label);

    await page.mouse.wheel(0, -400);
  }
});

/* T4: above the 1024px breakpoint the app is a centred 16:9 stage, so a
   viewport that is not itself 16:9 gets `--bg` bars instead of a stretched
   duel — and the page still never scrolls. The duel is the one route that
   spends the *vertical* bars: it keeps the 16:9 height and takes the whole
   viewport width, because the board is sized from the stage height and the
   reclaimed width is worth more to the right rail (see below). */
test("the shell letterboxes the app to a 16:9 stage above the breakpoint", async ({
  page,
}) => {
  await openDuel(page);
  await startPresetDuel(page);
  await expect(page.locator("[data-prompt-kind]")).toBeVisible({
    timeout: 120_000,
  });
  const stage = page.locator('[data-cy="app-stage"]');
  const field = page.locator('[data-cy="duel-field"]');

  for (const viewport of [
    { id: "VP-BARS-Y", width: 1920, height: 1200 },
    { id: "VP-BARS-X", width: 1280, height: 600 },
  ] as const) {
    await page.setViewportSize({
      width: viewport.width,
      height: viewport.height,
    });
    await expect(stage).toHaveAttribute("data-stage-mode", "stage");

    let box!: NonNullable<Awaited<ReturnType<typeof stage.boundingBox>>>;
    await expect(async () => {
      const b = await stage.boundingBox();
      if (b === null) throw new Error(`${viewport.id} stage has no box`);
      // The height law is untouched: the stage is never taller than the 16:9
      // rectangle that fits, so `VP-BARS-Y` still gets its top and bottom bars.
      expect(
        b.height,
        `${viewport.id} stage keeps the 16:9 height (got ${b.width}x${b.height})`,
      ).toBeLessThanOrEqual((viewport.width * 9) / 16 + 1);
      expect(b.height).toBeLessThanOrEqual(viewport.height);
      // The width law is lifted for the duel: no side bars remain inside the
      // shell's intentional outer stage inset.
      const insets = await stage.evaluate((element) => {
        const style = getComputedStyle(element);
        const root = getComputedStyle(document.documentElement);
        return {
          actual:
            Number.parseFloat(style.marginLeft) +
            Number.parseFloat(style.marginRight),
          expected:
            Number.parseFloat(root.getPropertyValue("--space-2")) *
            Number.parseFloat(root.fontSize) *
            2,
        };
      });
      expect(insets.actual).toBeCloseTo(insets.expected, 1);
      expect(
        b.width,
        `${viewport.id} duel stage spends all width inside its stage inset`,
      ).toBeGreaterThanOrEqual(viewport.width - insets.expected - 1);
      box = b;
    }).toPass();

    await expect(async () => {
      const metrics = await page.evaluate(() => ({
        scrollHeight: document.scrollingElement!.scrollHeight,
        innerHeight: window.innerHeight,
        bodyOverflow: getComputedStyle(document.body).overflowY,
      }));
      expect(
        metrics.scrollHeight,
        `${viewport.id} page must not scroll`,
      ).toBeLessThanOrEqual(metrics.innerHeight + 1);
      expect(metrics.bodyOverflow).toBe("hidden");
    }).toPass();
    await assertNoPageWideHorizontalOverflow(page, viewport.id);

    // The duel renders inside the stage, never outside its bars.
    await expect(async () => {
      const fieldBox = await field.boundingBox();
      if (fieldBox === null) throw new Error(`${viewport.id} field has no box`);
      expect(fieldBox.y).toBeGreaterThanOrEqual(box.y - 1);
      expect(fieldBox.y + fieldBox.height).toBeLessThanOrEqual(
        box.y + box.height + 1,
      );
    }).toPass();
  }

  // The duel measures the stage, not the viewport, so it fills the box.
  await page.setViewportSize({ width: 1600, height: 1000 });
  await expect(async () => {
    const stageBox = await stage.boundingBox();
    const regionBox = await page
      .locator('[data-cy="shell-region-duel"]')
      .boundingBox();
    if (stageBox === null || regionBox === null)
      throw new Error("stage or duel region has no bounding box");
    expect(Math.abs(regionBox.height - stageBox.height)).toBeLessThanOrEqual(1);
  }).toPass();

  // Every other route keeps both halves of T4, so the full-bleed width is a
  // duel exemption rather than a repealed law. Checked last, because it leaves
  // the duel route.
  await page.setViewportSize({ width: 1280, height: 600 });
  await page.goto("./#/");
  await expect(stage).toHaveAttribute("data-stage-route", "home");
  const homeBox = await stage.boundingBox();
  if (homeBox === null) throw new Error("home stage has no box");
  expect(
    Math.abs(homeBox.width - (homeBox.height * 16) / 9),
    `home stage must be 16:9 (got ${homeBox.width}x${homeBox.height})`,
  ).toBeLessThanOrEqual(1);
  expect(homeBox.width).toBeLessThan(1280);
});

/* The board is sized from the stage height, so the width the duel reclaims
   from the pillarbox cannot make it bigger. It goes to the right rail instead,
   minus `--duel-field-inset` of breathing room on each side of the board. */
test("the duel spends the reclaimed pillarbox on the right rail, not the board", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1920, height: 900 });
  await openDuel(page);
  await startPresetDuel(page);
  await expect(page.locator("[data-prompt-kind]")).toBeVisible({
    timeout: 120_000,
  });

  const boxes = await page.evaluate(() => {
    const rect = (selector: string): DOMRect | null =>
      document.querySelector(selector)?.getBoundingClientRect() ?? null;
    return {
      stage: rect('[data-cy="app-stage"]'),
      shell: rect('[data-cy="duel-shell"]'),
      preview: rect('[data-cy="card-preview-panel"]'),
      slot: rect('[data-cy="duel-field-slot"]'),
      field: rect('[data-cy="duel-field"]'),
      phaseBar: rect('[data-cy="phase-bar"]'),
      rail: rect('[data-cy="duel-right-rail"]'),
      innerWidth: window.innerWidth,
      // The 16:9 width the stage would have had, which is what the field
      // column is still sized against.
      letterboxWidth:
        (Math.min(window.innerHeight, (window.innerWidth * 9) / 16) * 16) / 9,
    };
  });
  const { stage, shell, preview, slot, field, phaseBar, rail } = boxes;
  if (
    stage === null ||
    shell === null ||
    preview === null ||
    slot === null ||
    field === null ||
    phaseBar === null ||
    rail === null
  )
    throw new Error("missing duel shell geometry");

  // 1920x900 is wider than 16:9, so there is a real bar to reclaim.
  expect(boxes.letterboxWidth).toBeLessThan(boxes.innerWidth - 2);
  expect(shell.width).toBeCloseTo(stage.width, 1);

  // The board keeps the width the letterboxed stage gave it.
  expect(field.width).toBeLessThanOrEqual(slot.width + 1);
  expect(
    slot.width,
    "the field column is sized from the letterboxed stage, not the viewport",
  ).toBeLessThanOrEqual(boxes.letterboxWidth - preview.width + 1);

  // Everything the shell reclaimed past the board's inset is the rail's.
  const reclaimed = boxes.innerWidth - boxes.letterboxWidth;
  expect(
    rail.width,
    "the rail absorbs the reclaimed pillarbox",
  ).toBeGreaterThan(reclaimed / 2);
  // The phase bar shares the board's column, stacked above it.
  expect(phaseBar.bottom).toBeLessThanOrEqual(slot.top + 1);
  expect(rail.left).toBeGreaterThanOrEqual(slot.right - 1);
  expect(rail.right).toBeLessThanOrEqual(shell.right + 1);
  // The board gained breathing room on both sides before the rail.
  expect(
    Math.abs(field.left - preview.right - (rail.left - field.right)),
    "the board is inset symmetrically between the preview and the rail",
  ).toBeLessThanOrEqual(2);

  await assertNoPageWideHorizontalOverflow(page, "duel full-bleed");
});

test("short-height duel keeps the full-height preview column, bounded art and scroll-ready text", async ({
  page,
}) => {
  await page.setViewportSize({ width: 900, height: 420 });
  await openDuel(page);
  await startPresetDuel(page);
  await expect(page.locator("[data-prompt-kind]")).toBeVisible({
    timeout: 120_000,
  });
  const field = page.locator('[data-cy="duel-field"]');
  await expect(field).toBeVisible();
  const panel = page.locator('[data-cy="card-preview-panel"]');

  // Hover every rendered card once, keeping whichever preview shows the
  // longest description. The seed is random, so keyboard scrolling is only
  // exercised when its longest real card text exceeds the available space.
  const cards = field.locator(".duel-field-card");
  const cardCount = await cards.count();
  let longest = { length: -1, index: -1 };
  for (let index = 0; index < cardCount; index += 1) {
    await cards.nth(index).hover({ force: true });
    const previewText = page.locator('[data-cy="card-preview-text"]');
    if ((await previewText.count()) === 0) continue;
    const length = await previewText.evaluate(
      (element) => element.textContent?.length ?? 0,
    );
    if (length > longest.length) longest = { length, index };
  }
  expect(
    longest.index,
    "no card preview ever populated a description",
  ).toBeGreaterThanOrEqual(0);
  await cards.nth(longest.index).hover({ force: true });

  await expect(panel.locator('[data-cy="card-preview-name"]')).toBeVisible();

  const previewGeometry = await panel.evaluate((element) => {
    const image = element.querySelector<HTMLImageElement>(
      '[data-cy="card-preview-image"]',
    );
    const art = element.querySelector('[data-cy="card-preview-art"]');
    if (image === null || art === null) return null;
    const panelBox = element.getBoundingClientRect();
    const artBox = art.getBoundingClientRect();
    const imageBox = image.getBoundingClientRect();
    const rootStyle = getComputedStyle(document.documentElement);
    return {
      panel: {
        left: panelBox.left,
        top: panelBox.top,
        right: panelBox.right,
        bottom: panelBox.bottom,
        width: panelBox.width,
      },
      art: { left: artBox.left, right: artBox.right, width: artBox.width },
      image: {
        left: imageBox.left,
        top: imageBox.top,
        right: imageBox.right,
        bottom: imageBox.bottom,
        width: imageBox.width,
      },
      previewWidth:
        Number.parseFloat(rootStyle.getPropertyValue("--preview-w")) *
        Number.parseFloat(rootStyle.fontSize),
      objectFit: getComputedStyle(image).objectFit,
      naturalAspect: image.naturalWidth / image.naturalHeight,
      viewport: { width: window.innerWidth, height: window.innerHeight },
    };
  });
  if (previewGeometry === null) throw new Error("Preview art is not mounted");
  expect(previewGeometry.panel.width).toBeCloseTo(
    previewGeometry.previewWidth,
    1,
  );
  expect(previewGeometry.panel.top).toBeGreaterThanOrEqual(0);
  expect(previewGeometry.panel.bottom).toBeLessThanOrEqual(
    previewGeometry.viewport.height + 1,
  );
  expect(previewGeometry.panel.right).toBeLessThanOrEqual(
    previewGeometry.viewport.width + 1,
  );
  expect(previewGeometry.image.left).toBeCloseTo(previewGeometry.art.left, 1);
  expect(previewGeometry.image.top).toBeGreaterThanOrEqual(
    previewGeometry.panel.top,
  );
  expect(previewGeometry.image.right).toBeCloseTo(previewGeometry.art.right, 1);
  expect(previewGeometry.image.bottom).toBeLessThanOrEqual(
    previewGeometry.panel.bottom,
  );
  expect(previewGeometry.image.width).toBeCloseTo(previewGeometry.art.width, 1);
  expect(previewGeometry.objectFit).toBe("contain");
  expect(previewGeometry.naturalAspect).toBeGreaterThan(0);

  const text = panel.locator('[data-cy="card-preview-text"]');
  const textMetrics = await text.evaluate((element) => ({
    clientHeight: element.clientHeight,
    scrollHeight: element.scrollHeight,
    overflowY: getComputedStyle(element).overflowY,
  }));
  expect(textMetrics.clientHeight).toBeGreaterThan(0);
  expect(textMetrics.scrollHeight).toBeGreaterThanOrEqual(
    textMetrics.clientHeight,
  );
  expect(textMetrics.overflowY).toMatch(/auto|scroll/);
  if (textMetrics.scrollHeight > textMetrics.clientHeight) {
    await text.focus();
    await page.keyboard.press("End");
    expect(await text.evaluate((element) => element.scrollTop)).toBeGreaterThan(
      0,
    );
    await page.keyboard.press("Home");
    expect(await text.evaluate((element) => element.scrollTop)).toBe(0);
  }
});

/* T14/ADR-017: both field windows are dragged by their handles, clamped to
   the visible duel field, remembered across a reload, and — for the confirm
   window — never dismissed or answered by an outside press or Escape. */
test("floating field windows stay inside the field, persist and never lose a decision", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await openDuel(page);
  await startPresetDuel(page);
  await expect(page.locator("[data-prompt-kind]")).toBeVisible({
    timeout: 120_000,
  });
  const field = page.locator('[data-cy="duel-field"]');
  await expect(field).toBeVisible();
  // Auto-answered prompts would replace the live decision (and close the zone
  // list with it) mid-measurement, exactly as they race the keyboard walker.
  await disableAutoResolveTrivialPrompts(page);
  await disableAutoPlaceCards(page);
  const confirmWindow = page.locator(
    '[data-cy="floating-field-window-confirm"]',
  );
  const listWindow = page.locator('[data-cy="floating-field-window-zoneList"]');
  await waitForConfirmWindow(page);
  await openZoneList(page);

  const responsesBefore = await countResponses(page);
  const corners = [
    { x: -600, y: -600 },
    { x: 4000, y: -600 },
    { x: 4000, y: 4000 },
    { x: -600, y: 4000 },
  ] as const;
  /* One window at a time: a press both raises and drags, so a window buried
     under another cannot be grabbed — exactly what a player sees. */
  for (const corner of corners) {
    await dragFieldWindow(page, "zoneList", corner);
    await assertWindowInsideField(page, "zoneList", "zone list drag");
  }
  const draggedList = await windowOffset(page, "zoneList");
  await page.keyboard.press("Escape");
  await expect(listWindow).toHaveCount(0);
  for (const corner of corners) {
    await dragFieldWindow(page, "confirm", corner);
    await assertWindowInsideField(page, "confirm", "confirm drag");
  }
  const draggedConfirm = await windowOffset(page, "confirm");
  expect(await countResponses(page)).toBe(responsesBefore);

  expect(
    await page.evaluate(() =>
      JSON.parse(localStorage.getItem("ygo.ui.v2") ?? "null"),
    ),
  ).toEqual({
    version: 2,
    windows: { zoneList: draggedList, confirm: draggedConfirm },
    /* The player seat follows the stored default deck, whose id is generated
       when the starter deck seeds, so only the fixed opponent is pinned. */
    decks: {
      playerKey: expect.any(String),
      opponentKey: "preset:shaddoll",
    },
    settings: {
      showZoneOutlines: true,
      showZoneCounts: true,
      showCardShadows: true,
      showZoneLabels: true,
    },
  });
  expect(
    await page.evaluate(() => localStorage.getItem("ygo.ui.v1")),
  ).toBeNull();

  // Panning the board must not move a window: the pan lives on the field's
  // scroll child, the windows on the still field root.
  const before = await windowRect(page, "confirm");
  await field
    .locator('[data-cy="duel-field-scroll-region"]')
    .evaluate((element) => {
      element.scrollLeft = element.scrollWidth;
      element.scrollTop = element.scrollHeight;
    });
  const after = await windowRect(page, "confirm");
  expect(Math.abs(after.left - before.left)).toBeLessThanOrEqual(1);
  expect(Math.abs(after.top - before.top)).toBeLessThanOrEqual(1);

  // A vertical wheel over the horizontal entry run travels it sideways.
  await openZoneList(page);
  const entries = page.locator('[data-cy="zone-list-dialog-entries"]');
  const entriesBox = await entries.boundingBox();
  if (entriesBox === null) throw new Error("Zone list entries have no box");
  await page.mouse.move(
    entriesBox.x + entriesBox.width / 2,
    entriesBox.y + entriesBox.height / 2,
  );
  await page.mouse.wheel(0, 300);
  await expect
    .poll(async () => entries.evaluate((element) => element.scrollLeft))
    .toBeGreaterThan(0);

  // Dismissal matrix: an outside press closes the list and leaves the live
  // decision untouched; Escape does the same.
  await page
    .locator('[data-cy="duel-field-board-surface"]')
    .click({ position: { x: 5, y: 5 }, force: true });
  await expect(listWindow).toHaveCount(0);
  await expect(confirmWindow).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(confirmWindow).toBeVisible();
  expect(await countResponses(page)).toBe(responsesBefore);

  // A narrower viewport reclamps both windows back inside the field.
  await openZoneList(page);
  await page.setViewportSize({ width: 900, height: 600 });
  await assertWindowInsideField(page, "zoneList", "narrow reclamp");
  await assertWindowInsideField(page, "confirm", "narrow reclamp");

  // Positions survive a reload of the whole app.
  await page.setViewportSize({ width: 1280, height: 800 });
  const restored = (await page.evaluate(() =>
    JSON.parse(localStorage.getItem("ygo.ui.v2") ?? "null"),
  )) as { readonly windows: { zoneList: unknown; confirm: unknown } };
  await page.reload();
  await startPresetDuel(page);
  await expect(page.locator("[data-prompt-kind]")).toBeVisible({
    timeout: 120_000,
  });
  await disableAutoResolveTrivialPrompts(page);
  await disableAutoPlaceCards(page);
  await waitForConfirmWindow(page);
  await openZoneList(page);
  expect(await windowOffset(page, "confirm")).toEqual(restored.windows.confirm);
  expect(await windowOffset(page, "zoneList")).toEqual(
    restored.windows.zoneList,
  );
});

/* The opening Main Phase 1 offers no Battle Phase (no battle on the first
   turn), so its only global choice is End turn and no confirm window renders.
   Ending turns walks the duel to the first decision that does render one. */
async function waitForConfirmWindow(page: Page): Promise<void> {
  const confirmWindow = page.locator(
    '[data-cy="floating-field-window-confirm"]',
  );
  const endTurn = page.locator('[data-cy="field-end-turn-button"]');
  for (let step = 0; step < 12; step += 1) {
    if ((await confirmWindow.count()) > 0) break;
    if ((await endTurn.count()) > 0 && (await endTurn.isEnabled()))
      await endTurn.click();
    await page.waitForTimeout(750);
  }
  await expect(confirmWindow).toBeVisible({ timeout: 60_000 });
}

async function openZoneList(page: Page): Promise<void> {
  const listWindow = page.locator('[data-cy="floating-field-window-zoneList"]');
  await expect
    .poll(
      async () => {
        if ((await listWindow.count()) > 0) return true;
        await page.locator('[data-cy="field-stack-p0:deck"]').click();
        return (await listWindow.count()) > 0;
      },
      { timeout: 30_000 },
    )
    .toBe(true);
  await expect(listWindow).toBeVisible();
}

async function countResponses(page: Page): Promise<number> {
  return (await readCapture(page)).commands.filter(
    (command) => command.type === "respond",
  ).length;
}

async function windowOffset(
  page: Page,
  windowId: "zoneList" | "confirm",
): Promise<{ readonly x: number; readonly y: number }> {
  return page
    .locator(`[data-cy="floating-field-window-${windowId}"]`)
    .evaluate((element) => ({
      x: Number.parseFloat(
        (element as HTMLElement).style.getPropertyValue("--window-x"),
      ),
      y: Number.parseFloat(
        (element as HTMLElement).style.getPropertyValue("--window-y"),
      ),
    }));
}

async function windowRect(
  page: Page,
  windowId: "zoneList" | "confirm",
): Promise<{ readonly left: number; readonly top: number }> {
  return page
    .locator(`[data-cy="floating-field-window-${windowId}"]`)
    .evaluate((element) => {
      const box = element.getBoundingClientRect();
      return { left: box.left, top: box.top };
    });
}

async function dragFieldWindow(
  page: Page,
  windowId: "zoneList" | "confirm",
  to: { readonly x: number; readonly y: number },
): Promise<void> {
  const handle = page.locator(
    `[data-cy="floating-field-window-${windowId}-handle"]`,
  );
  const box = await handle.boundingBox();
  if (box === null) throw new Error(`${windowId} handle has no box`);
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 8 });
  await page.mouse.up();
}

/* The reclamp after a resize runs from a ResizeObserver callback, so
   containment is polled rather than sampled once. */
async function assertWindowInsideField(
  page: Page,
  windowId: "zoneList" | "confirm",
  label: string,
): Promise<void> {
  await expect
    .poll(
      async () =>
        page.locator('[data-cy="duel-field"]').evaluate((element, id) => {
          const windowElement = element.querySelector(
            `[data-cy="floating-field-window-${id}"]`,
          );
          if (windowElement === null) return "missing field window";
          const field = element.getBoundingClientRect();
          const box = windowElement.getBoundingClientRect();
          const outside = [
            box.left < field.left - 1 ? `left ${box.left} < ${field.left}` : "",
            box.top < field.top - 1 ? `top ${box.top} < ${field.top}` : "",
            box.right > field.right + 1
              ? `right ${box.right} > ${field.right}`
              : "",
            box.bottom > field.bottom + 1
              ? `bottom ${box.bottom} > ${field.bottom}`
              : "",
          ].filter((entry) => entry !== "");
          return outside.length === 0 ? "inside" : outside.join(", ");
        }, windowId),
      {
        timeout: 10_000,
        message: `${label} ${windowId} inside the duel field`,
      },
    )
    .toBe("inside");
}

test("zone-list preview image never exceeds half the viewport height", async ({
  page,
}) => {
  await openDuel(page);
  await startPresetDuel(page);
  await expect(page.locator("[data-prompt-kind]")).toBeVisible({
    timeout: 120_000,
  });
  const field = page.locator('[data-cy="duel-field"]');
  await expect(field).toBeVisible();

  const deckStack = field.locator('[data-cy="field-stack-p0:deck"]');
  await deckStack.scrollIntoViewIfNeeded();
  await deckStack.click();
  const dialog = page.locator('[data-cy="zone-list-dialog"]');
  await expect(dialog).toBeVisible();

  const innerHeight = await page.evaluate(() => window.innerHeight);
  const heights = await dialog
    .locator(".zone-list-entry > img")
    .evaluateAll((elements) =>
      elements.map((element) => element.getBoundingClientRect().height),
    );
  expect(heights.length).toBeGreaterThan(0);
  for (const height of heights)
    expect(height).toBeLessThanOrEqual(innerHeight * 0.5 + 1);
});

/* Shared by the pointer-drag tests below: sets up the field, finds a
   draggable hand card with a legal placement and returns pointer-drag
   geometry, or `null` when the opening hand offers no placement to drag
   (the caller must then skip). */
async function locateDraggablePlacement(page: Page): Promise<{
  readonly field: Locator;
  readonly dragTarget: Locator;
  readonly targetZone: Locator;
  readonly targetZoneId: string;
  readonly cardBox: {
    readonly x: number;
    readonly y: number;
    readonly width: number;
    readonly height: number;
  };
  readonly from: { readonly x: number; readonly y: number };
  readonly to: { readonly x: number; readonly y: number };
  /** The action the walker picked, which is also the answer to give the drop
      confirmation when the same card offers more than one (item 6). */
  readonly action: string;
} | null> {
  /* A pointer gesture is driven in viewport coordinates, so the whole board —
     the hand row and the monster row at once — has to be on screen. The
     default 720px-tall viewport puts the hand below the fold, where
     `elementFromPoint` returns null and every synthetic move is a no-op. */
  await page.setViewportSize({ width: 1440, height: 1400 });
  await openDuel(page);
  await startPresetDuel(page);
  await expect(
    page.locator('[data-cy="duel-field"][data-prompt-kind="idleCommand"]'),
  ).toBeVisible({ timeout: 120_000 });
  await page.evaluate(() => window.scrollTo(0, 0));
  const field = page.getByRole("region", { name: "Duel field" });

  /* Match the engine's own action id through the chip's `data-cy` suffix,
     never the chip's word: `cardActionLabel` prints `Set` for both
     `setMonster` and `setSpellTrap`, so a text match could pick a spell and
     then fail on a monster zone for a reason unrelated to dragging. */
  const handChip = (action: string): Locator =>
    field.locator(
      `.duel-field-card[data-card-zone-id="p0:hand"] [data-cy^="card-action-chip-"][data-cy$="-${action}"]`,
    );
  /* Any placement the hand offers exercises the same seam, so the walker tries
     the monster row first and falls back to the backrow rather than skipping.
     `activate` is deliberately absent: a card offering both puts `activate`
     first in the drop confirmation (item 6), and an activated Spell need not
     stay in the zone it was placed in, so it cannot carry the "one gesture,
     two responses" assertions below. */
  const PLACEMENTS = [
    { action: "summon", zoneKind: "mainMonster" },
    { action: "setMonster", zoneKind: "mainMonster" },
    { action: "setSpellTrap", zoneKind: "spellTrap" },
  ] as const;

  const firstEmptyZone = async (
    zoneKind: "mainMonster" | "spellTrap",
  ): Promise<string | null> =>
    field.evaluate((element, kind) => {
      for (let sequence = 0; sequence < 5; sequence += 1) {
        const zoneId = `p0:${kind}:${sequence}`;
        if (
          element.querySelector(
            `.duel-field-card[data-card-zone-id="${zoneId}"]`,
          ) === null
        )
          return zoneId;
      }
      return null;
    }, zoneKind);

  let chosen: {
    readonly chip: Locator;
    readonly zoneId: string;
    readonly action: string;
  } | null = null;
  for (const placement of PLACEMENTS) {
    const zoneId = await firstEmptyZone(placement.zoneKind);
    if (zoneId === null) continue;
    const chips = handChip(placement.action);
    const total = await chips.count();
    for (let index = 0; index < total; index += 1) {
      const chip = chips.nth(index);
      /* A card offering an activation would answer a backrow drop with the
         confirm dialog, which this test cannot assert on. Item 4 took the
         `activate` chip off the pointer surfaces, so the only way left to ask
         is to lift the card and look for its dashed zone, then abandon the
         gesture over dead ground — a release outside every zone dispatches
         nothing. */
      if (placement.action === "setSpellTrap") {
        const probeId = await chip.evaluate(
          (element) =>
            element.closest(".duel-field-card")?.getAttribute("data-card-id") ??
            "",
        );
        const probeTarget = field.locator(
          `[data-cy="field-card-target-${probeId}"]`,
        );
        await probeTarget.scrollIntoViewIfNeeded();
        const probeBox = await probeTarget.boundingBox();
        if (probeBox === null) continue;
        const probeCentre = {
          x: probeBox.x + probeBox.width / 2,
          y: probeBox.y + probeBox.height / 2,
        };
        await page.mouse.move(probeCentre.x, probeCentre.y);
        await page.mouse.down();
        // 24px clears CardControl's 8px click-suppression gate.
        await page.mouse.move(probeCentre.x + 24, probeCentre.y - 24, {
          steps: 3,
        });
        const offersActivate =
          (await page
            .locator('[data-cy="hand-activation-drop-zone"]')
            .count()) > 0;
        await page.mouse.move(8, 8);
        await page.mouse.up();
        if (offersActivate) continue;
      }
      chosen = { chip, zoneId, action: placement.action };
      break;
    }
    if (chosen !== null) break;
  }
  if (chosen === null) return null;

  const { chip, zoneId: targetZoneId, action } = chosen;
  const cardId = await chip.evaluate(
    (element) =>
      element.closest(".duel-field-card")?.getAttribute("data-card-id") ?? "",
  );
  expect(cardId).not.toBe("");
  const dragTarget = field.locator(`[data-cy="field-card-target-${cardId}"]`);
  const targetZone = field.locator(`[data-zone-id="${targetZoneId}"]`);

  await dragTarget.scrollIntoViewIfNeeded();
  const cardBox = await dragTarget.boundingBox();
  const zoneBox = await targetZone.boundingBox();
  if (cardBox === null || zoneBox === null)
    throw new Error("Missing drag geometry");
  const viewportHeight = await page.evaluate(() => window.innerHeight);
  expect(
    cardBox.y + cardBox.height <= viewportHeight &&
      zoneBox.y + zoneBox.height <= viewportHeight,
    `hand card (bottom ${cardBox.y + cardBox.height}) and target zone (bottom ${zoneBox.y + zoneBox.height}) must both sit inside the ${viewportHeight}px viewport for a pointer drag`,
  ).toBe(true);
  const from = {
    x: cardBox.x + cardBox.width / 2,
    y: cardBox.y + cardBox.height / 2,
  };
  const to = {
    x: zoneBox.x + zoneBox.width / 2,
    y: zoneBox.y + zoneBox.height / 2,
  };

  return {
    field,
    dragTarget,
    targetZone,
    targetZoneId,
    cardBox,
    from,
    to,
    action,
  };
}

/**
 * A `null` placement is only a legitimate seed outcome while the hand is
 * actually mounted and actionable. Chips that stopped rendering, a changed
 * `data-cy` scheme, hand cards that stopped being actionable and a hand band
 * that stopped mounting all produce the same `null` — and would silently
 * delete both of T13's only real-browser pointer proofs. Assert the
 * preconditions first; only an actionable hand may skip.
 */
async function assertHandCouldOfferAPlacement(page: Page): Promise<void> {
  const field = page.getByRole("region", { name: "Duel field" });
  const handCards = field.locator(
    '.duel-field-card[data-card-zone-id="p0:hand"]',
  );
  expect(
    await handCards.count(),
    "the player hand band must mount at least one card before a drag test may skip",
  ).toBeGreaterThan(0);
  const actionableHandCards = field.locator(
    '.duel-field-card.is-actionable[data-card-zone-id="p0:hand"]',
  );
  expect(
    await actionableHandCards.count(),
    "at least one mounted hand card must be actionable before a drag test may skip",
  ).toBeGreaterThan(0);
}

async function advanceToPlayerPhase(
  page: Page,
  playerHalf: Locator,
  phase: "main1" | "main2",
  readyControl: Locator,
): Promise<void> {
  const setup = { needsDefense: false };
  for (let step = 0; step < 40; step += 1) {
    const result = page.locator(".result-panel");
    if (
      (await playerHalf.getAttribute("data-current-phase")) === phase &&
      (await readyControl.isEnabled())
    )
      return;
    if (await result.isVisible())
      throw new Error(`Duel completed before player reached ${phase}`);
    const controls = await activePromptControls(page);
    await controls.waitFor({ state: "visible", timeout: 30_000 });
    const kind = await controls.getAttribute("data-prompt-kind");
    if (kind === null) throw new Error("Prompt kind is missing");
    /* Prompt id changes before phase controls finish enabling. Once the target
       phase owns its idle command, wait for that same control instead of
       answering the idle prompt and accidentally ending the phase. */
    if (
      kind === "idleCommand" &&
      (await playerHalf.getAttribute("data-current-phase")) === phase
    ) {
      await expect(readyControl).toBeEnabled();
      return;
    }
    const promptId = await readLatestPromptId(page);
    if (promptId === undefined) throw new Error("Captured prompt is missing");
    if (kind === "battleCommand" && phase === "main2") {
      const main2 = page.locator(
        'button[data-cy="phase-bar-you-main2"]:enabled',
      );
      if ((await main2.count()) > 0) await main2.click();
    } else {
      await answerPromptWithKeyboard(page, controls, kind, setup);
    }
    await expect
      .poll(async () => {
        if (await result.isVisible()) return true;
        const currentKind = await (
          await activePromptControls(page)
        ).getAttribute("data-prompt-kind");
        if (currentKind !== null && currentKind !== kind) return true;
        const latest = await readLatestPromptId(page);
        return latest !== undefined && latest !== promptId;
      })
      .toBe(true);
  }
  throw new Error(`Player did not reach ${phase} within 40 prompts`);
}

test("End Turn one press reaches the opponent turn while phase bar stays visible", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openDuel(page);
  await startPresetDuel(page);
  const field = page.getByRole("region", { name: "Duel field" });
  await expect(field).toBeVisible({ timeout: 120_000 });

  const board = page.locator('[data-cy="duel-field-board"]');
  const plane = page.locator('[data-cy="duel-field-board-plane"]');
  await expect(board).toBeVisible();
  await expect(plane).toBeVisible();
  const gap = (await plane.boundingBox())!.y - (await board.boundingBox())!.y;
  expect(gap).toBeGreaterThanOrEqual(-1); // plane top not above board
  expect(gap).toBeLessThanOrEqual(8); // filled

  const oppCard = page
    .locator('[data-cy="field-hand-band-p1"] [data-cy^="field-card-"]')
    .first();
  const youCard = page
    .locator('[data-cy="field-hand-band-p0"] [data-cy^="field-card-"]')
    .first();
  expect(
    (await oppCard.boundingBox())!.height /
      (await youCard.boundingBox())!.height,
  ).toBeLessThan(0.9);

  const phaseBar = page.locator('[data-cy="phase-bar"]');
  const playerHalf = page.locator('[data-cy="phase-bar-player"]');
  const opponentHalf = page.locator('[data-cy="phase-bar-opponent"]');
  await expect(playerHalf).toHaveAttribute("data-current-phase", "main1");
  await disableAutoResolveTrivialPrompts(page);
  await disableAutoPlaceCards(page);
  const endTurn = field.locator('[data-cy="field-end-turn-button"]');
  await expect(
    phaseBar.locator('[data-cy="field-end-turn-button"]'),
  ).toHaveCount(0);
  await expect(endTurn).toBeEnabled();
  await endTurn.click();
  await expect(playerHalf).not.toHaveAttribute("data-current-phase", "main1");
  await expect(opponentHalf).toHaveAttribute("data-current-phase", /.+/);
  await expect(phaseBar.locator("button:enabled")).toHaveCount(0);
  await expect(endTurn).toBeDisabled();
  await advanceToPlayerPhase(page, playerHalf, "main1", endTurn);
  await expect(playerHalf).toHaveAttribute("data-current-phase", "main1");

  const battle = page.locator('button[data-cy="phase-bar-you-battle"]');
  await expect(battle).toBeEnabled();
  await battle.click();
  await expect(playerHalf).toHaveAttribute("data-current-phase", "battle");

  const main2 = page.locator('button[data-cy="phase-bar-you-main2"]');
  await expect(main2).toBeEnabled();
  await main2.click();
  await advanceToPlayerPhase(page, playerHalf, "main2", endTurn);
  await expect(playerHalf).toHaveAttribute("data-current-phase", "main2");

  await expect(endTurn).toHaveText("End turn");
  await expect(endTurn).toBeEnabled();
  await endTurn.click();
  await expect(page.locator('[data-cy="phase-bar-opponent"]')).toHaveAttribute(
    "data-current-phase",
    /.+/,
  );
  await expect(phaseBar.locator("button:enabled")).toHaveCount(0);
  await expect(endTurn).toBeDisabled();
});

test("perspective plane fills the board and excludes fixed descendants at 1280x720", async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await openDuel(page);
  await startPresetDuel(page);
  const field = page.getByRole("region", { name: "Duel field" });
  await expect(field).toBeVisible({ timeout: 120_000 });

  const perspective = await field.evaluate((element) => {
    const board = element.querySelector<HTMLElement>(
      '[data-cy="duel-field-board"]',
    );
    const plane = element.querySelector<HTMLElement>(
      '[data-cy="duel-field-board-plane"]',
    );
    const phaseBar = document.querySelector<HTMLElement>(
      '[data-cy="phase-bar"]',
    );
    if (board === null || plane === null || phaseBar === null) return null;
    const boardRect = board.getBoundingClientRect();
    const planeRect = plane.getBoundingClientRect();
    return {
      boardHeight: board.clientHeight,
      planeStyleHeight: Number.parseFloat(plane.style.height),
      topDelta: boardRect.top - planeRect.top,
      phaseInsidePlane: plane.contains(phaseBar),
      fixedDescendants: [...plane.querySelectorAll<HTMLElement>("*")]
        .filter(
          (descendant) => getComputedStyle(descendant).position === "fixed",
        )
        .map((descendant) => descendant.dataset.cy ?? descendant.className),
    };
  });
  expect(perspective).not.toBeNull();
  expect(perspective?.planeStyleHeight).toBeGreaterThan(
    perspective?.boardHeight ?? Number.POSITIVE_INFINITY,
  );
  expect(
    Math.abs(perspective?.topDelta ?? Number.POSITIVE_INFINITY),
  ).toBeLessThanOrEqual(8);
  expect(perspective?.phaseInsidePlane).toBe(false);
  expect(perspective?.fixedDescendants).toEqual([]);

  const handProof = await field.evaluate((element) => {
    const plane = element.querySelector<HTMLElement>(
      '[data-cy="duel-field-board-plane"]',
    );
    const content = element.querySelector<HTMLElement>(
      '[data-cy="duel-field-board-content"]',
    );
    const zone = element.querySelector<HTMLElement>(
      '[data-zone-id="p0:mainMonster:2"]',
    );
    if (plane === null || content === null || zone === null) return null;

    const carriers = [0, 1].map((player) => {
      const carrier = element.querySelector<HTMLElement>(
        `[data-cy="field-hand-band-p${player}"]`,
      );
      const viewport = element.querySelector<HTMLElement>(
        `[data-cy="field-hand-p${player}-viewport"]`,
      );
      if (carrier === null || viewport === null) return null;
      const carrierStyle = getComputedStyle(carrier);
      const matrix = new DOMMatrixReadOnly(carrierStyle.transform);
      return {
        transform: carrierStyle.transform,
        counterTiltDeg: (Math.atan2(matrix.m23, matrix.m22) * 180) / Math.PI,
        directPreservedChild: carrier.parentElement === content,
        viewportInsideCarrier: viewport.parentElement === carrier,
        viewportOverflowX: getComputedStyle(viewport).overflowX,
      };
    });

    const playerCards = [
      ...element.querySelectorAll<HTMLElement>(
        '.duel-field-card.is-hand-item[data-card-zone-id="p0:hand"]',
      ),
    ];
    const centreCard = playerCards.reduce<HTMLElement | null>(
      (closest, card) => {
        const fan = Math.abs(
          Number.parseFloat(
            card.style.getPropertyValue("--card-fan").replace("deg", ""),
          ),
        );
        if (closest === null) return card;
        const closestFan = Math.abs(
          Number.parseFloat(
            closest.style.getPropertyValue("--card-fan").replace("deg", ""),
          ),
        );
        return fan < closestFan ? card : closest;
      },
      null,
    );
    if (centreCard === null) return null;
    const centreStyle = getComputedStyle(centreCard);
    const centreRect = centreCard.getBoundingClientRect();
    const centreWidth = Number.parseFloat(centreStyle.width);
    const centreHeight = Number.parseFloat(centreStyle.height);
    const centreTransform = centreStyle.transform;
    const zoneRect = zone.getBoundingClientRect();
    return {
      planeTransformStyle: getComputedStyle(plane).transformStyle,
      contentTransformStyle: getComputedStyle(content).transformStyle,
      contentInsidePlane: content.parentElement === plane,
      carriers,
      centreCardTransform: centreTransform,
      centreCardFan: Number.parseFloat(
        centreCard.style.getPropertyValue("--card-fan"),
      ),
      centreCardAspect: centreWidth / centreHeight,
      centreCardForeshortening:
        centreRect.height / centreHeight / (centreRect.width / centreWidth),
      fieldForeshortening:
        zoneRect.height /
        zone.offsetHeight /
        (zoneRect.width / zone.offsetWidth),
    };
  });
  expect(handProof).not.toBeNull();
  expect(handProof?.planeTransformStyle).toBe("preserve-3d");
  expect(handProof?.contentTransformStyle).toBe("preserve-3d");
  expect(handProof?.contentInsidePlane).toBe(true);
  expect(handProof?.carriers).toHaveLength(2);
  for (const carrier of handProof?.carriers ?? []) {
    expect(carrier).not.toBeNull();
    expect(carrier?.transform).toMatch(/^matrix3d\(/);
    expect(carrier?.counterTiltDeg).toBeCloseTo(-20, 3);
    expect(carrier?.directPreservedChild).toBe(true);
    expect(carrier?.viewportInsideCarrier).toBe(true);
    expect(carrier?.viewportOverflowX).toBe("auto");
  }
  expect(handProof?.centreCardTransform).toMatch(/^matrix\(/);
  expect(handProof?.centreCardFan).toBeCloseTo(0, 5);
  expect(handProof?.centreCardAspect).toBeCloseTo(72 / 104, 2);
  expect(handProof?.centreCardForeshortening).toBeCloseTo(1, 1);
  expect(handProof?.fieldForeshortening).toBeLessThan(0.98);

  const focusTarget = field
    .locator(
      '.duel-field-card.is-identity-known.is-hand-item [data-cy^="field-card-target-"]',
    )
    .first();
  await focusTarget.focus();
  await expect(focusTarget).toBeFocused();
  await expect
    .poll(() =>
      focusTarget.evaluate((element) => {
        const card = element.closest<HTMLElement>(".duel-field-card");
        if (card === null) return null;
        const matrix = new DOMMatrixReadOnly(getComputedStyle(card).transform);
        return Math.hypot(matrix.m11, matrix.m12);
      }),
    )
    .toBeCloseTo(1.35, 2);
  await focusTarget.evaluate((element) => element.blur());

  const screenshotPath = testInfo.outputPath("t3-hand-card-presentation.png");
  await page.screenshot({ path: screenshotPath, fullPage: true });
  await testInfo.attach("t3-hand-card-presentation", {
    path: screenshotPath,
    contentType: "image/png",
  });
});

test("dragging a hand card onto a highlighted zone plays it", async ({
  page,
}) => {
  const placement = await locateDraggablePlacement(page);
  if (placement === null) {
    await assertHandCouldOfferAPlacement(page);
    test.skip(
      true,
      "opening hand offers no summon, no monster set and no settable spell or trap — there is no placement of any kind to drag",
    );
    return;
  }
  const { field, dragTarget, targetZone, targetZoneId, cardBox, from, to } =
    placement;

  const before = await readCapture(page);
  const idlePrompt = [...before.events]
    .reverse()
    .find((event) => event.type === "prompt") as unknown as
    CapturedPromptEvent | undefined;
  expect(idlePrompt?.prompt.kind).toBe("idleCommand");
  const idlePromptId = idlePrompt?.prompt.id;
  const responsesBefore = before.commands.filter(
    (command) => command.type === "respond",
  ).length;

  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(
    from.x + (to.x - from.x) / 3,
    from.y + (to.y - from.y) / 3,
    { steps: 4 },
  );
  await page.mouse.move(
    from.x + ((to.x - from.x) * 2) / 3,
    from.y + ((to.y - from.y) * 2) / 3,
    { steps: 4 },
  );
  await expect(targetZone).toHaveAttribute("data-drop-candidate", "true");

  const ghost = page.locator('[data-cy="drag-ghost"]');
  await expect(ghost).toBeVisible();
  expect(
    await field.evaluate((element) => {
      const plane = element.querySelector('[data-cy="duel-field-board-plane"]');
      const dragGhost = element.querySelector('[data-cy="drag-ghost"]');
      return plane !== null && dragGhost !== null && plane.contains(dragGhost);
    }),
  ).toBe(false);
  const sourceArticle = dragTarget.locator("xpath=ancestor::article[1]");
  await expect(sourceArticle).toHaveAttribute("data-dragging", "true");
  /* The card never moves in the DOM (still the same hand-band article, same
     roving-focus order) and stays dimmed; hover/focus zoom transform (T12,
     unrelated to this ticket) can still legitimately resize its rendered
     box while the pointer capture keeps it focused mid-drag, so this only
     asserts the identity and dimming, not the exact rendered rect. */
  const sourceOpacity = await sourceArticle.evaluate(
    (element) => getComputedStyle(element).opacity,
  );
  expect(Number(sourceOpacity)).toBeCloseTo(0.72, 1);
  const ghostBoxMidDrag = await ghost.boundingBox();
  expect(ghostBoxMidDrag).not.toBeNull();
  if (ghostBoxMidDrag !== null) {
    const ghostCentreX = ghostBoxMidDrag.x + ghostBoxMidDrag.width / 2;
    const ghostCentreY = ghostBoxMidDrag.y + ghostBoxMidDrag.height / 2;
    const midX = from.x + ((to.x - from.x) * 2) / 3;
    const midY = from.y + ((to.y - from.y) * 2) / 3;
    /* Ghost centre tracks the cursor within the grab-offset tolerance —
       it is not pinned exactly to the pointer, which grabbed some point
       inside the card, not necessarily its centre. */
    expect(Math.abs(ghostCentreX - midX)).toBeLessThanOrEqual(
      cardBox.width / 2 + 8,
    );
    expect(Math.abs(ghostCentreY - midY)).toBeLessThanOrEqual(
      cardBox.height / 2 + 8,
    );
    const underGhost = await page.evaluate(
      ([x, y]) => {
        const element = document.elementFromPoint(x, y);
        return element === null
          ? null
          : {
              isGhost: element.closest('[data-cy="drag-ghost"]') !== null,
              hasZoneAncestor: element.closest("[data-zone-id]") !== null,
            };
      },
      [ghostCentreX, ghostCentreY] as const,
    );
    expect(underGhost?.isGhost).toBe(false);
  }

  await page.mouse.move(to.x, to.y, { steps: 4 });
  await page.mouse.up();

  /* Item 6: the same card usually offers both a summon and a set, so the drop
     is ambiguous and the gesture ends in a question rather than a play. The
     confirmation is part of the gesture: answer it with the very action the
     walker picked and every assertion below is unchanged. A card with only one
     legal action for this zone still plays in one gesture and never shows it,
     which is why the wait accepts either outcome. */
  const landedCard = field.locator(
    `.duel-field-card[data-card-zone-id="${targetZoneId}"]`,
  );
  const dropConfirm = field.locator('[data-cy="drop-confirm-dialog"]');
  await expect(dropConfirm.or(landedCard).first()).toBeVisible({
    timeout: 30_000,
  });
  if ((await dropConfirm.count()) > 0) {
    const confirmAction = field.locator(
      `[data-cy^="drop-confirm-action-"][data-cy$="-${placement.action}"]`,
    );
    await expect(confirmAction).toHaveCount(1);
    await expect(
      field.locator('[data-cy="drop-confirm-cancel"]'),
    ).toBeVisible();
    await confirmAction.click();
    await expect(dropConfirm).toHaveCount(0);
  }

  await expect(landedCard).toHaveCount(1, { timeout: 30_000 });
  const landedGeometry = await landedCard.evaluate((element) => {
    if (!(element instanceof HTMLElement))
      throw new Error("Landed card is not an HTML element");
    const rect = element.getBoundingClientRect();
    const width = Number.parseFloat(
      element.style.getPropertyValue("--field-width"),
    );
    const height = Number.parseFloat(
      element.style.getPropertyValue("--field-height"),
    );
    return {
      aspect: width / height,
      foreshortening:
        rect.height / element.offsetHeight / (rect.width / element.offsetWidth),
    };
  });
  expect(landedGeometry.aspect).toBeCloseTo(72 / 104, 5);
  expect(landedGeometry.foreshortening).toBeLessThan(0.98);
  await expect(targetZone).not.toHaveAttribute("data-drop-candidate", "true");
  await expect(ghost).toHaveCount(0, { timeout: 650 });

  // One gesture, two responses up front: the chosen action, then the engine's
  // own place prompt answered from the armed zone. Trivial follow-on prompts
  // (e.g. a chain nothing can answer but Pass) may auto-resolve afterward, so
  // only the first two new responses are asserted in order; neither prompt
  // may be answered twice.
  const capture = await readCapture(page);
  const responds = capture.commands.filter(
    (command) => command.type === "respond",
  );
  const newResponds = responds.slice(responsesBefore);
  expect(newResponds.length).toBeGreaterThanOrEqual(2);
  const placeResponse = newResponds[1];
  expect(newResponds[0]?.promptId).toBe(idlePromptId);
  expect(placeResponse?.promptId).not.toBe(idlePromptId);
  const respondsByPrompt = new Map<unknown, number>();
  for (const command of responds)
    respondsByPrompt.set(
      command.promptId,
      (respondsByPrompt.get(command.promptId) ?? 0) + 1,
    );
  expect([...respondsByPrompt.values()].filter((count) => count > 1)).toEqual(
    [],
  );
  const placePrompt = capture.events.find(
    (event) =>
      event.type === "prompt" &&
      (event.prompt as { readonly id?: string } | undefined)?.id ===
        placeResponse?.promptId,
  ) as unknown as CapturedPromptEvent | undefined;
  expect(placePrompt?.prompt.kind).toBe("selectPlace");
});

type PortraitPlacement = {
  readonly action: "summon" | "setMonster";
  readonly cardId: string;
  readonly dragTarget: Locator;
};

async function portraitPlacementInHand(
  page: Page,
  field: Locator,
): Promise<PortraitPlacement | null> {
  for (const action of ["summon", "setMonster"] as const) {
    const chips = field.locator(
      `.duel-field-card[data-card-zone-id="p0:hand"] [data-cy^="card-action-chip-"][data-cy$="-${action}"]`,
    );
    for (let index = 0; index < (await chips.count()); index += 1) {
      const cardId = await chips
        .nth(index)
        .evaluate(
          (element) =>
            element.closest<HTMLElement>(".duel-field-card")?.dataset.cardId ??
            "",
        );
      const dragTarget = field.locator(
        `[data-cy="field-card-target-${cardId}"]`,
      );
      await dragTarget.evaluate((element) =>
        element.scrollIntoView({ block: "nearest", inline: "center" }),
      );
      const box = await dragTarget.boundingBox();
      const viewport = page.viewportSize();
      if (
        cardId !== "" &&
        box !== null &&
        viewport !== null &&
        box.x + box.width > 0 &&
        box.y + box.height > 0 &&
        box.x < viewport.width &&
        box.y < viewport.height
      )
        return { action, cardId, dragTarget };
    }
  }
  return null;
}

/* Production shuffles are real. Walk live prompts until the hand offers a
   monster placement; if an entire bounded walk cannot acquire one, reuse the
   established surrender/restart path for a fresh duel. Never skip evidence. */
async function acquirePortraitPlacement(
  page: Page,
  field: Locator,
): Promise<PortraitPlacement> {
  const setup = { needsDefense: false };
  for (let attempt = 0; attempt < 2; attempt += 1) {
    for (let step = 0; step < 40; step += 1) {
      const result = page.locator(".result-panel");
      if (await result.isVisible()) break;
      const controls = await activePromptControls(page);
      await controls.waitFor({ state: "visible", timeout: 30_000 });
      const kind = await controls.getAttribute("data-prompt-kind");
      if (kind === null) throw new Error("Prompt kind is missing");
      if (kind === "idleCommand") {
        const placement = await portraitPlacementInHand(page, field);
        if (placement !== null) return placement;
      }
      const promptId = await readLatestPromptId(page);
      if (promptId === undefined) throw new Error("Captured prompt is missing");
      await answerPromptWithKeyboard(page, controls, kind, setup);
      await expect
        .poll(async () => {
          if (await result.isVisible()) return true;
          const latest = await readLatestPromptId(page);
          return latest !== undefined && latest !== promptId;
        })
        .toBe(true);
    }
    if (attempt === 1) break;
    if (await page.locator(".result-panel").isVisible()) {
      await page.getByRole("button", { name: "Start another duel" }).click();
      await expect(page.locator("[data-prompt-kind]")).toBeVisible({
        timeout: 120_000,
      });
    } else {
      await runRestartCycle(page);
    }
  }
  throw new Error(
    "No portrait monster placement after prompt walk and restart",
  );
}

test("portrait rotated-stage drag lands on pointed monster zone", async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openDuel(page);
  await startPresetDuel(page);
  await expect(
    page.locator('[data-cy="duel-field"][data-prompt-kind="idleCommand"]'),
  ).toBeVisible({ timeout: 120_000 });
  await disableAutoResolveTrivialPrompts(page);
  await disableAutoPlaceCards(page);

  const field = page.getByRole("region", { name: "Duel field" });
  const frame = page.locator('[data-cy="shell-region-duel"]');
  await expect(frame).toHaveCSS("transform", /matrix\(0, 1, -1, 0,/);
  const { action, cardId, dragTarget } = await acquirePortraitPlacement(
    page,
    field,
  );
  const targetZoneId = await field.evaluate((element) => {
    for (let sequence = 0; sequence < 5; sequence += 1) {
      const zoneId = `p0:mainMonster:${sequence}`;
      if (
        element.querySelector(
          `.duel-field-card[data-card-zone-id="${zoneId}"]`,
        ) === null
      )
        return zoneId;
    }
    return null;
  });
  if (targetZoneId === null) throw new Error("No empty portrait monster zone");
  const monsterZone = field.locator(`[data-zone-id="${targetZoneId}"]`);
  await expect(monsterZone).toBeVisible();
  await expect(dragTarget).toBeVisible();
  await expect(
    monsterZone.evaluate(
      (element) =>
        element.closest('[data-cy="duel-field-board-plane"]') !== null,
    ),
  ).resolves.toBe(true);
  const planeTransform = await page
    .locator('[data-cy="duel-field-board-plane"]')
    .evaluate((element) => (element as HTMLElement).style.transform);
  expect(planeTransform).toMatch(/perspective\(600px\) rotateX\(20deg\)/);

  const cardBox = await dragTarget.boundingBox();
  const zoneBox = await monsterZone.boundingBox();
  if (cardBox === null || zoneBox === null)
    throw new Error("Missing portrait drag geometry");
  const portraitGeometry = {
    fieldSlotWidth: await page
      .locator('[data-cy="duel-field-slot"]')
      .evaluate((element) => element.clientWidth),
    zoneLocalWidth: await monsterZone.evaluate((element) =>
      Number.parseFloat(
        (element as HTMLElement).style.getPropertyValue("--field-width"),
      ),
    ),
    zoneHitWidth: zoneBox.width,
    zoneHitHeight: zoneBox.height,
    cardLocalWidth: await dragTarget.evaluate(
      (element) => (element as HTMLElement).offsetWidth,
    ),
    cardLocalHeight: await dragTarget.evaluate(
      (element) => (element as HTMLElement).offsetHeight,
    ),
    cardHitWidth: cardBox.width,
    cardHitHeight: cardBox.height,
  };
  expect(portraitGeometry.fieldSlotWidth).toBeGreaterThanOrEqual(360);
  expect(portraitGeometry.zoneLocalWidth).toBeGreaterThanOrEqual(44);
  expect(portraitGeometry.zoneHitHeight).toBeGreaterThanOrEqual(44);
  expect(portraitGeometry.cardLocalWidth).toBeGreaterThanOrEqual(44);
  expect(portraitGeometry.cardLocalHeight).toBeGreaterThanOrEqual(44);
  expect(portraitGeometry.cardHitWidth).toBeGreaterThanOrEqual(40);
  expect(portraitGeometry.cardHitHeight).toBeGreaterThanOrEqual(40);
  const geometryPath = testInfo.outputPath("t6-portrait-geometry.json");
  await writeFile(geometryPath, JSON.stringify(portraitGeometry, null, 2));
  await testInfo.attach("t6-portrait-geometry", {
    path: geometryPath,
    contentType: "application/json",
  });

  const cardCentre = {
    x: cardBox.x + cardBox.width / 2,
    y: cardBox.y + cardBox.height / 2,
  };
  const from = {
    x: Math.min(Math.max(cardCentre.x, 1), 389),
    y: Math.min(Math.max(cardCentre.y, 1), 843),
  };
  const to = {
    x: zoneBox.x + zoneBox.width / 2,
    y: zoneBox.y + zoneBox.height / 2,
  };
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 8 });
  await expect(monsterZone).toHaveAttribute("data-drop-candidate", "true");
  const releaseHit = await page.evaluate(
    ([x, y]) =>
      document
        .elementFromPoint(x, y)
        ?.closest<HTMLElement>("[data-zone-id]")
        ?.getAttribute("data-zone-id") ?? null,
    [to.x, to.y] as const,
  );
  expect(releaseHit).toBe(targetZoneId);
  await page.mouse.up();

  const dropConfirm = field.locator('[data-cy="drop-confirm-dialog"]');
  const landedCard = field.locator(
    `.duel-field-card[data-card-zone-id="${targetZoneId}"]`,
  );
  await expect(dropConfirm.or(landedCard).first()).toBeVisible({
    timeout: 30_000,
  });
  if ((await dropConfirm.count()) > 0) {
    const confirmAction = dropConfirm.locator(
      `[data-cy^="drop-confirm-action-"][data-cy$="-${action}"]`,
    );
    await expect(confirmAction).toHaveCount(1);
    await confirmAction.click();
    await expect(dropConfirm).toHaveCount(0);
  }
  await expect(landedCard).toHaveCount(1, { timeout: 30_000 });
  await expect(
    field.locator(`[data-cy="field-hand-band-p0"] [data-card-id="${cardId}"]`),
  ).toHaveCount(0);
  await expect(monsterZone).not.toHaveAttribute("data-drop-candidate", "true");
});

/* Item 4: the drag-to-activate target, and the cancel it asks for by name.
   Cancel-only on purpose — nothing is dispatched, so whatever the seed dealt,
   the duel state this test leaves behind is the one it found. */
test("dragging an activatable hand card into the dashed zone asks and can cancel", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1400 });
  await openDuel(page);
  await startPresetDuel(page);
  await expect(
    page.locator('[data-cy="duel-field"][data-prompt-kind="idleCommand"]'),
  ).toBeVisible({ timeout: 120_000 });
  await page.evaluate(() => window.scrollTo(0, 0));
  const field = page.getByRole("region", { name: "Duel field" });
  const activationZone = page.locator('[data-cy="hand-activation-drop-zone"]');

  const respondsBefore = (await readCapture(page)).commands.filter(
    (command) => command.type === "respond",
  ).length;

  /* The chips no longer advertise an activation, so the only way to find a
     card that offers one is to lift each in turn and look for the zone. A
     release over dead ground abandons the gesture without dispatching. */
  const handTargets = field.locator(
    '.duel-field-card.is-actionable[data-card-zone-id="p0:hand"] [data-cy^="field-card-target-"]',
  );
  let dragging = false;
  for (let index = 0; index < (await handTargets.count()); index += 1) {
    const target = handTargets.nth(index);
    await target.scrollIntoViewIfNeeded();
    const box = await target.boundingBox();
    if (box === null) continue;
    const centre = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
    await page.mouse.move(centre.x, centre.y);
    await page.mouse.down();
    await page.mouse.move(centre.x + 24, centre.y - 24, { steps: 3 });
    if ((await activationZone.count()) > 0) {
      dragging = true;
      break;
    }
    await page.mouse.move(8, 8);
    await page.mouse.up();
  }
  if (!dragging) {
    test.skip(true, "opening hand offers no activatable effect");
    return;
  }

  const zoneBox = await activationZone.boundingBox();
  if (zoneBox === null) throw new Error("Missing activation zone geometry");
  await page.mouse.move(
    zoneBox.x + zoneBox.width / 2,
    zoneBox.y + zoneBox.height / 2,
    { steps: 4 },
  );
  await page.mouse.up();

  const dropConfirm = page.locator('[data-cy="drop-confirm-dialog"]');
  await expect(dropConfirm).toBeVisible();
  await expect(
    page.locator('[data-cy^="drop-confirm-action-"]').first(),
  ).toBeVisible();
  await page.locator('[data-cy="drop-confirm-cancel"]').click();
  await expect(dropConfirm).toHaveCount(0);
  await expect(activationZone).toHaveCount(0);

  // "Cancel and go back": not one response left the page for the whole gesture.
  expect(
    (await readCapture(page)).commands.filter(
      (command) => command.type === "respond",
    ).length,
  ).toBe(respondsBefore);
});

test("item 18: the hovered drop candidate gets its own emphasis, distinct from unhovered candidates, and clears on release", async ({
  page,
}) => {
  const placement = await locateDraggablePlacement(page);
  if (placement === null) {
    await assertHandCouldOfferAPlacement(page);
    test.skip(
      true,
      "opening hand offers no summon, no monster set and no settable spell or trap — there is no placement of any kind to drag",
    );
    return;
  }
  const { field, targetZone, targetZoneId, from, to } = placement;

  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(
    from.x + ((to.x - from.x) * 2) / 3,
    from.y + ((to.y - from.y) * 2) / 3,
    { steps: 4 },
  );
  await page.mouse.move(to.x, to.y, { steps: 4 });
  await expect(targetZone).toHaveAttribute("data-drop-candidate", "true");
  await expect(targetZone).toHaveAttribute("data-drop-hovered", "true");

  // Any other legal candidate zone stays a plain (unhovered) candidate while
  // the pointer sits over `targetZone` — proving the emphasis follows the
  // specific hovered zone, not every candidate the walker could have found.
  const otherCandidates = field.locator(
    `[data-drop-candidate="true"]:not([data-zone-id="${targetZoneId}"])`,
  );
  const otherCount = await otherCandidates.count();
  for (let index = 0; index < otherCount; index += 1) {
    await expect(otherCandidates.nth(index)).not.toHaveAttribute(
      "data-drop-hovered",
      "true",
    );
  }

  // Moving off every candidate clears the hovered emphasis.
  await page.mouse.move(0, 0, { steps: 4 });
  await expect(targetZone).not.toHaveAttribute("data-drop-hovered", "true");

  // Releasing over the zone still completes the drop and clears the
  // candidate/hover attributes with it (endCardDrag resets both).
  await page.mouse.move(to.x, to.y, { steps: 4 });
  await page.mouse.up();
  await expect(targetZone).not.toHaveAttribute("data-drop-candidate", "true");
  await expect(targetZone).not.toHaveAttribute("data-drop-hovered", "true");
});

test("reduced motion drags follow the pointer with no tilt and settle with no lingering ghost", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  const placement = await locateDraggablePlacement(page);
  if (placement === null) {
    await assertHandCouldOfferAPlacement(page);
    test.skip(
      true,
      "opening hand offers no summon, no monster set and no settable spell or trap — there is no placement of any kind to drag",
    );
    return;
  }
  const { from, to } = placement;

  const ghost = page.locator('[data-cy="drag-ghost"]');

  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(
    from.x + (to.x - from.x) / 3,
    from.y + (to.y - from.y) / 3,
    { steps: 4 },
  );
  await expect(ghost).toBeVisible();
  const style = await ghost.getAttribute("style");
  expect(style).toContain("--drag-ghost-rotate: 0deg");

  await page.mouse.up();

  // Reduced motion removes the ghost immediately on release — no spring, so
  // no lingering ghost even a single animation frame later.
  await expect(ghost).toHaveCount(0, { timeout: 100 });
});

test("hovering a hand card fills the preview panel sharing the shell row", async ({
  page,
}) => {
  // 1366 is above the 79rem (1264px) stacking breakpoint, so the panel is
  // beside the field here; below it the panel drops under the board instead.
  await page.setViewportSize({ width: 1366, height: 768 });
  await openDuel(page);
  await startPresetDuel(page);
  await expect(page.locator("[data-prompt-kind]")).toBeVisible({
    timeout: 120_000,
  });

  const field = page.locator('[data-cy="duel-field"]');
  const panel = page.locator('[data-cy="card-preview-panel"]');
  await expect(panel).toBeVisible();
  await assertSharesShellColumns(page, "preview before hover");

  const handCard = page
    .locator(
      '[data-cy="duel-field"] .duel-field-card[data-card-zone-id="p0:hand"]',
    )
    .first();
  await expect(handCard).toBeVisible();
  // `force` skips the actionability re-check: the hover mounts the zoom overlay
  // over the very card it was opened from (T7), so the re-check can never find
  // that card unobstructed again.
  await handCard.hover({ force: true });

  const hoveredName = ((await handCard.getAttribute("aria-label")) ?? "")
    .replace(/ in Your Hand$/, "")
    .trim();
  expect(hoveredName).not.toBe("");
  await expect(panel.locator('[data-cy="card-preview-name"]')).toHaveText(
    hoveredName,
  );
  await expect(panel.locator('[data-cy="card-preview-image"]')).toHaveAttribute(
    "alt",
    hoveredName,
  );
  await assertSharesShellColumns(page, "populated preview");

  // Preview has no actions. Effect text remains keyboard-scrollable.
  expect(await panel.locator("button, a").count()).toBe(0);
  await expect(panel.locator('[data-cy="card-preview-text"]')).toHaveAttribute(
    "tabindex",
    "0",
  );
  expect(await field.count()).toBe(1);
});

test("a passive opponent hand card receives a real hover", async ({ page }) => {
  await page.setViewportSize({ width: 1366, height: 768 });
  await openDuel(page);
  await startPresetDuel(page);
  await expect(page.locator("[data-prompt-kind]")).toBeVisible({
    timeout: 120_000,
  });

  const card = page
    .locator(
      '.duel-field-card[data-card-zone-id="p1:hand"]:not(.is-actionable)',
    )
    .first();
  const previewName = page.locator('[data-cy="card-preview-name"]');
  const previousName =
    (await previewName.count()) === 0 ? null : await previewName.textContent();
  await expect(card).toBeVisible();
  await expect(card).toHaveCSS("pointer-events", "auto");
  await card.hover();

  // The pointer really lands on the card rather than being swallowed by the
  // band around it — which is the whole claim of this test.
  expect(await card.evaluate((element) => element.matches(":hover"))).toBe(
    true,
  );

  // T11: a card with no identity never overwrites the last known preview with
  // a "Face-down card" placeholder. Perspective can place the hand under the
  // pointer that started the duel, so either an empty or populated prior state
  // is valid; identity must remain unchanged.
  if (previousName === null) {
    await expect(previewName).toHaveCount(0);
  } else {
    await expect(previewName).toHaveText(previousName);
  }
});

test("opponent hand fan mirrors player while zoom halo and action chip hover preserve semantics", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1366, height: 768 });
  await openDuel(page);
  await startPresetDuel(page);
  await expect(page.locator("[data-prompt-kind]")).toBeVisible({
    timeout: 120_000,
  });

  const field = page.locator('[data-cy="duel-field"]');
  const playerHand = field.locator(
    '.duel-field-card[data-card-zone-id="p0:hand"]',
  );
  const opponentHand = field.locator(
    '.duel-field-card[data-card-zone-id="p1:hand"]',
  );
  await expect(playerHand.first()).toBeVisible();
  await expect(opponentHand.first()).toBeVisible();
  const fanAngles = async (cards: Locator): Promise<readonly number[]> =>
    cards.evaluateAll((elements) =>
      elements.map((element) =>
        Number.parseFloat(
          (element as HTMLElement).style.getPropertyValue("--card-fan"),
        ),
      ),
    );
  const playerAngles = await fanAngles(playerHand);
  const opponentAngles = await fanAngles(opponentHand);
  expect(playerAngles.length).toBeGreaterThan(1);
  expect(opponentAngles).toHaveLength(playerAngles.length);
  expect(opponentAngles).toEqual(
    playerAngles.map((angle) => (angle === 0 ? 0 : -angle)),
  );

  const actionTarget = field
    .locator(
      '.duel-field-card[data-card-zone-id="p0:hand"] [aria-label^="Legal action, Open actions"]',
    )
    .first();
  await expect(actionTarget).toBeVisible();
  const cardId = await actionTarget.evaluate(
    (element) =>
      element.closest<HTMLElement>("[data-card-id]")?.dataset.cardId ?? "",
  );
  expect(cardId).not.toBe("");
  const sourceCard = field.locator(`[data-card-id="${cardId}"]`);
  const sourceArt = sourceCard.locator(".duel-field-card__art");

  await actionTarget.hover({ force: true });
  const overlay = field.locator("div.hand-zoom-overlay");
  await expect(overlay).toBeVisible();
  await expect(overlay).toHaveClass(/\bis-legal\b/);
  await expect(overlay).not.toHaveClass(/\bis-selected\b/);
  await expect(overlay).not.toHaveClass(/\bis-selection-candidate\b/);
  const overlayArt = overlay.locator(".hand-zoom-overlay__art");
  const haloStyle = (art: Locator) =>
    art.evaluate((element) => {
      const style = getComputedStyle(element);
      return {
        borderColor: style.borderTopColor,
        borderStyle: style.borderTopStyle,
        boxShadow: style.boxShadow,
      };
    });
  const legalSource = await haloStyle(sourceArt);
  const legalOverlay = await haloStyle(overlayArt);
  expect(legalOverlay.borderStyle).toBe("solid");
  expect(legalOverlay.borderColor).toBe(legalSource.borderColor);
  expect(legalOverlay.boxShadow).toBe(legalSource.boxShadow);

  await actionTarget.dispatchEvent("pointerdown", {
    clientX: 10,
    clientY: 10,
    pointerId: 1,
  });
  await actionTarget.dispatchEvent("pointerup", {
    clientX: 10,
    clientY: 10,
    pointerId: 1,
  });
  await actionTarget.dispatchEvent("click");
  await expect(sourceCard).toHaveClass(/\bis-selected\b/);
  await expect(overlay).toHaveClass(/\bis-selected\b/);
  await expect(overlay).not.toHaveClass(/\bis-legal\b/);
  await expect(overlay).not.toHaveClass(/\bis-selection-candidate\b/);
  const selectedSource = await haloStyle(sourceArt);
  const selectedOverlay = await haloStyle(overlayArt);
  expect(selectedOverlay.borderStyle).toBe("solid");
  expect(selectedOverlay.borderColor).toBe(selectedSource.borderColor);
  expect(selectedOverlay.boxShadow).toBe(selectedSource.boxShadow);

  const chip = overlay.locator("button.card-action-chip").first();
  await expect(chip).toBeVisible();
  await expect(chip).toHaveCSS("border-radius", "0px");
  await expect(chip).toHaveCSS("cursor", "pointer");
  const restBackground = await chip.evaluate(
    (element) => getComputedStyle(element).backgroundColor,
  );
  await chip.hover();
  const hoverStyle = await chip.evaluate((element) => {
    const probe = document.createElement("span");
    probe.style.backgroundColor = "var(--selected-strong)";
    document.body.append(probe);
    const selectedStrong = getComputedStyle(probe).backgroundColor;
    probe.remove();
    return {
      background: getComputedStyle(element).backgroundColor,
      selectedStrong,
    };
  });
  expect(hoverStyle.background).toBe(hoverStyle.selectedStrong);
  expect(hoverStyle.background).not.toBe(restBackground);
});

test("T12: hand hover opens a 1.6x overlay, keyboard focus lifts the card 1.35x in place, chips stay hit-testable, and reduced motion disables the zoom", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1366, height: 768 });
  await openDuel(page);
  await startPresetDuel(page);
  await expect(page.locator("[data-prompt-kind]")).toBeVisible({
    timeout: 120_000,
  });

  const handCard = page
    .locator(
      '[data-cy="duel-field"] .duel-field-card[data-card-zone-id="p0:hand"]',
    )
    .first();
  await expect(handCard).toBeVisible();

  const before = await handCard.evaluate((element) => {
    const root = element.getBoundingClientRect();
    const art = element
      .querySelector(".duel-field-card__art")
      ?.getBoundingClientRect();
    return { width: root.width, height: root.height, artWidth: art?.width };
  });
  // Hand hover no longer scales the card in place: it mounts a fixed overlay
  // that escapes the band (`HandZoomOverlay`, T7 round 4). `force` skips the
  // actionability re-check: the overlay is drawn over the card and, while it
  // no longer takes pointer input there, it still fails that check by sight.
  /* Matched by class, not by a `data-cy` prefix: the overlay's own art and name
     strip carry `hand-zoom-overlay-image-…`/`hand-zoom-overlay-name-…`, so a
     prefix locator counts one overlay three times. */
  const handZoomOverlays = page.locator("div.hand-zoom-overlay");
  await handCard.hover({ force: true });
  await expect(handZoomOverlays).toHaveCount(1);
  /* Measured inside the page rather than through a resolved element handle,
     which any remount would leave detached, reporting a 0x0 box instead of the
     geometry under test. Reading in-page also takes the rect field by field — a `DOMRect` carries
     its geometry on the prototype and serialises out as an empty object. */
  const overlayBox = await page
    .waitForFunction(() => {
      const element = document.querySelector("div.hand-zoom-overlay");
      if (element === null) return null;
      const rect = element.getBoundingClientRect();
      return rect.width > 0 ? { width: rect.width, height: rect.height } : null;
    })
    .then((handle) => handle.jsonValue());
  if (overlayBox === null)
    throw new Error("Missing hand zoom overlay geometry");
  const hoveredCard = await handCard.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    return { width: rect.width, height: rect.height };
  });
  const overlayRatio = overlayBox.width / before.width;
  expect(
    overlayRatio,
    "hand hover overlay renders ~1.6x the card box",
  ).toBeGreaterThan(1.6 * 0.98);
  expect(overlayRatio).toBeLessThan(1.6 * 1.02);
  expect(
    overlayBox.height / before.height,
    "hand hover overlay height scales ~1.6x with the card box",
  ).toBeGreaterThan(1.6 * 0.98);
  expect(
    Math.abs(hoveredCard.width - before.width),
    "hover leaves the hand card itself at rest — the overlay carries the zoom",
  ).toBeLessThanOrEqual(1);

  // Keyboard focus keeps the in-place 1.35x lift, halo/art scaling with it.
  await page.mouse.move(0, 0);
  await expect(handZoomOverlays).toHaveCount(0);
  await handCard.evaluate((element) => {
    (
      element.querySelector<HTMLElement>(".duel-field-card__target") ?? element
    ).focus({ preventScroll: true });
  });
  await page.waitForTimeout(200);
  const after = await handCard.evaluate((element) => {
    const root = element.getBoundingClientRect();
    const art = element
      .querySelector(".duel-field-card__art")
      ?.getBoundingClientRect();
    return { width: root.width, height: root.height, artWidth: art?.width };
  });
  const ratio = after.width / before.width;
  expect(ratio, "hand card root scales ~1.35x on focus").toBeGreaterThan(
    1.35 * 0.98,
  );
  expect(ratio).toBeLessThan(1.35 * 1.02);
  expect(
    after.height / before.height,
    "projected hand card root visibly grows on focus",
  ).toBeGreaterThan(1.3);
  if (before.artWidth !== undefined && after.artWidth !== undefined) {
    expect(
      after.artWidth / before.artWidth,
      "art scales with the root, not independently",
    ).toBeGreaterThan(1.35 * 0.98);
  }
  await page.evaluate(() => {
    if (document.activeElement instanceof HTMLElement)
      document.activeElement.blur();
  });

  // Chips remain hit-testable above every visible card once its parent's
  // z-index is raised on hover/focus (T12 impl step 10).
  const actionTargets = page.locator(
    "[data-field-target][aria-label^='Legal action, Open actions']",
  );
  const actionTargetId = await actionTargets.evaluateAll((elements) => {
    const candidates = elements
      .map((element) => ({
        id: element.getAttribute("data-cy"),
        cardId: element
          .closest<HTMLElement>("[data-card-id]")
          ?.getAttribute("data-card-id"),
        rect: element.getBoundingClientRect(),
      }))
      .filter(
        ({ id, cardId, rect }) =>
          id !== null &&
          cardId !== null &&
          rect.left >= 0 &&
          rect.right <= window.innerWidth &&
          rect.top >= 0 &&
          rect.bottom <= window.innerHeight,
      );
    return candidates[Math.floor(candidates.length / 2)] ?? null;
  });
  const actionTarget = page.locator(
    `[data-cy="${actionTargetId?.id ?? "missing"}"]`,
  );
  if (actionTargetId !== null) {
    await actionTarget.evaluate((element) => {
      element.scrollIntoView({ block: "center", inline: "center" });
    });
    const chips = page.locator(
      `[data-cy="card-action-chips-${actionTargetId.cardId}"]`,
    );
    await actionTarget.focus();
    await expect(chips).toBeVisible();
    const chipButtons = chips.locator("button");
    expect(await chipButtons.count()).toBeGreaterThan(0);
    await chipButtons.first().focus();
    await expect(chipButtons.first()).toBeFocused();
  }

  // Reduced motion: bounds unchanged within 1px, chips still usable. Focus is
  // what the reduced-motion rule now has to disable — hover stopped scaling
  // the card in place at all, so a hover probe here would pass vacuously.
  await page.mouse.move(0, 0);
  await page.emulateMedia({ reducedMotion: "reduce" });
  const restRect = await handCard.evaluate((element) =>
    element.getBoundingClientRect(),
  );
  await handCard.evaluate((element) => {
    (
      element.querySelector<HTMLElement>(".duel-field-card__target") ?? element
    ).focus({ preventScroll: true });
  });
  await page.waitForTimeout(200);
  const focusedReducedRect = await handCard.evaluate((element) =>
    element.getBoundingClientRect(),
  );
  expect(
    Math.abs(focusedReducedRect.width - restRect.width),
    "reduced motion keeps hand card bounds unchanged on focus",
  ).toBeLessThanOrEqual(1);
  expect(
    Math.abs(focusedReducedRect.height - restRect.height),
    "reduced motion keeps hand card bounds unchanged on focus",
  ).toBeLessThanOrEqual(1);
  if (actionTargetId !== null) {
    const chips = page.locator(
      `[data-cy="card-action-chips-${actionTargetId.cardId}"]`,
    );
    /* Focus, not hover: on a hand card hover mounts the overlay, which carries
       its own copy of this card's chips, so a hover probe here would resolve
       two elements instead of proving the chips are still usable. */
    await actionTarget.focus();
    await expect(chips).toBeVisible();
    await actionTarget.evaluate((element: HTMLElement) => element.blur());
  }
  await page.emulateMedia({ reducedMotion: "no-preference" });

  // Zone-list entry hover grows, and paints the ADR-031 halo colour its own
  // state calls for: green when the entry carries choices, red when it is an
  // invalid target, orange only when it is already selected, and nothing at
  // all when it is neutral. Hover is never itself a colour.
  const trayButton = page
    .getByRole("button", { name: /Open Your (Extra Deck|GY|Banished) tray/ })
    .first();
  if ((await trayButton.count()) > 0) {
    await trayButton.scrollIntoViewIfNeeded();
    await trayButton.click();
    const entry = page.locator(".zone-list-entry").first();
    await expect(entry).toBeVisible();
    const entryBefore = await entry.evaluate((element) => {
      const rect = element.getBoundingClientRect();
      const img = element.querySelector("img");
      return {
        width: rect.width,
        borderColor: img === null ? "" : getComputedStyle(img).borderColor,
      };
    });
    await entry.hover();
    await page.waitForTimeout(200);
    const entryAfter = await entry.evaluate((element) => {
      const rect = element.getBoundingClientRect();
      const img = element.querySelector("img");
      /* Tokens are declared as hex; borderColor comes back as rgb(). Resolving
         each token through a real element is what makes the two comparable
         without restating a colour literal the stylesheet owns. */
      const resolveToken = (name: string): string => {
        const probe = document.createElement("span");
        probe.style.color = `var(${name})`;
        document.body.append(probe);
        const resolved = getComputedStyle(probe).color;
        probe.remove();
        return resolved;
      };
      return {
        width: rect.width,
        borderColor: img === null ? "" : getComputedStyle(img).borderColor,
        actionable: element.classList.contains("is-actionable"),
        selected: element.classList.contains("is-selected"),
        unavailable: element.classList.contains("is-unavailable"),
        success: resolveToken("--success"),
        warning: resolveToken("--warning"),
        danger: resolveToken("--danger"),
        neutral: resolveToken("--border"),
      };
    });
    expect(
      entryAfter.width / entryBefore.width,
      "zone-list entry grows on hover",
    ).toBeGreaterThan(1.35 * 0.98);
    const expectedBorder = entryAfter.selected
      ? entryAfter.warning
      : entryAfter.unavailable
        ? entryAfter.danger
        : entryAfter.actionable
          ? entryAfter.success
          : entryAfter.neutral;
    expect(
      entryAfter.borderColor,
      `ADR-031 halo for hovered entry (selected=${entryAfter.selected}, unavailable=${entryAfter.unavailable}, actionable=${entryAfter.actionable})`,
    ).toBe(expectedBorder);
    if (!entryAfter.selected)
      expect(
        entryAfter.borderColor,
        "ADR-031 reserves orange for selection, so a plain hover never paints it",
      ).not.toBe(entryAfter.warning);
  }
});

test("item 5: field cards stay outside the hand band and hand action chips remain clickable", async ({
  page,
}) => {
  // Full board on screen: hand row plus spellTrap row remain measurable in
  // real layout, without substituting design-grid arithmetic.
  await page.setViewportSize({ width: 1440, height: 1400 });
  await openDuel(page);
  await startPresetDuel(page);
  await expect(
    page.locator('[data-cy="duel-field"][data-prompt-kind="idleCommand"]'),
  ).toBeVisible({ timeout: 120_000 });
  await page.evaluate(() => window.scrollTo(0, 0));
  const field = page.getByRole("region", { name: "Duel field" });

  // Count-and-assert guard (R1 pattern): the hand must actually be mounted
  // and actionable before a spell/trap-set miss is allowed to skip this
  // seed, so a broken chip/data-cy scheme cannot silently pass as a skip.
  await assertHandCouldOfferAPlacement(page);

  const placed = await setHandSpellTrapWithKeyboard(page, field);
  test.skip(
    !placed,
    "this seed's opening hand offers no spell/trap set for field/hand separation evidence",
  );

  await expect(
    page.locator('[data-cy="duel-field"][data-prompt-kind="idleCommand"]'),
  ).toBeVisible({ timeout: 30_000 });

  const spellTrapCard = field
    .locator('.duel-field-card[data-card-zone-id^="p0:spellTrap:"]')
    .first();
  await expect(spellTrapCard).toBeVisible();
  const fieldCardBox = await spellTrapCard.boundingBox();
  if (fieldCardBox === null) throw new Error("Missing field card geometry");

  const handBand = field.locator('[data-cy="field-hand-band-p0"]');
  const handBandBox = await handBand.boundingBox();
  if (handBandBox === null) throw new Error("Missing hand band geometry");

  // T3/T4/T7 contract: placed field cards remain outside hand band.
  const overlapsBand =
    fieldCardBox.x < handBandBox.x + handBandBox.width &&
    fieldCardBox.x + fieldCardBox.width > handBandBox.x &&
    fieldCardBox.y < handBandBox.y + handBandBox.height &&
    fieldCardBox.y + fieldCardBox.height > handBandBox.y;
  expect(
    overlapsBand,
    `placed spellTrap card box ${JSON.stringify(fieldCardBox)} must not overlap the hand band box ${JSON.stringify(handBandBox)}`,
  ).toBe(false);

  // Hover actionable hand card → chips win hit test. Click proves pointer
  // action still crosses production response boundary.
  const opener = field
    .getByRole("button", {
      name: /^Legal action, Open actions for .+ in Your Hand$/,
    })
    .first();
  await expect(opener).toBeVisible();
  const cardId = ((await opener.getAttribute("data-cy")) ?? "").replace(
    /^field-card-target-/,
    "",
  );
  /* Revealed with focus rather than with the pointer. T7 routed the *hover*
     reveal into the zoom overlay, which is anchored on the card's bottom edge
     at 1.6x and therefore covers the card it was opened from — so a resting
     pointer has the browser hand the hover back and forth between card and
     overlay, and the overlay's chips mount and unmount every other frame. The
     overlay's own geometry is covered by `e2e-acceptance/hand-zoom.spec.ts`;
     what this test still owns is that the chips win the hit test above every
     card and that firing one crosses the production response boundary. */
  const chips = field.locator(
    `[data-card-id="${cardId}"] [data-cy="card-action-chips-${cardId}"]`,
  );
  await opener.focus();
  await expect(chips).toBeVisible();
  /* 2026-08-27 item 2: one vertical stack rising from the card's bottom edge.
     `column-reverse` is what keeps prompt order in the DOM while drawing the
     first choice nearest that edge, so both halves are asserted here. */
  expect(await chips.evaluate((e) => getComputedStyle(e).flexDirection)).toBe(
    "column-reverse",
  );
  const cardBox = await field
    .locator(`[data-card-id="${cardId}"]`)
    .boundingBox();
  const chipsBox = await chips.boundingBox();
  expect(
    Math.abs(cardBox!.y + cardBox!.height - (chipsBox!.y + chipsBox!.height)),
  ).toBeLessThanOrEqual(2);
  const chipButtons = chips.locator("button");
  const chipCount = await chipButtons.count();
  expect(chipCount).toBeGreaterThan(0);
  for (let index = 0; index < chipCount; index += 1) {
    const chip = chipButtons.nth(index);
    await expect(chip).toBeVisible();
    await expect(chip).toBeEnabled();
    const hitTest = await chip.evaluate((element) => {
      const box = element.getBoundingClientRect();
      const hit = document.elementFromPoint(
        box.left + box.width / 2,
        box.top + box.height / 2,
      );
      return {
        chip: { x: box.x, y: box.y, width: box.width, height: box.height },
        hit: hit?.getAttribute("data-cy") ?? hit?.className ?? null,
        resolvesToChip: hit !== null && element.contains(hit),
      };
    });
    expect(
      hitTest.resolvesToChip,
      `chip ${index} centre must hit itself: ${JSON.stringify(hitTest)}`,
    ).toBe(true);
  }
  const responsesBeforeAction = await countResponses(page);
  /* Fired from the keyboard: a pointer moving onto a chip crosses its own
     card, which opens the zoom overlay on top of the chip it was heading for.
     Both routes run the same `onchoose` handler out to the worker. */
  await chipButtons.first().focus();
  await page.keyboard.press("Enter");
  await expect
    .poll(async () => countResponses(page))
    .toBeGreaterThan(responsesBeforeAction);
});

/* Round 3 item 24 required this button to be measurably smaller than T10's.
   Round 4 item 7 reversed that outright — one row, and bigger — so the
   size-direction comparison and the scoped "before" style that fed it are
   gone. Round 5 trimmed it back towards the rest of the field's chrome, down
   to the 44px pointer floor every field control shares; that floor and the
   one-row rule are what remain guarded here. */
test("End Turn button keeps its label on one row with a 44px screen-space pointer-target floor", async ({
  page,
}) => {
  await openDuel(page);
  await startPresetDuel(page);
  await expect(page.locator("[data-prompt-kind]")).toBeVisible({
    timeout: 120_000,
  });
  const endTurn = page.locator('[data-cy="field-end-turn-button"]');
  await expect(endTurn).toBeVisible();

  /* One client rect per rendered line of the label, so a wrap is observable
     rather than inferred from the box height. */
  const renderedLines = async (): Promise<number> =>
    endTurn.evaluate((element) => {
      const range = document.createRange();
      range.selectNodeContents(element);
      return new Set(
        [...range.getClientRects()].map((rect) => Math.round(rect.top)),
      ).size;
    });

  const box = await endTurn.boundingBox();
  if (box === null) throw new Error("Missing End turn geometry");
  const liveLabel = await endTurn.textContent();
  const liveLines = await renderedLines();

  expect(liveLines, `${liveLabel} must render on one row`).toBe(1);
  expect(
    box.width,
    "width stays at or above the 44px pointer target",
  ).toBeGreaterThanOrEqual(44);
  expect(
    Number.parseFloat(
      await endTurn.evaluate(
        (element) => getComputedStyle(element).minBlockSize,
      ),
    ),
    "unprojected height stays at or above the 44px pointer target",
  ).toBeGreaterThanOrEqual(44);
  expect(
    box.height,
    "screen-space End Turn button remains visible",
  ).toBeGreaterThan(0);

  /* The opening Main Phase 1 only ever offers `End turn`. The longest label
     the engine can hand this control is the Battle Phase's, so it is applied
     directly rather than duelling forward to reach it — the wrap this guards
     is a property of the CSS box, not of how the text arrived. */
  const longestLabel = "End Battle Phase";
  await endTurn.evaluate((element, label) => {
    element.textContent = label;
  }, longestLabel);
  const longestBox = await endTurn.boundingBox();
  if (longestBox === null) throw new Error("Missing End turn longest-label");
  const longestLines = await renderedLines();

  expect(longestLines, `${longestLabel} must render on one row`).toBe(1);
  expect(
    longestBox.height,
    "the longest label does not grow the button past one row",
  ).toBeCloseTo(box.height, 0);

  // Evidence for the ticket report: real rendered rects and line counts.
  console.log(
    `End turn rect: ${JSON.stringify(liveLabel)}=${JSON.stringify(box)} lines=${liveLines}; ${JSON.stringify(longestLabel)}=${JSON.stringify(longestBox)} lines=${longestLines}`,
  );
});

test("enabled phase controls stay unobstructed on mobile", async ({ page }) => {
  const viewports = [
    { id: "portrait", width: 390, height: 844 },
    { id: "landscape", width: 844, height: 390 },
  ] as const;
  await page.setViewportSize(viewports[0]);
  await openDuel(page);
  await startPresetDuel(page);
  await expect(page.locator("[data-prompt-kind]")).toBeVisible({
    timeout: 120_000,
  });
  await page.locator('[data-cy="duel-rotation-dismiss"]').click();
  await expect(page.locator('[data-cy="duel-rotation-notice"]')).toHaveCount(0);

  for (const viewport of viewports) {
    await page.setViewportSize(viewport);
    await page.mouse.move(0, 0);
    await expect
      .poll(async () => {
        const controls = await page
          .locator(
            '[data-cy="phase-bar"] button.phase-chip:not(:disabled), [data-cy="field-end-turn-button"]:not(:disabled)',
          )
          .evaluateAll((elements) =>
            elements.map((element) => {
              const box = element.getBoundingClientRect();
              const hit = document.elementFromPoint(
                box.left + box.width / 2,
                box.top + box.height / 2,
              );
              return {
                width: box.width,
                height: box.height,
                hit: hit === element || (hit !== null && element.contains(hit)),
              };
            }),
          );
        if (controls.length === 0) return -1;
        return controls.filter(
          ({ width, height, hit }) => width < 44 || height < 44 || !hit,
        ).length;
      })
      .toBe(0);
  }
});

test("opponent pile inversion rotates images only", async ({ page }) => {
  await openDuel(page);

  const orientations = await page.evaluate(() => {
    const fixture = document.createElement("div");
    fixture.innerHTML = `
      <div class="duel-field-stack" data-test-stack="player">
        <div class="duel-field-stack__art"><img alt="" /></div>
        <span class="duel-field-stack__name">Deck</span>
        <strong class="duel-field-stack__count">40</strong>
      </div>
      <div class="duel-field-stack is-opponent" data-test-stack="opponent">
        <div class="duel-field-stack__art"><img alt="" /></div>
        <span class="duel-field-stack__name">Deck</span>
        <strong class="duel-field-stack__count">40</strong>
      </div>
      <div class="zone-list-entry" data-test-entry="player">
        <img alt="" />
        <span class="zone-list-entry__position">1</span>
        <div class="card-action-chips"></div>
      </div>
      <div class="zone-list-entry is-opponent" data-test-entry="opponent">
        <img alt="" />
        <span class="zone-list-entry__position">1</span>
        <div class="card-action-chips"></div>
      </div>
    `;
    document.body.append(fixture);

    const orientation = (selector: string): readonly number[] => {
      const element = fixture.querySelector(selector);
      if (element === null) throw new Error(`Missing CSS fixture: ${selector}`);
      const transform = getComputedStyle(element).transform;
      const matrix =
        transform === "none"
          ? new DOMMatrixReadOnly()
          : new DOMMatrixReadOnly(transform);
      return [matrix.a, matrix.b, matrix.c, matrix.d];
    };

    return {
      playerStackRoot: orientation('[data-test-stack="player"]'),
      playerStackArt: orientation(
        '[data-test-stack="player"] .duel-field-stack__art',
      ),
      playerStackImage: orientation('[data-test-stack="player"] img'),
      playerStackName: orientation(
        '[data-test-stack="player"] .duel-field-stack__name',
      ),
      playerStackCount: orientation(
        '[data-test-stack="player"] .duel-field-stack__count',
      ),
      opponentStackRoot: orientation('[data-test-stack="opponent"]'),
      opponentStackArt: orientation(
        '[data-test-stack="opponent"] .duel-field-stack__art',
      ),
      opponentStackImage: orientation('[data-test-stack="opponent"] img'),
      opponentStackName: orientation(
        '[data-test-stack="opponent"] .duel-field-stack__name',
      ),
      opponentStackCount: orientation(
        '[data-test-stack="opponent"] .duel-field-stack__count',
      ),
      playerEntryRoot: orientation('[data-test-entry="player"]'),
      playerEntryImage: orientation('[data-test-entry="player"] > img'),
      playerEntryPosition: orientation(
        '[data-test-entry="player"] .zone-list-entry__position',
      ),
      playerEntryChips: orientation(
        '[data-test-entry="player"] .card-action-chips',
      ),
      opponentEntryRoot: orientation('[data-test-entry="opponent"]'),
      opponentEntryImage: orientation('[data-test-entry="opponent"] > img'),
      opponentEntryPosition: orientation(
        '[data-test-entry="opponent"] .zone-list-entry__position',
      ),
      opponentEntryChips: orientation(
        '[data-test-entry="opponent"] .card-action-chips',
      ),
    };
  });

  const upright = [1, 0, 0, 1];
  const inverted = [-1, 0, 0, -1];
  const expectedOrientations = {
    playerStackRoot: upright,
    playerStackArt: upright,
    playerStackImage: upright,
    playerStackName: upright,
    playerStackCount: upright,
    opponentStackRoot: upright,
    opponentStackArt: upright,
    opponentStackImage: inverted,
    opponentStackName: upright,
    opponentStackCount: upright,
    playerEntryRoot: upright,
    playerEntryImage: upright,
    playerEntryPosition: upright,
    playerEntryChips: upright,
    /* Only the field stack art above stays inverted. List entries read as a
       browsable pile, so T12 round 4 dropped the entry-image rotation and
       opponent cards render the same way up as the player's. */
    opponentEntryRoot: upright,
    opponentEntryImage: upright,
    opponentEntryPosition: upright,
    opponentEntryChips: upright,
  } as const;

  for (const [name, expectedOrientation] of Object.entries(
    expectedOrientations,
  )) {
    const actualOrientation = orientations[name as keyof typeof orientations];
    expect(actualOrientation, name).toHaveLength(expectedOrientation.length);
    for (const [index, component] of expectedOrientation.entries())
      expect(actualOrientation[index], `${name}[${index}]`).toBeCloseTo(
        component,
        6,
      );
  }
});

test("responsive field compositions contain controls across supported viewports", async ({
  page,
}, testInfo) => {
  await openDuel(page);
  await startPresetDuel(page);
  await enableDuelHud(page);
  await expect(page.locator("[data-prompt-kind]")).toBeVisible({
    timeout: 120_000,
  });

  /* Whether any card is actionable is seed-dependent, so the chip block below
     stays guarded — but a run where it never fired proves nothing about chips,
     and used to pass silently. Counted here, asserted after the loop. */
  let chipViewportsExercised = 0;

  for (const viewport of RESPONSIVE_VIEWPORTS) {
    await page.setViewportSize({
      width: viewport.width,
      height: viewport.height,
    });
    await expect
      .poll(async () => {
        const geometry = await page.evaluate(() => {
          const field = document.querySelector<HTMLElement>(
            '[data-cy="duel-field"]',
          );
          const slot = document.querySelector<HTMLElement>(
            '[data-cy="duel-field-slot"]',
          );
          if (field === null || slot === null) return null;
          const fieldBox = field.getBoundingClientRect();
          return {
            availableWidth: slot.clientWidth,
            availableHeight: slot.clientHeight,
            extraMonsterZones:
              document.querySelector(
                '[data-zone-id^="shared:extraMonster"]',
              ) !== null,
            fieldWidth: fieldBox.width,
            fieldHeight: fieldBox.height,
          };
        });
        if (geometry === null) return Number.POSITIVE_INFINITY;
        return Math.max(
          Math.abs(geometry.fieldWidth - geometry.availableWidth),
          Math.abs(geometry.fieldHeight - geometry.availableHeight),
        );
      })
      .toBeLessThan(0.5);
    await page.evaluate(() => window.scrollTo(0, 0));
    await expect(page.locator("[data-prompt-kind]")).toBeVisible();
    const viewportLabel =
      "zoomEquivalent" in viewport
        ? `${viewport.id} ${viewport.zoomEquivalent}`
        : viewport.id;
    await assertNoPageWideHorizontalOverflow(page, viewportLabel);

    const shellLayout = await page.evaluate(() => {
      const rect = (selector: string): DOMRect | null =>
        document.querySelector(selector)?.getBoundingClientRect() ?? null;
      const stage = rect('[data-cy="app-stage"]');
      const shell = rect('[data-cy="duel-shell"]');
      const fieldBox = rect('[data-cy="duel-field"]');
      const panelBox = rect('[data-cy="card-preview-panel"]');
      const phaseBox = rect('[data-cy="phase-bar"]');
      const railBox = rect('[data-cy="duel-right-rail"]');
      return stage === null ||
        shell === null ||
        fieldBox === null ||
        panelBox === null ||
        phaseBox === null ||
        railBox === null
        ? null
        : { stage, shell, fieldBox, panelBox, phaseBox, railBox };
    });
    if (shellLayout === null)
      throw new Error(`${viewportLabel} duel shell is not mounted`);
    expect(shellLayout.panelBox.right).toBeLessThanOrEqual(
      shellLayout.fieldBox.left + 1,
    );
    expect(shellLayout.fieldBox.right).toBeLessThanOrEqual(
      shellLayout.railBox.left + 1,
    );
    expect(shellLayout.phaseBox.right).toBeLessThanOrEqual(
      shellLayout.railBox.left + 1,
    );
    expect(shellLayout.phaseBox.bottom).toBeLessThanOrEqual(
      shellLayout.fieldBox.top + 1,
    );
    expect(
      Math.abs(shellLayout.shell.height - shellLayout.stage.height),
    ).toBeLessThanOrEqual(1);

    const field = page.getByRole("region", { name: "Duel field" });
    await expect(field).toBeVisible();
    const fieldGeometry = await page.evaluate(() => {
      const fieldElement = document.querySelector<HTMLElement>(
        '[data-cy="duel-field"]',
      );
      const slot = document.querySelector<HTMLElement>(
        '[data-cy="duel-field-slot"]',
      );
      const zone = document.querySelector<HTMLElement>("[data-zone-id]");
      if (fieldElement === null || slot === null || zone === null) return null;
      const fieldBox = fieldElement.getBoundingClientRect();
      const zoneBox = zone.getBoundingClientRect();
      const scrollRegion = fieldElement.querySelector<HTMLElement>(
        '[data-cy="duel-field-scroll-region"]',
      );
      if (scrollRegion === null) return null;
      return {
        availableWidth: slot.clientWidth,
        availableHeight: slot.clientHeight,
        extraMonsterZones:
          document.querySelector('[data-zone-id^="shared:extraMonster"]') !==
          null,
        fieldWidth: fieldBox.width,
        fieldHeight: fieldBox.height,
        inlineWidth: fieldElement.style.width,
        inlineHeight: fieldElement.style.height,
        zoneLayoutWidth: Number.parseFloat(
          zone.style.getPropertyValue("--field-width"),
        ),
        zoneLayoutHeight: Number.parseFloat(
          zone.style.getPropertyValue("--field-height"),
        ),
        zoneWidth: zoneBox.width,
        zoneHeight: zoneBox.height,
        overflowX: getComputedStyle(scrollRegion).overflowX,
        overflowY: getComputedStyle(scrollRegion).overflowY,
        scrollWidth: scrollRegion.scrollWidth,
        clientWidth: scrollRegion.clientWidth,
        scrollHeight: scrollRegion.scrollHeight,
        clientHeight: scrollRegion.clientHeight,
      };
    });
    if (fieldGeometry === null)
      throw new Error(`${viewportLabel} explicit field geometry hooks missing`);
    const expectedGeometry = computeFieldGeometry(
      fieldGeometry.extraMonsterZones,
      fieldGeometry.availableWidth,
      perspectiveVirtualHeight(
        fieldGeometry.availableHeight,
        FIELD_TILT_DEG,
        FIELD_CAMERA_PX,
      ),
    );
    expect(fieldGeometry.inlineWidth).toMatch(/px$/);
    expect(fieldGeometry.inlineHeight).toMatch(/px$/);
    expect(fieldGeometry.fieldWidth).toBeCloseTo(
      fieldGeometry.availableWidth,
      0,
    );
    expect(fieldGeometry.fieldHeight).toBeCloseTo(
      fieldGeometry.availableHeight,
      0,
    );
    expect(fieldGeometry.zoneLayoutWidth).toBeCloseTo(expectedGeometry.box, 0);
    expect(fieldGeometry.zoneLayoutHeight).toBeCloseTo(expectedGeometry.box, 0);
    expect(fieldGeometry.zoneWidth).toBeGreaterThan(0);
    expect(fieldGeometry.zoneHeight).toBeGreaterThan(0);
    expect(fieldGeometry.overflowX).toBe("hidden");
    expect(fieldGeometry.overflowY).toBe("hidden");
    expect(fieldGeometry.scrollWidth).toBeLessThanOrEqual(
      fieldGeometry.clientWidth + 1,
    );
    expect(fieldGeometry.scrollHeight).toBeLessThanOrEqual(
      fieldGeometry.clientHeight + 1,
    );

    const board = field.getByRole("group", { name: "Standard duel board" });
    await expect(board).toBeVisible();

    const targets = field.locator("[data-field-target]");
    const boxes = await targets.evaluateAll((elements) =>
      elements.map((element) => {
        const box = element.getBoundingClientRect();
        return { width: box.width, height: box.height };
      }),
    );
    expect(boxes.length).toBeGreaterThan(0);
    expect(
      boxes.every(({ width, height }) => width >= 44 && height >= 44),
    ).toBe(true);

    // Hands keep geometry-derived placement with native overflow plus overlay
    // scrollbar ownership. Paging controls stay deleted.
    for (const player of [0, 1] as const) {
      const geometry = await page.evaluate((currentPlayer: 0 | 1) => {
        const rect = (selector: string): DOMRect | null =>
          document.querySelector(selector)?.getBoundingClientRect() ?? null;
        const layoutValue = (selector: string, property: string): number => {
          const element = document.querySelector<HTMLElement>(selector);
          return element === null
            ? Number.NaN
            : Number.parseFloat(element.style.getPropertyValue(property));
        };
        return {
          field: rect('[data-cy="duel-field"]'),
          spellTrap1: rect(`[data-zone-id="p${currentPlayer}:spellTrap:0"]`),
          spellTrap4: rect(`[data-zone-id="p${currentPlayer}:spellTrap:3"]`),
          spellTrap4X: layoutValue(
            `[data-zone-id="p${currentPlayer}:spellTrap:3"]`,
            "--field-x",
          ),
          spellTrap5: rect(`[data-zone-id="p${currentPlayer}:spellTrap:4"]`),
          spellTrap5X: layoutValue(
            `[data-zone-id="p${currentPlayer}:spellTrap:4"]`,
            "--field-x",
          ),
          monster4: rect(`[data-zone-id="p${currentPlayer}:mainMonster:3"]`),
          monster4X: layoutValue(
            `[data-zone-id="p${currentPlayer}:mainMonster:3"]`,
            "--field-x",
          ),
          hand: rect(`[data-cy="field-hand-band-p${currentPlayer}"]`),
          handLayoutWidth: layoutValue(
            `[data-cy="field-hand-band-p${currentPlayer}"]`,
            "--field-width",
          ),
          deck: rect(`[data-cy="field-stack-p${currentPlayer}:deck"]`),
          deckX: layoutValue(
            `[data-cy="field-stack-p${currentPlayer}:deck"]`,
            "--field-x",
          ),
          gy: rect(`[data-cy="field-stack-p${currentPlayer}:graveyard"]`),
          gyX: layoutValue(
            `[data-cy="field-stack-p${currentPlayer}:graveyard"]`,
            "--field-x",
          ),
          banished: rect(`[data-cy="field-stack-p${currentPlayer}:banished"]`),
          banishedX: layoutValue(
            `[data-cy="field-stack-p${currentPlayer}:banished"]`,
            "--field-x",
          ),
          monster5: rect(`[data-zone-id="p${currentPlayer}:mainMonster:4"]`),
          monster5X: layoutValue(
            `[data-zone-id="p${currentPlayer}:mainMonster:4"]`,
            "--field-x",
          ),
          pagingControls: document.querySelectorAll(
            `[data-cy="field-hand-p${currentPlayer}-previous"], [data-cy="field-hand-p${currentPlayer}-next"]`,
          ).length,
          viewport: (() => {
            const element = document.querySelector<HTMLElement>(
              `[data-cy="field-hand-p${currentPlayer}-viewport"]`,
            );
            const scrollbar = document.querySelector<HTMLElement>(
              `[data-cy="field-hand-p${currentPlayer}-scrollbar"]`,
            );
            return element === null || scrollbar === null
              ? null
              : {
                  scrollWidth: element.scrollWidth,
                  clientWidth: element.clientWidth,
                  scrollbarHidden: scrollbar.hidden,
                };
          })(),
        };
      }, player);
      if (
        geometry.field === null ||
        geometry.spellTrap1 === null ||
        geometry.spellTrap4 === null ||
        geometry.spellTrap5 === null ||
        geometry.monster4 === null ||
        geometry.hand === null ||
        geometry.deck === null ||
        geometry.gy === null ||
        geometry.banished === null ||
        geometry.monster5 === null ||
        geometry.viewport === null
      )
        throw new Error(
          `${viewportLabel} p${player} hand/pile geometry hooks missing`,
        );
      expect(geometry.handLayoutWidth).toBeCloseTo(
        expectedGeometry.width - 2 * expectedGeometry.margin,
        0,
      );
      expect(
        Math.abs(
          (geometry.hand.left + geometry.hand.right) / 2 -
            (geometry.field.left + geometry.field.right) / 2,
        ),
        `${viewportLabel} p${player} hand is centered within the measured field`,
      ).toBeLessThanOrEqual(2);
      // Perspective scales rows by their projected depth, so cross-row screen
      // centres no longer preserve flat x spacing. Pile columns are compacted
      // around their narrower slot width, so compare local --field-x positions
      // against the geometry columns rather than against the central-zone pitch.
      expect(
        geometry.spellTrap4X,
        `${viewportLabel} p${player} S/T4 uses geometry column 4`,
      ).toBeCloseTo(expectedGeometry.columnX[4]!, 5);
      expect(
        geometry.spellTrap5X,
        `${viewportLabel} p${player} S/T5 uses geometry column 5`,
      ).toBeCloseTo(expectedGeometry.columnX[5]!, 5);
      expect(
        geometry.deckX,
        `${viewportLabel} p${player} Deck uses compacted pile column 6`,
      ).toBeCloseTo(expectedGeometry.columnX[6]!, 5);
      expect(
        geometry.monster4X,
        `${viewportLabel} p${player} M4 uses geometry column 4`,
      ).toBeCloseTo(expectedGeometry.columnX[4]!, 5);
      expect(
        geometry.monster5X,
        `${viewportLabel} p${player} M5 uses geometry column 5`,
      ).toBeCloseTo(expectedGeometry.columnX[5]!, 5);
      expect(
        geometry.gyX,
        `${viewportLabel} p${player} GY uses compacted pile column 6`,
      ).toBeCloseTo(expectedGeometry.columnX[6]!, 5);
      expect(
        geometry.banishedX,
        `${viewportLabel} p${player} Banished uses compacted pile column 7`,
      ).toBeCloseTo(expectedGeometry.columnX[7]!, 5);
      expect(geometry.pagingControls).toBe(0);
      expect(
        geometry.viewport.scrollWidth,
        `${viewportLabel} p${player} hand viewport owns full-card overflow`,
      ).toBeGreaterThanOrEqual(geometry.viewport.clientWidth);
      expect(geometry.viewport.scrollbarHidden).toBe(
        geometry.viewport.scrollWidth <= geometry.viewport.clientWidth,
      );
    }

    const entry = field.locator("[data-field-target][tabindex='0']");
    await keyboardFocus(page, entry);
    await entry.evaluate((element) =>
      element.scrollIntoView({ block: "nearest", inline: "nearest" }),
    );
    await assertRectInsideViewport(
      page,
      entry,
      `${viewport.id} focused field target`,
    );
    expect(
      await entry.evaluate((element) => ({
        focusVisible: element.matches(":focus-visible"),
        outline: getComputedStyle(element).outlineStyle,
      })),
    ).toEqual({ focusVisible: true, outline: "solid" });

    /* Opening idleCommand has no required action bar. Its geometry gate now
       lives in the full-duel walker, which reaches a required bar, asserts its
       geometry, then fails if no bar was exercised. */

    // Phase bar stays shell-level while sole End Turn control lives inside
    // Duel Field's screen-space root at every viewport.
    const phaseBar = page.locator('[data-cy="phase-bar"]');
    const endTurnButton = page.locator('[data-cy="field-end-turn-button"]');
    await expect(phaseBar).toBeVisible();
    await expect(endTurnButton).toBeVisible();

    const phaseGeometry = await phaseBar.evaluate((bar) => {
      const opponent = bar.querySelector<HTMLElement>(
        '[data-cy="phase-bar-opponent"]',
      );
      const player = bar.querySelector<HTMLElement>(
        '[data-cy="phase-bar-player"]',
      );
      if (opponent === null || player === null)
        throw new Error("Phase bar halves missing");
      const rect = (element: Element) => {
        const box = element.getBoundingClientRect();
        return {
          top: box.top,
          left: box.left,
          bottom: box.bottom,
          right: box.right,
          width: box.width,
          height: box.height,
        };
      };
      const board = document.querySelector('[data-cy="duel-field"]');
      if (board === null) throw new Error("Duel field missing");
      return {
        bar: rect(bar),
        opponent: rect(opponent),
        player: rect(player),
        board: rect(board),
        opponentOrder: [...opponent.children].map((element) =>
          element.getAttribute("data-cy"),
        ),
        playerOrder: [...player.children].map((element) =>
          element.getAttribute("data-cy"),
        ),
        opponentTags: [...opponent.children].map((element) => element.tagName),
      };
    });
    expect(
      phaseGeometry.bar.bottom,
      `${viewportLabel} phase bar sits above the board`,
    ).toBeLessThanOrEqual(phaseGeometry.board.top + 1);
    expect(
      Math.abs(phaseGeometry.opponent.width - phaseGeometry.player.width),
      `${viewportLabel} phase halves split at the exact middle`,
    ).toBeLessThanOrEqual(1.5);
    expect(
      Math.abs(phaseGeometry.player.right - phaseGeometry.opponent.left),
      `${viewportLabel} phase halves meet at one seam`,
    ).toBeLessThanOrEqual(1.5);
    expect(
      phaseGeometry.player.left,
      `${viewportLabel} your phases occupy the left half`,
    ).toBeLessThan(phaseGeometry.opponent.left);
    expect(
      Math.abs(
        phaseGeometry.player.right -
          (phaseGeometry.board.left + phaseGeometry.board.width / 2),
      ),
      `${viewportLabel} the halves meet over the board's vertical middle`,
    ).toBeLessThanOrEqual(8);
    expect(phaseGeometry.playerOrder).toEqual([
      "phase-bar-you-draw",
      "phase-bar-you-standby",
      "phase-bar-you-main1",
      "phase-bar-you-battle",
      "phase-bar-you-main2",
    ]);
    expect(phaseGeometry.opponentOrder).toEqual([
      "phase-bar-opp-draw",
      "phase-bar-opp-standby",
      "phase-bar-opp-main1",
      "phase-bar-opp-battle",
      "phase-bar-opp-main2",
      "phase-bar-opp-end",
    ]);
    expect(
      phaseGeometry.opponentTags.every((tagName) => tagName === "SPAN"),
      `${viewportLabel} opponent phase chips stay inert`,
    ).toBe(true);

    if (viewport.id === "VP-02") {
      /* T2 acceptance: the board is measurably larger than the four-column
         shell it replaced. 1276.0 x 1064.0 = 1357664 px^2 is the rect the same
         viewport produced at commit 3609b53, before the phase bar left the
         grid and the rail narrowed. */
      const PRE_REWORK_FIELD_AREA = 1_357_664;
      expect(
        phaseGeometry.board.width * phaseGeometry.board.height,
        `${viewportLabel} the board grew against the pre-rework baseline`,
      ).toBeGreaterThan(PRE_REWORK_FIELD_AREA);

      const toggleBox = await page
        .locator('[data-cy="full-control-toggle"]')
        .evaluate((element) => {
          const box = element.getBoundingClientRect();
          return { left: box.left, right: box.right, bottom: box.bottom };
        });
      expect(
        toggleBox.left,
        `${viewportLabel} Full Control sits in the board's bottom-left corner`,
      ).toBeLessThan(phaseGeometry.board.left + phaseGeometry.board.width / 2);
      expect(toggleBox.left).toBeGreaterThanOrEqual(
        phaseGeometry.board.left - 1,
      );
      expect(toggleBox.bottom).toBeGreaterThan(
        phaseGeometry.board.bottom - phaseGeometry.board.height / 2,
      );
      expect(toggleBox.bottom).toBeLessThanOrEqual(
        phaseGeometry.board.bottom + 1,
      );
    }

    /* Opening Main 1 exposes only End Turn. That control now lives in Duel
       Field, so PhaseBar correctly has no enabled button of its own. */
    await expect(
      phaseBar.locator("button.phase-chip:not(:disabled)"),
    ).toHaveCount(0);
    await expect(endTurnButton).toBeEnabled();

    const endTurnRect = await endTurnButton.evaluate((element) => {
      const box = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      return {
        top: box.top,
        left: box.left,
        bottom: box.bottom,
        right: box.right,
        width: box.width,
        minBlockSize: Number.parseFloat(style.minBlockSize),
        parentCy: element.parentElement?.getAttribute("data-cy") ?? null,
        insidePerspectivePlane:
          element.closest('[data-cy="duel-field-board-plane"]') !== null,
        insidePhaseBar: element.closest('[data-cy="phase-bar"]') !== null,
      };
    });
    const targetRects = await field
      .locator("[data-field-target]")
      .evaluateAll((elements) =>
        elements.map((element) => {
          const box = element.getBoundingClientRect();
          return {
            top: box.top,
            left: box.left,
            bottom: box.bottom,
            right: box.right,
          };
        }),
      );
    expect(targetRects.length).toBeGreaterThan(0);
    const buttonOverlapsATarget = targetRects.some(
      (rect) =>
        endTurnRect.left < rect.right &&
        endTurnRect.right > rect.left &&
        endTurnRect.top < rect.bottom &&
        endTurnRect.bottom > rect.top,
    );
    expect(
      buttonOverlapsATarget,
      `${viewportLabel} End Turn field control must not overlap a playable field target`,
    ).toBe(false);
    expect(endTurnRect.parentCy).toBe("duel-field");
    expect(endTurnRect.insidePerspectivePlane).toBe(false);
    expect(endTurnRect.insidePhaseBar).toBe(false);
    expect(
      endTurnRect.left,
      `${viewportLabel} End Turn sits in field right half`,
    ).toBeGreaterThan(phaseGeometry.board.left + phaseGeometry.board.width / 2);
    expect(
      endTurnRect.bottom,
      `${viewportLabel} End Turn sits against field bottom`,
    ).toBeGreaterThan(phaseGeometry.board.bottom - 64);
    expect(endTurnRect.bottom).toBeLessThanOrEqual(
      phaseGeometry.board.bottom + 1,
    );
    expect(
      endTurnRect.width,
      `${viewportLabel} End Turn button keeps the 44px rendered width floor`,
    ).toBeGreaterThanOrEqual(44);
    expect(
      endTurnRect.minBlockSize,
      `${viewportLabel} End Turn button keeps the 44px local height floor`,
    ).toBeGreaterThanOrEqual(44);
    await expect(page.locator('[data-cy="field-phase-strip"]')).toHaveCount(0);

    await captureResponsiveState(page, testInfo, viewport.id, "ST-01");

    const actionTarget = field
      .locator("[data-field-target][aria-label^='Legal action, Open actions']")
      .first();
    if ((await actionTarget.count()) > 0) {
      chipViewportsExercised += 1;
      // scrollIntoViewIfNeeded() only scrolls far enough to make the element
      // visible, parking it flush against a viewport edge. The chips are
      // wider than the card and centred on it, so at narrow viewports that
      // leaves them poking past the edge depending on which card is
      // actionable. Centring the card first is what a user panning to it
      // would actually do, and makes the chip-overflow assertion below
      // deterministic instead of seed-dependent.
      await actionTarget.evaluate((element) => {
        element.scrollIntoView({ block: "center", inline: "center" });
      });
      const cardId = await actionTarget.evaluate(
        (element) =>
          element.closest<HTMLElement>("[data-card-id]")?.dataset.cardId ?? "",
      );
      // The chips element is always mounted for an actionable card and is
      // merely `display: none` until the card is hovered, holds focus, or is
      // the pinned menu target. Every assertion here is therefore about
      // visibility; `toHaveCount` would pass or fail for the wrong reason.
      const chips = field.locator(
        `[data-card-id="${cardId}"] [data-cy="card-action-chips-${cardId}"]`,
      );
      /* T7 split the hover reveal off the card: a hand card's in-band chips
         would be clipped by the band's scroll box, so hovering one mounts the
         zoom overlay and shows the chips above that instead. Focus and pin
         keep the in-place copy either way. */
      const inHand = await actionTarget.evaluate(
        (element) =>
          element
            .closest<HTMLElement>("[data-card-zone-id]")
            ?.dataset.cardZoneId?.endsWith(":hand") ?? false,
      );
      /* The overlay's own copy is scoped: two elements carrying one `data-cy`
         would break the uniqueness half of the element contract while both are
         mounted. */
      const hoverChips = inHand
        ? field.locator(
            `.hand-zoom-overlay [data-cy="hand-zoom-overlay-card-action-chips-${cardId}"]`,
          )
        : chips;

      /* Hover and focus are the plan's headline reveal triggers and the pinned
         path below exercises neither, so assert each on its own. Both the
         pointer and focus are dropped first, or the previous state would carry
         the assertion. */
      await page.mouse.move(0, 0);
      await actionTarget.evaluate((element: HTMLElement) => element.blur());
      await expect(chips).toBeHidden();
      await actionTarget.hover({ force: true });
      await expect(hoverChips).toBeVisible();
      await page.mouse.move(0, 0);
      await expect(hoverChips).toBeHidden();
      await actionTarget.focus();
      await expect(chips).toBeVisible();
      // A card offering exactly one action fires it directly on click (T5)
      // instead of pinning the chip menu, so the pin/Escape round trip below
      // only applies to a card that actually opens a menu.
      const chipChoiceCount = await chips.locator("button").count();
      await actionTarget.evaluate((element: HTMLElement) => element.blur());
      await expect(chips).toBeHidden();

      if (chipChoiceCount > 1) {
        /* Activated from the keyboard rather than with the mouse. On a hand
           card the T7 zoom overlay is anchored at 1.6x on the card's bottom
           edge, so it covers the card it was opened from and competes for the
           click. Both routes run the same handler; what is under test here is
           the pinned state and its Escape round trip, not the input device. */
        await actionTarget.focus();
        await page.keyboard.press("Enter");
        await expect(chips).toBeVisible();
        await assertRectInsideViewport(
          page,
          chips,
          `${viewport.id} card action chips`,
        );
        await captureResponsiveState(page, testInfo, viewport.id, "ST-05");
        await page.keyboard.press("Escape");
        // Escape unpins and hands focus back to the card target. Focus and the
        // lingering pointer each keep the chips shown on their own, so drop both
        // before asserting that the pinned state is really gone.
        const restoredTarget = field.locator(
          `[data-card-id="${cardId}"] [data-field-target]`,
        );
        await expect(restoredTarget).toBeFocused();
        await page.mouse.move(0, 0);
        await restoredTarget.evaluate((element: HTMLElement) => element.blur());
        await expect(chips).toBeHidden();
      }
    }

    const trayButton = page
      .getByRole("button", { name: /Open Your (Extra Deck|GY|Banished) tray/ })
      .first();
    if ((await trayButton.count()) > 0) {
      await trayButton.scrollIntoViewIfNeeded();
      await trayButton.click();
      const tray = page.getByRole("region", {
        name: /Your (Extra Deck|GY|Banished) tray/,
      });
      await expect(tray).toBeVisible();
      await assertRectInsideViewport(page, tray, `${viewport.id} card tray`);
      await captureResponsiveState(page, testInfo, viewport.id, "ST-09");
      await tray.getByRole("button", { name: /^Close / }).click();
      await expect(tray).toHaveCount(0);
    }
  }

  expect(
    chipViewportsExercised,
    `no viewport offered an actionable card, so the chip hover/focus reveal, the chip visibility and viewport-containment assertions, the ST-05 evidence capture and the Escape round trip never ran at any of the ${RESPONSIVE_VIEWPORTS.length} viewports`,
  ).toBeGreaterThan(0);
});

test("DF-16 Chromium pinned parity/perf/resource gate records automated evidence", async ({
  page,
  browser,
}, testInfo) => {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Performance.enable").catch(() => undefined);
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 });
  await page.setViewportSize({ width: 1280, height: 720 });
  await openDuel(page);
  await startPresetDuel(page);
  await enableDuelHud(page);
  await expect(page.locator("[data-prompt-kind]")).toBeVisible({
    timeout: 120_000,
  });
  await expect(page.getByRole("region", { name: "Duel field" })).toBeVisible();
  await page.waitForFunction(
    () =>
      window.__duelCapture.eventPaints.some((entry) => entry.type === "state"),
    undefined,
    { timeout: 30_000 },
  );

  await page.evaluate(() => {
    window.__duelCapture.longTasks.length = 0;
  });
  for (let run = 0; run < 5; run += 1) await measureTwoFrameLatency(page);
  const updatePaintSamples: number[] = [];
  const actionLatencySamples: number[] = [];
  for (let run = 0; run < 30; run += 1) {
    updatePaintSamples.push(await measureTwoFrameLatency(page));
    actionLatencySamples.push(await measureFocusFeedbackLatency(page));
  }

  const normalLongTasks = (await readCapture(page)).longTasks.filter(
    (entry) => entry.duration > 50,
  );
  await runTrayCycle(page, 1);
  await runRestartCycle(page);
  await runTrayCycle(page, 1);
  const resourceBefore = await browserResourceSnapshot(page, cdp);
  await runTrayCycle(page, 3);
  await runRestartCycle(page);
  await runTrayCycle(page, 3);
  const resourceAfter = await browserResourceSnapshot(page, cdp);

  const updatePaint = summarizeSamples(updatePaintSamples);
  const actionLatency = summarizeSamples(actionLatencySamples);
  const objectUrlGrowth =
    resourceAfter.objectUrls.active - resourceBefore.objectUrls.active;
  const obsoleteObjectUrlOverlap = resourceBefore.objectUrls.activeUrls.filter(
    (url) => resourceAfter.objectUrls.activeUrls.includes(url),
  );
  const objectUrlLeak =
    !resourceBefore.objectUrls.activeMatchesMounted ||
    !resourceAfter.objectUrls.activeMatchesMounted ||
    obsoleteObjectUrlOverlap.length > 0;
  const listenerGrowth =
    resourceAfter.listeners.active - resourceBefore.listeners.active;
  const droppedFrames = updatePaintSamples.filter(
    (sample) => sample > 50,
  ).length;
  const removalGate =
    updatePaint.p95 < 50 &&
    actionLatency.p95 < 100 &&
    normalLongTasks.length === 0 &&
    !objectUrlLeak &&
    listenerGrowth <= 0;

  const evidence = {
    acceptance: removalGate ? "pass" : "fail",
    browser: {
      name: browser.browserType().name(),
      version: browser.version(),
    },
    profile: {
      os: "linux-headless",
      viewport: "1280x720",
      deviceScaleFactor: 1,
      cpuThrottlingRate: 4,
      networkThrottleAfterFixtureLoad: "none",
      warmUpRuns: 5,
      measuredRuns: 30,
      percentileMethod: "nearest-rank",
      markBoundaries: {
        updateToPaint:
          "accepted public browser event/two requestAnimationFrame callbacks",
        inputFeedback: "focus request/two requestAnimationFrame callbacks",
      },
    },
    thresholds: {
      updateToPaintP95Ms: 50,
      inputFeedbackP95Ms: 100,
      normalLongTaskMs: 50,
    },
    workloads: {
      normalPrompt: {
        updateToPaintMs: updatePaint,
        inputFeedbackMs: actionLatency,
        longTasks: normalLongTasks,
      },
      pathological: { reducedMotionAndZoomCoveredByChromiumSuite: true },
      sixtyCardTray: {
        trayCycles: 6,
        objectUrlGrowth,
        activeMatchesMountedBefore:
          resourceBefore.objectUrls.activeMatchesMounted,
        activeMatchesMountedAfter:
          resourceAfter.objectUrls.activeMatchesMounted,
        obsoleteObjectUrlOverlap: obsoleteObjectUrlOverlap.length,
      },
      burst: { restartCycles: 1, listenerGrowth, droppedFrames },
    },
    resources: {
      before: publicResourceSnapshot(resourceBefore),
      after: publicResourceSnapshot(resourceAfter),
    },
    privacy: {
      hiddenOpponentHandInWorkerEvents: false,
      restrictedCardArtInMetrics: false,
    },
  };

  await mkdir("test-results", { recursive: true });
  await writeFile(
    "test-results/df-16-results.json",
    JSON.stringify(evidence, null, 2),
  );
  const artifactPath = testInfo.outputPath("df-16-results.json");
  await writeFile(artifactPath, JSON.stringify(evidence, null, 2));
  await testInfo.attach("df-16-results", {
    path: artifactPath,
    contentType: "application/json",
  });

  expect(updatePaint.p95).toBeLessThan(50);
  expect(actionLatency.p95).toBeLessThan(100);
  expect(normalLongTasks).toHaveLength(0);
  expect(objectUrlLeak).toBe(false);
  expect(listenerGrowth).toBeLessThanOrEqual(0);
  expect(removalGate).toBe(true);
});

test("spatial field navigation has one visible 44px keyboard entry without a trap", async ({
  page,
}, testInfo) => {
  await openDuel(page);
  await startPresetDuel(page);
  await expect(page.locator("[data-prompt-kind]")).toBeVisible({
    timeout: 120_000,
  });
  const field = page.getByRole("region", { name: "Duel field" });
  const board = field.getByRole("group", { name: "Standard duel board" });
  const targets = board.locator("[data-field-target]");
  await expect(targets).not.toHaveCount(0);
  await expect(field.locator("[data-field-target][tabindex='0']")).toHaveCount(
    1,
  );
  await expect(field.locator("[role=application], [role=grid]")).toHaveCount(0);

  const entry = field.locator("[data-field-target][tabindex='0']");
  await keyboardFocus(page, entry);
  expect(
    await entry.evaluate((element) => ({
      focusVisible: element.matches(":focus-visible"),
      outline: getComputedStyle(element).outlineStyle,
    })),
  ).toEqual({ focusVisible: true, outline: "solid" });

  const boxes = await targets.evaluateAll((elements) =>
    elements.map((element) => {
      const box = element.getBoundingClientRect();
      return {
        target: (element as HTMLElement).dataset.fieldTarget,
        width: box.width,
        height: box.height,
      };
    }),
  );
  expect(
    boxes.every(({ width, height }) => width >= 44 && height >= 44),
    `undersized field targets: ${JSON.stringify(
      boxes.filter(({ width, height }) => width < 44 || height < 44),
    )}`,
  ).toBe(true);

  expect(
    await entry.evaluate(
      (element) =>
        element
          .closest(".duel-field-card")
          ?.getAttribute("data-card-zone-id") === "p0:hand",
    ),
  ).toBe(true);
  await page.evaluate(() => {
    document.documentElement.style.zoom = "200%";
  });
  await entry.scrollIntoViewIfNeeded();
  expect(
    await entry.evaluate((element) => ({
      focusVisible: element.matches(":focus-visible"),
      outline: getComputedStyle(element).outlineStyle,
    })),
  ).toEqual({ focusVisible: true, outline: "solid" });
  await page.evaluate(() => {
    document.documentElement.style.zoom = "";
  });

  const before = await entry.getAttribute("data-field-target");
  for (const key of ["ArrowRight", "ArrowDown", "ArrowLeft", "ArrowUp"]) {
    await page.keyboard.press(key);
    const active = field.locator(":focus");
    await expect(active).toHaveAttribute("data-field-target", /.+/);
    if ((await active.getAttribute("data-field-target")) !== before) break;
  }
  await page.keyboard.press("Tab");
  await expect(board.locator("[data-field-target]:focus")).toHaveCount(0);
  for (let index = 0; index < 3; index += 1) {
    if ((await board.locator(":focus").count()) === 0) break;
    await page.keyboard.press("Tab");
  }
  await expect(board.locator(":focus")).toHaveCount(0);
  await page.keyboard.press("Shift+Tab");
  await expect(board.locator(":focus")).toHaveCount(1);

  const evidencePath = testInfo.outputPath("df-14-keyboard-field.json");
  await writeFile(
    evidencePath,
    JSON.stringify(
      {
        oneTabStop: true,
        focusVisible: true,
        zoom200FocusVisible: true,
        overlappingHandFocusVisible: true,
        boxes,
      },
      null,
      2,
    ),
  );
  await testInfo.attach("df-14-keyboard-field", {
    path: evidencePath,
    contentType: "application/json",
  });
});

test("a full preset duel can be completed using keyboard controls only with one response per prompt", async ({
  page,
}, testInfo) => {
  // Production duels shuffle for real, so this walk is exactly as long as the
  // duel it is handed: consecutive runs have answered anywhere from 60 to 191
  // prompts. Every one of them kept advancing through prompt ids it had never
  // seen before, so a long run here is a long duel and not a stall. What used
  // to make the long ones time out was this walk costing time quadratic in
  // its own length (see `readLatestPromptId`); now that a step is flat, the
  // walk measures ~145 ms per prompt, and even the 400-prompt ceiling below
  // fits inside this budget several times over.
  test.setTimeout(600_000);
  await openDuel(page);
  await startPresetDuel(page);
  await expect(
    page.locator('[data-cy="duel-field"][data-prompt-kind]'),
  ).toBeVisible({
    timeout: 120_000,
  });
  // This walker answers every prompt itself and asserts exactly one response
  // per prompt id. T4's default-on auto-answer of trivial prompts (chain
  // Pass, single-option, single-position) resolves those from a background
  // `queueMicrotask` and would race this walker's own async round trip for
  // the same prompts, so the walk turns the setting off first — exactly the
  // choice a player who wants full manual control would make. T5's default-on
  // auto-placement is the same class of race for `selectPlace` prompts the
  // walker means to answer by hand, so it is turned off too.
  await disableAutoResolveTrivialPrompts(page);
  await disableAutoPlaceCards(page);
  await expect(
    (await activePromptControls(page)).getByRole("button").first(),
  ).toBeEnabled({ timeout: 30_000 });

  const field = page.getByRole("region", { name: "Duel field" });
  const answeredPromptIds = new Set<string>();
  // Recorded in the evidence below so a future slow run can be read as a long
  // duel or a stalled one without re-instrumenting this walk.
  const walkStartedAt = Date.now();
  // Opponent hand cards render upright, so the only sideways cards in a duel are
  // real defense-position monsters. Ask the walker to produce one so the
  // focus-visibility assertion on rotated card art has something to focus.
  const setup = { needsDefense: true };
  let fieldResponses = 0;
  let confirmWindowGeometryChecks = 0;
  let defenseFocusVisible = false;
  // A real duel has been measured at 191 prompts, so a 200-step ceiling is a
  // cap this walk can hit on a merely long duel and then fail for having
  // stopped early rather than for anything the duel did. The ceiling is only
  // here so a broken build cannot spin forever; a duel that loops is caught
  // by the duplicate-prompt assertion on the first repeat, not by this count.
  for (let step = 0; step < 400; step += 1) {
    const result = page.locator(".result-panel");
    if (await result.isVisible()) break;

    const controls = await activePromptControls(page);
    await controls.waitFor({ state: "visible", timeout: 30_000 });
    const kind = await controls.getAttribute("data-prompt-kind");
    if (kind === null) throw new Error("Prompt kind is missing");
    const promptId = await readLatestPromptId(page);
    if (promptId === undefined) throw new Error("Captured prompt is missing");
    if (!defenseFocusVisible) {
      const defenseTarget = field
        .locator(
          ".duel-field-card[data-orientation='sideways'] [data-field-target], .duel-field-card[data-orientation='sideways'][data-field-target]",
        )
        .first();
      const defenseOnBoard =
        (await defenseTarget.count()) > 0 && (await defenseTarget.isVisible());
      if (defenseOnBoard)
        defenseFocusVisible = await focusSidewaysCardWithKeyboard(page, field);
      // Whether a given Main Phase offers a settable monster depends on the
      // duel's random seed, so one opportunistic attempt is not enough: keep
      // asking every Main Phase until the board actually holds a sideways
      // card, and ask again if that card leaves the board before the walker
      // managed to focus it.
      setup.needsDefense = !defenseFocusVisible && !defenseOnBoard;
    }
    const responseCountBefore = await countResponsesTo(page, promptId);
    const actionBar = field.locator('[data-cy="field-action-bar"]');
    if (confirmWindowGeometryChecks === 0 && (await actionBar.count()) > 0) {
      await assertConfirmWindowGeometry(
        page,
        field,
        `full-duel ${kind} prompt`,
      );
      confirmWindowGeometryChecks += 1;
    }

    if (
      (await answerPromptWithKeyboard(page, controls, kind, setup)) === "field"
    )
      fieldResponses += 1;
    // The field surface reuses `section.duel-field` across prompts and only
    // mutates its `data-prompt-kind` attribute in place (no element swap),
    // and consecutive prompts can share the same kind (e.g. two idleCommand
    // decisions in a row), so neither "element disconnected" nor "kind
    // changed" reliably signals the engine moved past this prompt. The
    // engine's own prompt id is the one thing guaranteed to change (or the
    // duel to complete), so wait on that directly.
    await expect
      .poll(
        async () => {
          if (await result.isVisible()) return true;
          const latest = await readLatestPromptId(page);
          return latest !== undefined && latest !== promptId;
        },
        { timeout: 30_000 },
      )
      .toBe(true);
    await expect
      .poll(async () => await countResponsesTo(page, promptId))
      .toBe(responseCountBefore + 1);
    expect(answeredPromptIds.has(promptId)).toBe(false);
    answeredPromptIds.add(promptId);
  }

  expect(answeredPromptIds.size).toBeGreaterThan(0);
  expect(fieldResponses).toBeGreaterThan(0);
  // Prevent `count() > 0` from silently deleting the geometry gate.
  expect(confirmWindowGeometryChecks).toBeGreaterThan(0);
  expect(defenseFocusVisible).toBe(true);
  // One read for the whole check rather than one per prompt id: the same
  // assertion, without re-shipping the transcript once per answered prompt.
  const finalCommands = (await readCapture(page)).commands;
  for (const promptId of answeredPromptIds) {
    expect(
      finalCommands.filter(
        (command) =>
          command.type === "respond" && command.promptId === promptId,
      ),
    ).toHaveLength(1);
  }

  const result = page.locator(".result-panel");
  await expect(result).toBeVisible({ timeout: 30_000 });
  await expect(result).toContainText(/You won|Opponent won/);
  await expect(result).not.toContainText("surrendered");

  const [download] = await Promise.all([
    page.waitForEvent("download"),
    result.getByRole("button", { name: "Download diagnostics" }).click(),
  ]);
  const downloadPath = await download.path();
  if (downloadPath === null) throw new Error("Diagnostic download has no path");
  const diagnostics = JSON.parse(await readFile(downloadPath, "utf8")) as {
    readonly schemaVersion: number;
    readonly sensitivity: string;
    readonly application: { readonly buildId: string };
    readonly trace: {
      readonly seed: readonly string[];
      readonly entries: readonly unknown[];
    };
  };
  expect(diagnostics).toMatchObject({
    schemaVersion: 2,
    sensitivity: "contains-production-seed",
    application: { buildId: expect.stringMatching(/^0\.1\.0\+/) },
  });
  expect(diagnostics.trace.seed).toHaveLength(4);
  expect(diagnostics.trace.entries.length).toBeGreaterThan(0);

  const evidencePath = testInfo.outputPath("df-14-full-keyboard-duel.json");
  await writeFile(
    evidencePath,
    JSON.stringify(
      {
        completedWithoutPointer: true,
        result: await result.getByRole("heading").textContent(),
        responses: answeredPromptIds.size,
        walkerMs: Date.now() - walkStartedAt,
        fieldResponses,
        confirmWindowGeometryChecks,
        duplicateResponses: 0,
        defenseFocusVisible,
      },
      null,
      2,
    ),
  );
  await testInfo.attach("df-14-full-keyboard-duel", {
    path: evidencePath,
    contentType: "application/json",
  });
});

// Non-field prompts render inside the modal dialog while field-capable
// prompts render on `section.duel-field` itself, and `section.duel-field`
// always carries `data-prompt-kind` as a readiness marker (T5). When a
// non-field prompt is open, both elements carry the attribute at once, so
// callers that need the one actually hosting live controls must prefer the
// dialog when it is present.
async function activePromptControls(page: Page): Promise<Locator> {
  const dialogControls = page.locator(
    '[data-cy="prompt-dialog"] [data-prompt-kind]',
  );
  if ((await dialogControls.count()) > 0) return dialogControls;
  return page.locator('[data-cy="duel-field"][data-prompt-kind]');
}

async function answerPromptWithKeyboard(
  page: Page,
  controls: Locator,
  kind: string,
  setup: { needsDefense: boolean },
): Promise<"field" | "phase" | "prompt"> {
  const field = page.getByRole("region", { name: "Duel field" });
  switch (kind) {
    case "idleCommand":
      if (setup.needsDefense && (await setHandMonsterWithKeyboard(page, field)))
        return "field";
      await activatePreferredPhaseButton(page, [
        "field-end-turn-button",
        "phase-bar-you-battle",
      ]);
      return "phase";
    case "battleCommand":
      await activatePreferredPhaseButton(page, [
        "phase-bar-you-main2",
        "field-end-turn-button",
      ]);
      return "phase";
    case "yesNo":
    case "effectYesNo":
      await activatePreferredButton(page, controls, ["No"]);
      return "prompt";
    case "chain": {
      await expect(page.locator('[data-cy="prompt-dialog"]')).toHaveCount(0);
      const railPrompt = page.locator(
        '[data-cy="duel-right-rail-status-title"]',
      );
      await expect(railPrompt).toBeVisible();
      await expect(railPrompt).toHaveText("Choose a chain response");
      await expect(field).toHaveAttribute("data-prompt-kind", "chain");
      /* The window states what it is asking about when the duel has something
         to say — an open chain link, or an action since the turn started. A
         window that opens on neither says nothing rather than inventing a
         subject, so presence is conditional and emptiness is not. */
      const contextLine = page.locator(
        '[data-cy="field-prompt-context-message"]',
      );
      if ((await contextLine.count()) > 0)
        await expect(contextLine.first()).not.toBeEmpty();
      await answerChainOnField(page, field);
      return "field";
    }
    case "selectUnselectCard":
      if (
        (await hasEnabledButton(field, "Finish")) ||
        (await hasEnabledButton(field, "Cancel"))
      ) {
        await activatePreferredButton(page, field, ["Finish", "Cancel"]);
        return "field";
      }
      await activatePreferredButton(page, controls, ["Finish", "Cancel"]);
      return "prompt";
    case "sortCard":
    case "sortChain":
      if (
        await field
          .getByRole("button", { name: "Confirm order" })
          .isVisible()
          .catch(() => false)
      ) {
        await keyboardActivate(
          page,
          field.getByRole("button", { name: "Confirm order" }),
        );
        return "field";
      }
      await keyboardActivate(
        page,
        controls.getByRole("button", { name: "Confirm order" }),
      );
      return "prompt";
    case "selectCounter":
      if (
        await field
          .getByRole("button", { name: "Confirm allocation" })
          .isVisible()
          .catch(() => false)
      ) {
        await allocateCounters(page, field);
        return "field";
      }
      await allocateCounters(page, controls);
      return "prompt";
    case "selectCard":
    case "selectTribute":
    case "selectSum":
    case "selectPlace":
    case "selectDisabledField":
      if (await chooseValidFieldSubset(page, field)) return "field";
      await chooseValidCheckboxSubset(page, controls);
      return "prompt";
    case "announceAttribute":
    case "announceRace":
      await chooseValidCheckboxSubset(page, controls);
      return "prompt";
    default:
      await activatePreferredButton(page, controls, []);
      return "prompt";
  }
}

// The engine labels both `setMonster` and `setSpellTrap` "Set <card>", and the
// chips collapse both to the word "Set", so the walker matches the engine
// action id carried by each chip's `data-cy` instead of its text. Matching the
// label is what made this walker non-deterministic: a hand whose first
// actionable card was a spell or trap set a backrow card, which renders
// upright, and the duel then never gained a sideways card at all.
// The suffix match survives the rename away from the old action menu
// untouched: its items ended in `-choice-${choice.id}` and chips are
// `card-action-chip-${choice.id}`, so both still end in `-setMonster`.
const MONSTER_SET_ACTION = "setMonster";
const MONSTER_SET_CHIP = `[data-cy$="-${MONSTER_SET_ACTION}"]`;
// Item 5's regression proof needs a genuine field card in a spellTrap zone,
// so this mirrors MONSTER_SET_ACTION/MONSTER_SET_CHIP for setSpellTrap.
const SPELLTRAP_SET_ACTION = "setSpellTrap";
const SPELLTRAP_SET_CHIP = `[data-cy$="-${SPELLTRAP_SET_ACTION}"]`;

/**
 * Sets one hand monster face-down using only the keyboard, so the board gains a
 * genuine defense-position (sideways) card. Every hand card is inspected, so
 * the result does not depend on the order the duel's random seed dealt the
 * hand. Returns false when no hand card offers a monster set, leaving the
 * prompt unanswered for the caller to end the turn and try again next Main
 * Phase.
 */
async function setHandMonsterWithKeyboard(
  page: Page,
  field: Locator,
): Promise<boolean> {
  const openers = field.getByRole("button", {
    name: /^Legal action, Open actions for .+ in Your Hand$/,
  });
  for (let index = 0; index < (await openers.count()); index += 1) {
    const opener = openers.nth(index);
    if (!(await opener.isEnabled())) continue;
    const cardId = ((await opener.getAttribute("data-cy")) ?? "").replace(
      /^field-card-target-/,
      "",
    );
    const chips = field.locator(`[data-cy="card-action-chips-${cardId}"]`);
    const chipButtonCount = await chips.locator("button").count();
    if (chipButtonCount === 0) continue;
    if ((await chips.locator(MONSTER_SET_CHIP).count()) === 0) continue;
    await keyboardActivate(page, opener);
    // Item 4 retired the old "one chip means one choice" shortcut: a hand card
    // offering `[activate, setMonster]` shows a single chip because the pointer
    // surfaces hide activate, yet Enter still pins the whole menu. So the
    // outcome is read rather than predicted — either the card's one real choice
    // dispatched and the chips went pending with it, or the menu pinned and
    // focus landed inside it, which is what makes the arrow walk below
    // deterministic.
    await expect(async () => {
      const visible = await chips.isVisible();
      const pinned =
        visible &&
        (await chips.evaluate((element) =>
          element.contains(document.activeElement),
        ));
      expect(!visible || pinned).toBe(true);
    }).toPass();
    if (!(await chips.isVisible())) return true;
    const items = chips.locator("button");
    for (let move = 0; move < (await items.count()); move += 1) {
      const focused = chips.locator(":focus");
      if ((await focused.count()) === 0) break;
      const focusedId = (await focused.getAttribute("data-cy")) ?? "";
      if (focusedId.endsWith(`-${MONSTER_SET_ACTION}`)) {
        await page.keyboard.press("Enter");
        // The response goes pending, which drops the card out of its
        // actionable state and unmounts these chips with it. Waiting on that
        // keeps the caller from racing the next prompt.
        await expect(chips).toBeHidden();
        return true;
      }
      await page.keyboard.press("ArrowRight");
    }
    // Escape unpins and returns focus to the card target. The chips stay
    // mounted and stay shown while that target holds focus, so the check is
    // that focus came home, not that anything was removed.
    await page.keyboard.press("Escape");
    await expect(opener).toBeFocused();
  }
  return false;
}

/**
 * Sets one hand spell/trap card face-down using only the keyboard, so the
 * board gains a genuine backrow card in a spellTrap zone (item 5).
 * Mirrors `setHandMonsterWithKeyboard` for the `setSpellTrap` action.
 * Returns false when no hand card offers a spell/trap set.
 */
async function setHandSpellTrapWithKeyboard(
  page: Page,
  field: Locator,
): Promise<boolean> {
  const openers = field.getByRole("button", {
    name: /^Legal action, Open actions for .+ in Your Hand$/,
  });
  for (let index = 0; index < (await openers.count()); index += 1) {
    const opener = openers.nth(index);
    if (!(await opener.isEnabled())) continue;
    const cardId = ((await opener.getAttribute("data-cy")) ?? "").replace(
      /^field-card-target-/,
      "",
    );
    const chips = field.locator(`[data-cy="card-action-chips-${cardId}"]`);
    const chipButtonCount = await chips.locator("button").count();
    if (chipButtonCount === 0) continue;
    if ((await chips.locator(SPELLTRAP_SET_CHIP).count()) === 0) continue;
    await keyboardActivate(page, opener);
    // Item 4 retired the old "one chip means one choice" shortcut here too: a
    // hand spell offering `[activate, setSpellTrap]` shows a single chip
    // because the pointer surfaces hide activate, yet Enter still pins the
    // whole menu. Read the outcome the same way the monster twin above does --
    // either the card's one real choice dispatched and the chips went pending
    // with it, or the menu pinned and focus landed inside it.
    await expect(async () => {
      const visible = await chips.isVisible();
      const pinned =
        visible &&
        (await chips.evaluate((element) =>
          element.contains(document.activeElement),
        ));
      expect(!visible || pinned).toBe(true);
    }).toPass();
    if (!(await chips.isVisible())) return true;
    const items = chips.locator("button");
    for (let move = 0; move < (await items.count()); move += 1) {
      const focused = chips.locator(":focus");
      if ((await focused.count()) === 0) break;
      const focusedId = (await focused.getAttribute("data-cy")) ?? "";
      if (focusedId.endsWith(`-${SPELLTRAP_SET_ACTION}`)) {
        await page.keyboard.press("Enter");
        await expect(chips).toBeHidden();
        return true;
      }
      await page.keyboard.press("ArrowRight");
    }
    await page.keyboard.press("Escape");
    await expect(opener).toBeFocused();
  }
  return false;
}

async function hasEnabledButton(
  scope: Locator,
  label: string,
): Promise<boolean> {
  const candidate = scope.getByRole("button", { name: label, exact: true });
  return (
    (await candidate.count()) > 0 &&
    (await candidate.first().isVisible()) &&
    (await candidate.first().isEnabled())
  );
}

async function answerChainOnField(page: Page, field: Locator): Promise<void> {
  if (await hasEnabledButton(field, "Pass")) {
    await activatePreferredButton(page, field, ["Pass"]);
    return;
  }

  const globalChoice = field
    .locator('[data-cy^="field-action-bar-choice-"]:enabled')
    .first();
  if ((await globalChoice.count()) > 0) {
    await keyboardActivate(page, globalChoice);
    return;
  }

  const cardTarget = field
    .locator("[data-field-target][aria-label^='Legal action']")
    .first();
  if ((await cardTarget.count()) > 0) {
    const cardId = ((await cardTarget.getAttribute("data-cy")) ?? "").replace(
      /^field-card-target-/,
      "",
    );
    const chips = field.locator(`[data-cy="card-action-chips-${cardId}"]`);
    const chipButtons = chips.getByRole("button");
    const choiceCount = await chipButtons.count();
    await keyboardActivate(page, cardTarget);
    if (choiceCount > 1) {
      await expect(chips).toBeVisible();
      await keyboardActivate(page, chipButtons.first());
    }
    return;
  }

  const stack = field
    .locator('[data-cy^="field-stack-"].is-actionable')
    .first();
  if ((await stack.count()) > 0) {
    await keyboardActivate(page, stack);
    const dialog = page.locator('[data-cy="zone-list-dialog"]');
    await expect(dialog).toBeVisible();
    const buttons = dialog.getByRole("button");
    for (let index = 0; index < (await buttons.count()); index += 1) {
      const button = buttons.nth(index);
      const name =
        (await button.getAttribute("aria-label")) ??
        (await button.textContent()) ??
        "";
      if (!/^Close\b/.test(name.trim()) && (await button.isEnabled())) {
        await keyboardActivate(page, button);
        return;
      }
    }
  }

  throw new Error("Inline chain prompt has no enabled field response");
}

/**
 * Every control that can answer the live selection on the field: the mounted
 * targets plus, since T16, the aggregate off-field target window. A hand card
 * that owns an off-field choice is only a launcher for that window — its own
 * activation toggles the list instead of answering — so it is skipped while
 * the list is up, and the list entry answers for it.
 */
async function fieldSelectionControls(
  page: Page,
  field: Locator,
): Promise<readonly Locator[]> {
  const targetChoices = page.locator(
    '[data-cy^="zone-list-entry-target-choice-"]',
  );
  const targetCount = await targetChoices.count();
  const controls: Locator[] = [];
  for (let index = 0; index < targetCount; index += 1)
    controls.push(targetChoices.nth(index));
  const mounted = field.locator("[data-field-target][aria-pressed]");
  const mountedCount = await mounted.count();
  for (let index = 0; index < mountedCount; index += 1) {
    const control = mounted.nth(index);
    if (
      targetCount > 0 &&
      (await control.evaluate(
        (element) =>
          element.closest('[data-cy^="field-hand-band-"]') !== null ||
          element.closest('[data-cy^="field-hand-p"]') !== null,
      ))
    )
      continue;
    controls.push(control);
  }
  return controls;
}

async function chooseValidFieldSubset(
  page: Page,
  field: Locator,
): Promise<boolean> {
  const confirm = field.getByRole("button", {
    name: /^(?:Confirm (?:selection|placement)|Validate selection)$/,
  });
  const choices = await fieldSelectionControls(page, field);
  if ((await confirm.count()) === 0) {
    // A single-place prompt (auto-place off) and an exact one-of-one target
    // both submit the instant any one legal control is activated: no Confirm
    // ever renders for them.
    const first = choices[0];
    if (first === undefined) return false;
    await keyboardActivate(page, first);
    return true;
  }
  if (await confirm.isEnabled()) {
    await keyboardActivate(page, confirm);
    return true;
  }
  const count = choices.length;
  if (count === 0 || count > 12) return false;
  for (let mask = 1; mask < 1 << count; mask += 1) {
    for (let index = 0; index < count; index += 1) {
      const choice = choices[index];
      if (choice === undefined) continue;
      const desired = (mask & (1 << index)) !== 0;
      if (((await choice.getAttribute("aria-pressed")) === "true") !== desired)
        await keyboardActivate(page, choice);
    }
    if (await confirm.isEnabled()) {
      await keyboardActivate(page, confirm);
      return true;
    }
  }
  return false;
}

async function activatePreferredPhaseButton(
  page: Page,
  dataCyValues: readonly string[],
): Promise<void> {
  for (const dataCy of dataCyValues) {
    const candidate = page.locator(`[data-cy="${dataCy}"]`);
    if (
      (await candidate.count()) > 0 &&
      (await candidate.isVisible()) &&
      (await candidate.isEnabled())
    ) {
      await keyboardActivate(page, candidate);
      return;
    }
  }
  throw new Error("Phase bar has no enabled transition");
}

async function activatePreferredButton(
  page: Page,
  controls: Locator,
  labels: readonly string[],
): Promise<void> {
  for (const label of labels) {
    const candidate = controls.getByRole("button", {
      name: label,
      exact: true,
    });
    if ((await candidate.count()) > 0 && (await candidate.isEnabled())) {
      await keyboardActivate(page, candidate);
      return;
    }
  }
  const candidates = controls.getByRole("button");
  for (let index = 0; index < (await candidates.count()); index += 1) {
    const candidate = candidates.nth(index);
    if (await candidate.isEnabled()) {
      await keyboardActivate(page, candidate);
      return;
    }
  }
  throw new Error("Prompt has no enabled button");
}

async function chooseValidCheckboxSubset(
  page: Page,
  controls: Locator,
): Promise<void> {
  const confirm = controls.getByRole("button", { name: "Confirm selection" });
  if (await confirm.isEnabled()) {
    await keyboardActivate(page, confirm);
    return;
  }
  const checkboxes = controls.getByRole("checkbox");
  const count = await checkboxes.count();
  if (count > 12) throw new Error(`Cannot enumerate ${count} prompt choices`);

  for (let mask = 1; mask < 1 << count; mask += 1) {
    for (let index = 0; index < count; index += 1) {
      const checkbox = checkboxes.nth(index);
      const desired = (mask & (1 << index)) !== 0;
      if ((await checkbox.isChecked()) !== desired)
        await keyboardActivate(page, checkbox);
    }
    if (await confirm.isEnabled()) {
      await keyboardActivate(page, confirm);
      return;
    }
  }

  const cancel = controls.getByRole("button", { name: "Cancel", exact: true });
  if ((await cancel.count()) > 0) {
    await keyboardActivate(page, cancel);
    return;
  }
  throw new Error("No valid checkbox selection was found");
}

async function allocateCounters(page: Page, controls: Locator): Promise<void> {
  const confirm = controls.getByRole("button", { name: "Confirm allocation" });
  const addButtons = controls.getByRole("button", {
    name: /Add one counter to/,
  });
  for (
    let attempt = 0;
    attempt < 256 && !(await confirm.isEnabled());
    attempt += 1
  ) {
    let allocated = false;
    for (let index = 0; index < (await addButtons.count()); index += 1) {
      const add = addButtons.nth(index);
      if (await add.isEnabled()) {
        await keyboardActivate(page, add);
        allocated = true;
        break;
      }
    }
    if (!allocated) throw new Error("Counter prompt has no valid allocation");
  }
  await keyboardActivate(page, confirm);
}

async function focusSidewaysCardWithKeyboard(
  page: Page,
  field: Locator,
): Promise<boolean> {
  await keyboardFocus(page, field.locator("[data-field-target][tabindex='0']"));
  if (await sweepRowsUpwardForSidewaysCard(page, field)) return true;
  // The sweep only walks rows upwards, so every row below wherever roving
  // focus happened to sit stayed unvisited - and which row that is depends on
  // the prompt the duel is currently on. Drop to the bottom row and sweep the
  // rest of the board.
  for (let move = 0; move < 16; move += 1) {
    const target = await field
      .locator(":focus")
      .getAttribute("data-field-target");
    await page.keyboard.press("ArrowDown");
    if (
      (await field.locator(":focus").getAttribute("data-field-target")) ===
      target
    )
      break;
  }
  return await sweepRowsUpwardForSidewaysCard(page, field);
}

/**
 * Walks the board upwards row by row from the focused control, asserting the
 * focus ring on the first sideways card it lands on. Returns false when the
 * sweep runs out of board without meeting one.
 */
async function sweepRowsUpwardForSidewaysCard(
  page: Page,
  field: Locator,
): Promise<boolean> {
  for (let row = 0; row < 12; row += 1) {
    await page.keyboard.press("Home");
    for (let column = 0; column < 24; column += 1) {
      const active = field.locator(":focus");
      if (
        await active.evaluate(
          (element) =>
            element
              .closest(".duel-field-card")
              ?.getAttribute("data-orientation") === "sideways",
        )
      ) {
        const focusStyle = await active.evaluate((element) => {
          const card = element.closest<HTMLElement>(".duel-field-card");
          const visual = element.matches(".duel-field-card")
            ? element
            : card?.querySelector<HTMLElement>(".duel-field-card__art");
          return {
            active: card?.classList.contains("is-navigation-active") ?? false,
            outline: visual && getComputedStyle(visual).outlineStyle,
          };
        });
        expect(focusStyle).toEqual({ active: true, outline: "solid" });
        return true;
      }
      const target = await active.getAttribute("data-field-target");
      await page.keyboard.press("ArrowRight");
      if (
        (await field.locator(":focus").getAttribute("data-field-target")) ===
        target
      )
        break;
    }
    await page.keyboard.press("Home");
    const target = await field
      .locator(":focus")
      .getAttribute("data-field-target");
    await page.keyboard.press("ArrowUp");
    if (
      (await field.locator(":focus").getAttribute("data-field-target")) ===
      target
    )
      break;
  }
  return false;
}

async function keyboardActivate(page: Page, target: Locator): Promise<void> {
  await keyboardFocus(page, target);
  const element = await target.elementHandle();
  if (element === null) throw new Error("Keyboard target disappeared");
  const isCheckbox = await element.evaluate(
    (node) => node instanceof HTMLInputElement && node.type === "checkbox",
  );
  await page.keyboard.press(isCheckbox ? "Space" : "Enter");
}

async function keyboardFocus(page: Page, target: Locator): Promise<void> {
  await target.waitFor({ state: "visible" });
  const fieldTarget = await target.getAttribute("data-field-target");
  if (fieldTarget !== null) {
    await keyboardFocusFieldTarget(page, target, fieldTarget);
    return;
  }
  await keyboardTabFocus(page, target);
}

async function keyboardFocusFieldTarget(
  page: Page,
  target: Locator,
  fieldTarget: string,
): Promise<void> {
  const board = target.locator(
    "xpath=ancestor::*[@aria-label='Standard duel board']",
  );
  await keyboardTabFocus(
    page,
    board.locator("[data-field-target][tabindex='0']"),
  );
  for (let move = 0; move < 24; move += 1) {
    const active = board.locator(":focus");
    if ((await active.getAttribute("data-field-target")) === fieldTarget)
      return;
    const before = await active.getAttribute("data-field-target");
    await page.keyboard.press("ArrowDown");
    if (
      (await board.locator(":focus").getAttribute("data-field-target")) ===
      before
    )
      break;
  }
  for (let row = 0; row < 16; row += 1) {
    await page.keyboard.press("Home");
    for (let column = 0; column < 32; column += 1) {
      const active = board.locator(":focus");
      if ((await active.getAttribute("data-field-target")) === fieldTarget)
        return;
      const before = await active.getAttribute("data-field-target");
      await page.keyboard.press("ArrowRight");
      if (
        (await board.locator(":focus").getAttribute("data-field-target")) ===
        before
      )
        break;
    }
    await page.keyboard.press("Home");
    const before = await board
      .locator(":focus")
      .getAttribute("data-field-target");
    await page.keyboard.press("ArrowUp");
    if (
      (await board.locator(":focus").getAttribute("data-field-target")) ===
      before
    )
      break;
  }
  throw new Error(
    `Unable to spatially focus keyboard target: ${await target.getAttribute("aria-label")}`,
  );
}

async function keyboardTabFocus(page: Page, target: Locator): Promise<void> {
  await target.waitFor({ state: "visible" });
  const element = await target.elementHandle();
  if (element === null) throw new Error("Keyboard target disappeared");
  for (let tab = 0; tab < 256; tab += 1) {
    if (await element.evaluate((node) => document.activeElement === node))
      break;
    await page.keyboard.press("Tab");
  }
  if (!(await element.evaluate((node) => document.activeElement === node))) {
    throw new Error(
      `Unable to focus keyboard target: ${await target.getAttribute("aria-label")}`,
    );
  }
}

async function captureResponsiveState(
  page: Page,
  testInfo: TestInfo,
  viewportId: string,
  stateId: "ST-01" | "ST-05" | "ST-09",
): Promise<void> {
  const screenshotPath = testInfo.outputPath(
    `df-15-${viewportId}-${stateId}.png`,
  );
  await page.screenshot({ path: screenshotPath, fullPage: false });
  await testInfo.attach(`df-15-${viewportId}-${stateId}`, {
    path: screenshotPath,
    contentType: "image/png",
  });
}

async function assertSharesShellColumns(
  page: Page,
  label: string,
): Promise<void> {
  const boxes = await page.evaluate(() => {
    const rect = (selector: string): DOMRect | null =>
      document.querySelector(selector)?.getBoundingClientRect() ?? null;
    const shell = rect('[data-cy="duel-shell"]');
    const previewColumn = rect('[data-cy="card-preview-panel"]');
    const fieldColumn = rect('[data-cy="duel-field-column"]');
    const fieldSlot = rect('[data-cy="duel-field-slot"]');
    const field = rect('[data-cy="duel-field"]');
    const phaseBar = rect('[data-cy="phase-bar"]');
    const rail = rect('[data-cy="duel-right-rail"]');
    return shell === null ||
      previewColumn === null ||
      fieldColumn === null ||
      fieldSlot === null ||
      field === null ||
      phaseBar === null ||
      rail === null
      ? null
      : {
          fieldColumn: {
            top: fieldColumn.top,
            bottom: fieldColumn.bottom,
          },
          phaseBar: {
            top: phaseBar.top,
            bottom: phaseBar.bottom,
          },
          shell: {
            top: shell.top,
            bottom: shell.bottom,
          },
          previewColumn: {
            top: previewColumn.top,
            right: previewColumn.right,
            bottom: previewColumn.bottom,
          },
          fieldSlot: {
            left: fieldSlot.left,
            top: fieldSlot.top,
            right: fieldSlot.right,
            bottom: fieldSlot.bottom,
            centerX: fieldSlot.left + fieldSlot.width / 2,
            centerY: fieldSlot.top + fieldSlot.height / 2,
          },
          field: {
            centerX: field.left + field.width / 2,
            centerY: field.top + field.height / 2,
          },
          rail: {
            left: rail.left,
            top: rail.top,
            bottom: rail.bottom,
          },
        };
  });
  if (boxes === null)
    throw new Error(`${label}: missing shell column geometry`);
  /* The board's column, not the board itself, is what spans the shell row now:
     the phase bar takes the top of it and the slot takes the rest. */
  for (const [column, top, bottom] of [
    ["preview", boxes.previewColumn.top, boxes.previewColumn.bottom] as const,
    ["field column", boxes.fieldColumn.top, boxes.fieldColumn.bottom] as const,
    ["rail", boxes.rail.top, boxes.rail.bottom] as const,
  ]) {
    expect(
      Math.abs(top - boxes.shell.top),
      `${label} ${column} shares shell row top`,
    ).toBeLessThanOrEqual(2);
    expect(
      Math.abs(bottom - boxes.shell.bottom),
      `${label} ${column} shares shell row bottom`,
    ).toBeLessThanOrEqual(2);
  }
  expect(
    Math.abs(boxes.phaseBar.top - boxes.shell.top),
    `${label} phase bar takes the top of the field column`,
  ).toBeLessThanOrEqual(2);
  expect(
    Math.abs(boxes.fieldSlot.top - boxes.phaseBar.bottom),
    `${label} field slot starts under the phase bar`,
  ).toBeLessThanOrEqual(2);
  expect(
    Math.abs(boxes.fieldSlot.bottom - boxes.shell.bottom),
    `${label} field slot shares shell row bottom`,
  ).toBeLessThanOrEqual(2);
  expect(
    boxes.previewColumn.right,
    `${label} preview column sits left of field slot`,
  ).toBeLessThanOrEqual(boxes.fieldSlot.left + 1);
  expect(
    boxes.fieldSlot.right,
    `${label} field slot sits left of rail`,
  ).toBeLessThanOrEqual(boxes.rail.left + 1);
  expect(
    Math.abs(boxes.field.centerX - boxes.fieldSlot.centerX),
    `${label} field is horizontally centered in its slot`,
  ).toBeLessThanOrEqual(2);
  expect(
    Math.abs(boxes.field.centerY - boxes.fieldSlot.centerY),
    `${label} field is vertically centered in its slot`,
  ).toBeLessThanOrEqual(2);
}

async function assertNoPageWideHorizontalOverflow(
  page: Page,
  label: string,
): Promise<void> {
  const metrics = await page.evaluate(() => {
    const root = document.documentElement;
    return {
      bodyScrollWidth: document.body.scrollWidth,
      rootScrollWidth: root.scrollWidth,
      viewportWidth: window.innerWidth,
    };
  });
  expect(
    Math.max(metrics.bodyScrollWidth, metrics.rootScrollWidth),
    `${label} page-wide horizontal overflow`,
  ).toBeLessThanOrEqual(metrics.viewportWidth + 1);
}

/* T14/ADR-017: the live decision rides in the confirm window, which is
   clamped inside the visible duel field rather than pinned under the board. */
async function assertConfirmWindowGeometry(
  page: Page,
  field: Locator,
  label: string,
): Promise<void> {
  const confirmWindow = field.locator(
    '[data-cy="floating-field-window-confirm"]',
  );
  await expect(confirmWindow).toBeVisible();
  await expect(
    confirmWindow.locator('[data-cy="field-action-bar"]'),
  ).toBeVisible();
  await assertRectInsideViewport(
    page,
    confirmWindow,
    `${label} confirm window`,
  );
  await assertWindowInsideField(page, "confirm", label);
}

async function assertRectInsideViewport(
  page: Page,
  target: Locator,
  label: string,
): Promise<void> {
  const rect = await target.evaluate((element) => {
    const box = element.getBoundingClientRect();
    return {
      left: box.left,
      top: box.top,
      right: box.right,
      bottom: box.bottom,
      width: box.width,
      height: box.height,
      viewportWidth: window.innerWidth,
      viewportHeight: window.innerHeight,
    };
  });
  expect(rect.width, `${label} width`).toBeGreaterThan(0);
  expect(rect.height, `${label} height`).toBeGreaterThan(0);
  expect(rect.left, `${label} left`).toBeGreaterThanOrEqual(-1);
  expect(rect.top, `${label} top`).toBeGreaterThanOrEqual(-1);
  expect(rect.right, `${label} right`).toBeLessThanOrEqual(
    rect.viewportWidth + 1,
  );
  expect(rect.bottom, `${label} bottom`).toBeLessThanOrEqual(
    rect.viewportHeight + 1,
  );
}

async function measureTwoFrameLatency(page: Page): Promise<number> {
  return page.evaluate(
    () =>
      new Promise<number>((resolve) => {
        const startedAt = performance.now();
        requestAnimationFrame(() => {
          requestAnimationFrame(() => resolve(performance.now() - startedAt));
        });
      }),
  );
}

async function measureFocusFeedbackLatency(page: Page): Promise<number> {
  const field = page.getByRole("region", { name: "Duel field" });
  const target = field.locator("[data-field-target]").first();
  await target.waitFor({ state: "visible" });
  return target.evaluate(
    (element) =>
      new Promise<number>((resolve) => {
        const startedAt = performance.now();
        (element as HTMLElement).focus();
        requestAnimationFrame(() => {
          requestAnimationFrame(() => resolve(performance.now() - startedAt));
        });
      }),
  );
}

function summarizeSamples(samples: readonly number[]): {
  readonly p50: number;
  readonly p95: number;
  readonly min: number;
  readonly max: number;
  readonly samples: readonly number[];
} {
  const sorted = [...samples].sort((a, b) => a - b);
  return {
    p50: nearestRank(sorted, 50),
    p95: nearestRank(sorted, 95),
    min: sorted[0] ?? 0,
    max: sorted.at(-1) ?? 0,
    samples,
  };
}

function nearestRank(
  sortedSamples: readonly number[],
  percentile: number,
): number {
  if (sortedSamples.length === 0) return 0;
  const rank = Math.ceil((percentile / 100) * sortedSamples.length);
  return sortedSamples[Math.max(0, rank - 1)] ?? 0;
}

async function browserResourceSnapshot(
  page: Page,
  cdp: CDPSession,
): Promise<{
  readonly heapUsedBytes: number | null;
  readonly objectUrls: {
    readonly active: number;
    readonly created: number;
    readonly revoked: number;
    readonly activeUrls: readonly string[];
    readonly mountedUrls: readonly string[];
    readonly activeMatchesMounted: boolean;
  };
  readonly listeners: {
    readonly active: number;
    readonly added: number;
    readonly removed: number;
  };
}> {
  await cdp.send("HeapProfiler.collectGarbage").catch(() => undefined);
  const metrics = (await cdp.send("Performance.getMetrics").catch(() => ({
    metrics: [],
  }))) as {
    readonly metrics?: readonly {
      readonly name: string;
      readonly value: number;
    }[];
  };
  const heapUsed = metrics.metrics?.find(
    ({ name }) => name === "JSHeapUsedSize",
  )?.value;
  const capture = await page.evaluate(() => {
    const activeUrls = [...window.__duelCapture.imageUrls.active].sort();
    const mountedUrls = [
      ...new Set(
        [...document.querySelectorAll<HTMLImageElement>("img")]
          .map((image) => image.currentSrc || image.src)
          .filter((src) => src.startsWith("blob:")),
      ),
    ].sort();
    return {
      objectUrls: {
        active: activeUrls.length,
        created: window.__duelCapture.imageUrls.created.length,
        revoked: window.__duelCapture.imageUrls.revoked.length,
        activeUrls,
        mountedUrls,
        activeMatchesMounted:
          activeUrls.length === mountedUrls.length &&
          activeUrls.every((url, index) => url === mountedUrls[index]),
      },
      listeners: {
        active:
          window.__duelCapture.listeners.added -
          window.__duelCapture.listeners.removed,
        added: window.__duelCapture.listeners.added,
        removed: window.__duelCapture.listeners.removed,
      },
    };
  });
  return {
    heapUsedBytes: heapUsed ?? null,
    objectUrls: capture.objectUrls,
    listeners: capture.listeners,
  };
}

function publicResourceSnapshot(
  snapshot: Awaited<ReturnType<typeof browserResourceSnapshot>>,
): {
  readonly heapUsedBytes: number | null;
  readonly objectUrls: {
    readonly active: number;
    readonly created: number;
    readonly revoked: number;
    readonly mounted: number;
    readonly activeMatchesMounted: boolean;
  };
  readonly listeners: {
    readonly active: number;
    readonly added: number;
    readonly removed: number;
  };
} {
  return {
    heapUsedBytes: snapshot.heapUsedBytes,
    objectUrls: {
      active: snapshot.objectUrls.active,
      created: snapshot.objectUrls.created,
      revoked: snapshot.objectUrls.revoked,
      mounted: snapshot.objectUrls.mountedUrls.length,
      activeMatchesMounted: snapshot.objectUrls.activeMatchesMounted,
    },
    listeners: snapshot.listeners,
  };
}

async function openSettingsDialog(page: Page): Promise<void> {
  await page.locator('[data-cy="duel-right-rail-options"]').click();
  await page.locator('[data-cy="menu-dialog-settings-button"]').click();
}

async function enableDuelHud(page: Page): Promise<void> {
  await openSettingsDialog(page);
  await page.locator('[data-cy="settings-show-duel-hud-checkbox"]').check();
  await page.locator('[data-cy="settings-dialog-close-button"]').click();
}

async function disableAutoResolveTrivialPrompts(page: Page): Promise<void> {
  await openSettingsDialog(page);
  await page.locator('[data-cy="settings-auto-resolve-checkbox"]').uncheck();
  await page.locator('[data-cy="settings-dialog-close-button"]').click();
}

async function disableAutoPlaceCards(page: Page): Promise<void> {
  await openSettingsDialog(page);
  await page
    .locator('[data-cy="settings-auto-place-cards-checkbox"]')
    .uncheck();
  await page.locator('[data-cy="settings-dialog-close-button"]').click();
}

async function enableWorkspace(page: Page): Promise<void> {
  await openSettingsDialog(page);
  await page.locator('[data-cy="settings-show-workspace-checkbox"]').check();
  await page.locator('[data-cy="settings-dialog-close-button"]').click();
}

async function surrenderThroughMenu(page: Page): Promise<void> {
  await page.locator('[data-cy="duel-right-rail-options"]').click();
  await page.locator('[data-cy="menu-dialog-surrender-button"]').click();
  await page
    .locator('[data-cy="menu-dialog-surrender-confirm-button"]')
    .click();
}

async function runTrayCycle(page: Page, cycles: number): Promise<void> {
  for (let cycle = 0; cycle < cycles; cycle += 1) {
    const trayButton = page
      .getByRole("button", { name: /Open Your (Extra Deck|GY|Banished) tray/ })
      .first();
    if ((await trayButton.count()) === 0) return;
    await trayButton.click();
    const tray = page.getByRole("region", {
      name: /Your (Extra Deck|GY|Banished) tray/,
    });
    await expect(tray).toBeVisible();
    await tray.getByRole("button", { name: /^Close / }).click();
    await expect(tray).toHaveCount(0);
  }
}

async function runRestartCycle(page: Page): Promise<void> {
  await surrenderThroughMenu(page);
  await expect(
    page.getByRole("heading", { name: "Duel surrendered" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Start another duel" }).click();
  await expect(page.locator("[data-prompt-kind]")).toBeVisible({
    timeout: 120_000,
  });
}

async function mountedImageLeaseState(page: Page): Promise<{
  readonly activeCount: number;
  readonly activeMatchesMounted: boolean;
  readonly activeUrls: readonly string[];
  readonly mountedUrls: readonly string[];
}> {
  return page.evaluate(() => {
    const activeUrls = [...window.__duelCapture.imageUrls.active].sort();
    const mountedUrls = [
      ...new Set(
        [...document.querySelectorAll<HTMLImageElement>("img")]
          .map((image) => image.currentSrc || image.src)
          .filter((url) => url.startsWith("blob:")),
      ),
    ].sort();
    return {
      activeCount: activeUrls.length,
      activeMatchesMounted:
        activeUrls.length === mountedUrls.length &&
        activeUrls.every((url, index) => url === mountedUrls[index]),
      activeUrls,
      mountedUrls,
    };
  });
}

async function readCapture(page: Page): Promise<BrowserCapture> {
  return page.evaluate(
    () =>
      (
        window as unknown as Window & {
          readonly __duelCapture: BrowserCapture;
        }
      ).__duelCapture,
  );
}

/* The capture holds every engine message of the duel so far, and a full duel
   is hundreds of prompts long: by prompt 190 the whole log was 2.6 MB and one
   `readCapture` cost ~0.8 s. A walker that polls it on every step therefore
   costs time quadratic in its own length — measured at 4.9 s per step near
   the end of a 191-prompt duel against 0.2 s at the start, which is what put
   the walk past its ten-minute budget. These two answer the single question
   each poll actually asks, inside the page, so a poll ships a string or a
   number instead of the transcript. The questions are unchanged. */
async function readLatestPromptId(page: Page): Promise<string | undefined> {
  return page.evaluate(() => {
    const events = window.__duelCapture.events;
    for (let index = events.length - 1; index >= 0; index -= 1) {
      const event = events[index] as { readonly type?: unknown } & Readonly<
        Record<string, unknown>
      >;
      if (event.type === "prompt")
        return (event as unknown as CapturedPromptEvent).prompt.id;
    }
    return undefined;
  });
}

async function countResponsesTo(page: Page, promptId: string): Promise<number> {
  return page.evaluate(
    (id) =>
      window.__duelCapture.commands.filter(
        (command) => command.type === "respond" && command.promptId === id,
      ).length,
    promptId,
  );
}
