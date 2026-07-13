import { readFile } from "node:fs/promises";
import { expect, test, type Locator, type Page } from "@playwright/test";

interface BrowserCapture {
  readonly commands: readonly Readonly<Record<string, unknown>>[];
  readonly events: readonly Readonly<Record<string, unknown>>[];
  readonly workers: number;
  readonly terminations: number;
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

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    const capture = {
      commands: [] as unknown[],
      events: [] as unknown[],
      workers: 0,
      terminations: 0,
    };
    Object.defineProperty(window, "__duelCapture", { value: capture });

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

test("production bundle initializes the real Worker and sends one opaque choice once", async ({
  page,
}) => {
  const requests: string[] = [];
  page.on("request", (request) => requests.push(request.url()));
  const startupBeganAt = Date.now();
  await page.goto("./");

  await expect(
    page.getByRole("heading", { name: "Choose a Main Phase action" }),
  ).toBeVisible({ timeout: 120_000 });
  expect(Date.now() - startupBeganAt).toBeLessThan(15_000);
  await expect(page.getByText("ocgcore 11.0")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Your turn" })).toBeVisible();
  await expect(page.getByText("8,000 LP").first()).toBeVisible();
  const fieldCanvas = page.getByTestId("duel-field-canvas");
  await expect(fieldCanvas).toBeVisible();
  await expect(fieldCanvas).toHaveAttribute("data-card-back-ready", "true");
  await expect
    .poll(async () =>
      Number(await fieldCanvas.getAttribute("data-hidden-cards")),
    )
    .toBeGreaterThan(0);
  await expect
    .poll(async () =>
      Number(await fieldCanvas.getAttribute("data-visible-card-images")),
    )
    .toBeGreaterThan(0);

  const promptHeading = page.getByRole("heading", {
    name: "Choose a Main Phase action",
  });
  await expect(promptHeading).toBeFocused();

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
  const endTurn = page.getByRole("button", { name: "End turn", exact: true });
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

test("repeated restart replaces the Worker and clears presentation state", async ({
  page,
}) => {
  await page.goto("./");
  for (let cycle = 1; cycle <= 2; cycle += 1) {
    await expect(page.locator("[data-prompt-kind]")).toBeVisible({
      timeout: 120_000,
    });
    await page.getByRole("button", { name: "Surrender duel" }).click();
    if (cycle === 1) {
      await page.getByRole("button", { name: "Keep playing" }).click();
      await expect(
        page.getByRole("button", { name: "Surrender duel" }),
      ).toBeFocused();
      await page.getByRole("button", { name: "Surrender duel" }).click();
    }
    await page.getByRole("button", { name: "Confirm surrender" }).click();
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
  await expect(page.locator("[data-prompt-kind]")).toBeVisible({
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

  await page.goto("./");
  await manifestBlocked;
  const reloadDuringLoading = page.reload();
  releaseManifest();
  await reloadDuringLoading;
  await expect(page.locator("[data-prompt-kind]")).toBeVisible({
    timeout: 120_000,
  });

  await page.getByRole("button", { name: "Surrender duel" }).click();
  await page.getByRole("button", { name: "Confirm surrender" }).click();
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
  await expect(page.locator("[data-prompt-kind]")).toBeVisible({
    timeout: 120_000,
  });
  await expect(
    page.getByRole("heading", { name: "Duel surrendered" }),
  ).toHaveCount(0);
});

test("missing active images use deterministic placeholders without blocking input", async ({
  page,
}) => {
  await page.route(/\/runtime\/images\/\d+\.jpg$/, (route) =>
    route.abort("failed"),
  );
  await page.goto("./");
  const controls = page.locator("[data-prompt-kind]");
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
  await page.goto("./");
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

test("visual field startup failure announces the semantic fallback and retry", async ({
  page,
}) => {
  await page.route(/create-phaser-presentation-bridge-.*\.js$/, (route) =>
    route.abort("failed"),
  );
  await page.goto("./");
  await expect(page.getByRole("heading", { name: "Your turn" })).toBeVisible({
    timeout: 120_000,
  });
  await expect(
    page.getByText(
      /Visual duel field unavailable:.*text view remains available/i,
    ),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Retry visual field" }),
  ).toBeVisible();
});

test("mobile layout preserves controls and honors reduced motion", async ({
  page,
}) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("./");
  await expect(page.locator("[data-prompt-kind]")).toBeVisible({
    timeout: 120_000,
  });
  const fieldCanvas = page.getByTestId("duel-field-canvas");
  await expect(fieldCanvas).toHaveAttribute("data-reduced-motion", "true");
  const fieldRegion = page.getByRole("region", { name: "Visual duel field" });
  await expect(fieldRegion).toBeVisible();
  const dimensions = await fieldRegion.evaluate((element) => ({
    clientWidth: element.clientWidth,
    scrollWidth: element.scrollWidth,
    bodyWidth: document.body.scrollWidth,
    viewportWidth: window.innerWidth,
  }));
  expect(dimensions.scrollWidth).toBeGreaterThan(dimensions.clientWidth);
  expect(dimensions.bodyWidth).toBeLessThanOrEqual(dimensions.viewportWidth);
  const firstDecision = page.locator("[data-prompt-kind] button").first();
  const box = await firstDecision.boundingBox();
  expect(box?.height).toBeGreaterThanOrEqual(44);
  expect(box?.width).toBeGreaterThanOrEqual(44);
});

test("a full preset duel can be completed using keyboard controls only", async ({
  page,
}) => {
  await page.goto("./");
  await expect(page.locator("[data-prompt-kind]")).toBeVisible({
    timeout: 120_000,
  });
  await expect(
    page.locator("[data-prompt-kind] button:enabled").first(),
  ).toBeVisible({ timeout: 30_000 });

  for (let step = 0; step < 200; step += 1) {
    const result = page.locator(".result-panel");
    if (await result.isVisible()) break;

    const controls = page.locator("[data-prompt-kind]");
    await controls.waitFor({ state: "visible", timeout: 30_000 });
    const controlsElement = await controls.elementHandle();
    if (controlsElement === null)
      throw new Error("Prompt controls disappeared");
    const kind = await controls.getAttribute("data-prompt-kind");
    if (kind === null) throw new Error("Prompt kind is missing");

    await answerPromptWithKeyboard(page, controls, kind);
    await page.waitForFunction(
      (element) => !element.isConnected,
      controlsElement,
      { timeout: 30_000 },
    );
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
    schemaVersion: 1,
    sensitivity: "contains-production-seed",
    application: { buildId: expect.stringMatching(/^0\.1\.0\+/) },
  });
  expect(diagnostics.trace.seed).toHaveLength(4);
  expect(diagnostics.trace.entries.length).toBeGreaterThan(0);
});

async function answerPromptWithKeyboard(
  page: Page,
  controls: Locator,
  kind: string,
): Promise<void> {
  switch (kind) {
    case "idleCommand":
      await activatePreferredButton(page, controls, [
        "End turn",
        "Enter Battle Phase",
      ]);
      return;
    case "battleCommand":
      await activatePreferredButton(page, controls, [
        "Enter Main Phase 2",
        "End Battle Phase",
      ]);
      return;
    case "yesNo":
    case "effectYesNo":
      await activatePreferredButton(page, controls, ["No"]);
      return;
    case "chain":
      await activatePreferredButton(page, controls, ["Pass"]);
      return;
    case "selectUnselectCard":
      await activatePreferredButton(page, controls, ["Finish", "Cancel"]);
      return;
    case "sortCard":
    case "sortChain":
      await keyboardActivate(
        page,
        controls.getByRole("button", { name: "Confirm order" }),
      );
      return;
    case "selectCounter":
      await allocateCounters(page, controls);
      return;
    case "selectCard":
    case "selectTribute":
    case "selectSum":
    case "selectPlace":
    case "selectDisabledField":
    case "announceAttribute":
    case "announceRace":
      await chooseValidCheckboxSubset(page, controls);
      return;
    default:
      await activatePreferredButton(page, controls, []);
  }
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

async function keyboardActivate(page: Page, target: Locator): Promise<void> {
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
  const isCheckbox = await element.evaluate(
    (node) => node instanceof HTMLInputElement && node.type === "checkbox",
  );
  await page.keyboard.press(isCheckbox ? "Space" : "Enter");
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
