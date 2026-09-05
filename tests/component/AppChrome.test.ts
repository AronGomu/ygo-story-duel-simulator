// @vitest-environment jsdom

import { cleanup, fireEvent, render } from "@testing-library/svelte";
import { userEvent } from "@testing-library/user-event";
import { tick } from "svelte";
import { afterEach, describe, expect, it, vi } from "vitest";

const workerClientSpies = vi.hoisted(() => {
  const runtimeSnapshotId = "a".repeat(64);
  Object.assign(globalThis, {
    __RUNTIME_SNAPSHOT_ID__: runtimeSnapshotId,
    __ACTIVATION_SNAPSHOT_ID__: runtimeSnapshotId,
    __RUNTIME_MANIFEST_SHA256__: "b".repeat(64),
    __ACTIVE_IMAGE_MANIFEST_SHA256__: "c".repeat(64),
    __RUNTIME_REVISIONS__: {},
    __ACTIVE_IMAGE_MANIFEST__: {
      snapshotId: runtimeSnapshotId,
      files: [],
      missing: [],
    },
    __APP_BUILD_ID__: "component-test",
  });
  return { startDuel: vi.fn(), respond: vi.fn() };
});

vi.mock("../../src/battle/app/DuelWorkerClient.ts", () => {
  class DuelWorkerClientMock {
    static instances: DuelWorkerClientMock[] = [];
    context = { workerGeneration: 1, sessionGeneration: 0 };
    listeners = new Set<(received: unknown) => void>();

    constructor() {
      DuelWorkerClientMock.instances.push(this);
    }

    subscribe(listener: (received: unknown) => void) {
      this.listeners.add(listener);
      return () => this.listeners.delete(listener);
    }

    initialize() {
      queueMicrotask(() => {
        for (const listener of this.listeners)
          listener({
            context: this.context,
            event: { type: "ready", coreVersion: [11, 0] },
          });
      });
      return true;
    }

    startDuel(...args: unknown[]) {
      workerClientSpies.startDuel(...args);
      this.context = { ...this.context, sessionGeneration: 1 };
      return this.context;
    }

    respond(...args: unknown[]) {
      return workerClientSpies.respond(...args) === true;
    }

    surrender() {
      return false;
    }

    requestDiagnostics() {
      return false;
    }

    async replace() {
      this.context = {
        workerGeneration: this.context.workerGeneration + 1,
        sessionGeneration: 0,
      };
      return { graceful: true };
    }

    async dispose() {
      return { graceful: true };
    }
  }

  return { DuelWorkerClient: DuelWorkerClientMock };
});

import App from "../../src/battle/app/App.svelte";
import { DuelWorkerClient as MockedDuelWorkerClient } from "../../src/battle/app/DuelWorkerClient.ts";
import MenuDialog from "../../src/battle/app/components/MenuDialog.svelte";
import SettingsDialog from "../../src/battle/app/components/SettingsDialog.svelte";
import {
  choiceId,
  promptId,
  snapshotId,
} from "../../src/battle/duel/contracts/ids.ts";
import type { PlayerPrompt } from "../../src/battle/duel/contracts/player-prompt.ts";
import type { PublicDuelState } from "../../src/battle/duel/contracts/public-duel-state.ts";
import {
  concealedStateCard,
  publicStateCard,
} from "../fixtures/board-public-states.ts";

interface MockedWorkerInstance {
  readonly context: { workerGeneration: number; sessionGeneration: number };
  readonly listeners: Set<(received: unknown) => void>;
}
interface MockedWorkerClientCtor {
  instances: MockedWorkerInstance[];
}

const mockedWorkerClientCtor =
  MockedDuelWorkerClient as unknown as MockedWorkerClientCtor;

afterEach(() => {
  cleanup();
  localStorage.clear();
  workerClientSpies.startDuel.mockReset();
  workerClientSpies.respond.mockReset();
  mockedWorkerClientCtor.instances.length = 0;
});

async function renderReadyApp() {
  const rendered = render(App);
  await vi.waitFor(() =>
    expect(document.querySelector('[data-cy="deck-picker"]')).not.toBeNull(),
  );
  return rendered;
}

async function startDuelFromPicker(
  user: ReturnType<typeof userEvent.setup>,
): Promise<void> {
  await user.selectOptions(
    document.querySelector(
      '[data-cy="deck-picker-player-select"]',
    ) as HTMLSelectElement,
    "preset:burning-abyss",
  );
  await user.click(
    document.querySelector(
      '[data-cy="deck-picker-start-button"]',
    ) as HTMLButtonElement,
  );
}

const EMPTY_SNAPSHOT: PublicDuelState = {
  snapshotId: snapshotId("d".repeat(64)),
  revision: 1,
  turn: 1,
  turnPlayer: 0,
  phase: "main1",
  layout: { extraMonsterZones: true },
  players: [
    {
      player: 0,
      lifePoints: 8000,
      deckCount: 40,
      deck: [],
      extraDeckCount: 0,
      handCount: 0,
      hand: [],
      extraDeck: [],
      monsters: [],
      spellsAndTraps: [],
      graveyard: [],
      banished: [],
    },
    {
      player: 1,
      lifePoints: 8000,
      deckCount: 40,
      deck: [],
      extraDeckCount: 0,
      handCount: 0,
      hand: [],
      extraDeck: [],
      monsters: [],
      spellsAndTraps: [],
      graveyard: [],
      banished: [],
    },
  ],
  chain: [],
};

function emitDuelState(state: PublicDuelState): void {
  const worker =
    mockedWorkerClientCtor.instances[
      mockedWorkerClientCtor.instances.length - 1
    ];
  if (worker === undefined) throw new Error("No mocked worker client instance");
  for (const listener of worker.listeners)
    listener({ context: worker.context, event: { type: "state", state } });
}

function emitPrompt(prompt: PlayerPrompt): void {
  const worker =
    mockedWorkerClientCtor.instances[
      mockedWorkerClientCtor.instances.length - 1
    ];
  if (worker === undefined) throw new Error("No mocked worker client instance");
  for (const listener of worker.listeners)
    listener({ context: worker.context, event: { type: "prompt", prompt } });
}

function emitDuelError(): void {
  const worker =
    mockedWorkerClientCtor.instances[
      mockedWorkerClientCtor.instances.length - 1
    ];
  if (worker === undefined) throw new Error("No mocked worker client instance");
  for (const listener of worker.listeners)
    listener({
      context: worker.context,
      event: {
        type: "error",
        error: {
          code: "worker_error",
          message: "Injected component error",
          recoverable: false,
        },
      },
    });
}

function emitRecoverableDuelError(): void {
  const worker =
    mockedWorkerClientCtor.instances[
      mockedWorkerClientCtor.instances.length - 1
    ];
  if (worker === undefined) throw new Error("No mocked worker client instance");
  for (const listener of worker.listeners)
    listener({
      context: worker.context,
      event: {
        type: "error",
        error: {
          code: "invalid_response",
          message: "Select exactly one choice",
          recoverable: true,
        },
      },
    });
}

const LINK_FREE_SNAPSHOT: PublicDuelState = {
  ...EMPTY_SNAPSHOT,
  layout: { extraMonsterZones: false },
};

const PREVIEW_KNOWN_MONSTER = publicStateCard(
  "preview-known-monster",
  97590747,
  0,
  "monster",
  0,
);
const PREVIEW_HIDDEN_MONSTER = concealedStateCard(
  "preview-hidden-monster",
  1,
  "monster",
  0,
);
const PREVIEW_TEST_STATE: PublicDuelState = {
  ...EMPTY_SNAPSHOT,
  players: [
    { ...EMPTY_SNAPSHOT.players[0]!, monsters: [PREVIEW_KNOWN_MONSTER] },
    { ...EMPTY_SNAPSHOT.players[1]!, monsters: [PREVIEW_HIDDEN_MONSTER] },
  ],
};

const SHARED_ZONE_PLACE_PROMPT: PlayerPrompt = {
  id: promptId("shared-zone-place"),
  kind: "selectPlace",
  player: 0,
  title: "Select field location(s)",
  choices: [
    {
      id: choiceId("shared-zone-place-5"),
      label: "Shared Extra Monster Zone left",
      action: "select",
      place: { player: 0, location: "monster", sequence: 5 },
    },
  ],
  minimum: 1,
  maximum: 1,
  cancelable: false,
  ordered: false,
};

async function startLinkFreeConflict(
  user: ReturnType<typeof userEvent.setup>,
): Promise<void> {
  await startDuelFromPicker(user);
  emitDuelState(LINK_FREE_SNAPSHOT);
  emitPrompt(SHARED_ZONE_PLACE_PROMPT);
  await vi.waitFor(() =>
    expect(
      document.querySelector('[data-cy="layout-profile-conflict"]'),
    ).not.toBeNull(),
  );
  await new Promise<void>((resolve) => queueMicrotask(resolve));
  await new Promise<void>((resolve) => queueMicrotask(resolve));
}

describe("App", () => {
  it("shows the deck picker instead of auto-starting", async () => {
    await renderReadyApp();

    expect(document.querySelector('[data-cy="deck-picker"]')).not.toBeNull();
    expect(workerClientSpies.startDuel).not.toHaveBeenCalled();
  });

  it("starting from the picker passes pair-derived preset id and both preset selections", async () => {
    const user = userEvent.setup();
    await renderReadyApp();

    /* Only the player seat is chosen here: the opponent is fixed to Shaddoll
       by the host, which is what the dispatched pair below proves. */
    await startDuelFromPicker(user);

    expect(workerClientSpies.startDuel).toHaveBeenCalledOnce();
    expect(workerClientSpies.startDuel).toHaveBeenCalledWith(
      "bundled-v1:burning-abyss:vs:shaddoll",
      { kind: "preset", deckId: "burning-abyss" },
      { kind: "preset", deckId: "shaddoll" },
    );
  });

  it("blocks the duel view when a prompt still reaches an omitted shared zone", async () => {
    const user = userEvent.setup();
    await renderReadyApp();
    await startLinkFreeConflict(user);

    const alert = document.querySelector(
      '[data-cy="layout-profile-conflict"]',
    ) as HTMLElement;
    expect(alert.getAttribute("role")).toBe("alert");
    expect(alert.getAttribute("data-conflict-zone-id")).toBe(
      "shared:extraMonster:left",
    );
    expect(alert.getAttribute("data-conflict-source")).toBe("prompt");
    expect(document.querySelector('[data-cy="duel-field"]')).toBeNull();
    expect(document.querySelector('[data-cy="prompt-dialog"]')).toBeNull();
    expect(
      document.querySelector('[data-cy="app-field-error-panel"]'),
    ).toBeNull();
    expect(workerClientSpies.respond).not.toHaveBeenCalled();
    expect(
      document
        .querySelector('[data-cy="app-main"]')
        ?.getAttribute("data-duel-viewport"),
    ).toBeNull();
  });

  it("suppresses workspace prompt controls during a layout profile conflict", async () => {
    const user = userEvent.setup();
    await renderReadyApp();
    await startDuelFromPicker(user);
    emitDuelState(LINK_FREE_SNAPSHOT);
    await vi.waitFor(() =>
      expect(
        document.querySelector('[data-cy="duel-right-rail-options"]'),
      ).not.toBeNull(),
    );
    await user.click(
      document.querySelector(
        '[data-cy="duel-right-rail-options"]',
      ) as HTMLButtonElement,
    );
    await user.click(
      document.querySelector(
        '[data-cy="menu-dialog-settings-button"]',
      ) as HTMLButtonElement,
    );
    await user.click(
      document.querySelector(
        '[data-cy="settings-show-workspace-checkbox"]',
      ) as HTMLInputElement,
    );
    await user.click(
      document.querySelector(
        '[data-cy="settings-dialog-close-button"]',
      ) as HTMLButtonElement,
    );
    emitPrompt(SHARED_ZONE_PLACE_PROMPT);
    await vi.waitFor(() =>
      expect(
        document.querySelector('[data-cy="layout-profile-conflict"]'),
      ).not.toBeNull(),
    );

    expect(document.querySelector('[data-cy="workspace-grid"]')).not.toBeNull();
    expect(
      document.querySelector('[data-cy="prompt-controls-panel"]'),
    ).toBeNull();
    expect(
      document.querySelector('[data-cy="prompt-panel-heading"]')?.textContent,
    ).toContain("No decision pending");
    expect(workerClientSpies.respond).not.toHaveBeenCalled();
  });

  it("keeps the normal prompt path when the layout and rules agree", async () => {
    const user = userEvent.setup();
    await renderReadyApp();
    await startDuelFromPicker(user);
    emitDuelState(EMPTY_SNAPSHOT);
    emitPrompt(SHARED_ZONE_PLACE_PROMPT);
    await vi.waitFor(() =>
      expect(workerClientSpies.respond).toHaveBeenCalledTimes(1),
    );

    expect(
      document.querySelector('[data-cy="layout-profile-conflict"]'),
    ).toBeNull();
  });

  it("uses one full-height shell in preview, field column, rail order", async () => {
    const user = userEvent.setup();
    await renderReadyApp();
    await startDuelFromPicker(user);
    emitDuelState(EMPTY_SNAPSHOT);

    await vi.waitFor(() =>
      expect(document.querySelector('[data-cy="duel-shell"]')).not.toBeNull(),
    );
    const shell = document.querySelector('[data-cy="duel-shell"]');
    expect(
      Array.from(shell?.children ?? []).map((child) =>
        child.getAttribute("data-cy"),
      ),
    ).toEqual(["card-preview-panel", "duel-field-column", "duel-right-rail"]);
    const fieldColumn = document.querySelector('[data-cy="duel-field-column"]');
    expect(
      Array.from(fieldColumn?.children ?? []).map((child) =>
        child.getAttribute("data-cy"),
      ),
    ).toEqual(["phase-bar", "duel-field-slot"]);
  });

  it("returns focus to the live rail options trigger after Menu and Settings close", async () => {
    const user = userEvent.setup();
    await renderReadyApp();
    await startDuelFromPicker(user);
    emitDuelState(EMPTY_SNAPSHOT);

    const options = await vi.waitFor(() => {
      const element = document.querySelector<HTMLButtonElement>(
        '[data-cy="duel-right-rail-options"]',
      );
      expect(element).not.toBeNull();
      return element!;
    });
    await user.click(options);
    await user.click(
      document.querySelector(
        '[data-cy="menu-dialog-close-button"]',
      ) as HTMLButtonElement,
    );
    expect(document.activeElement).toBe(options);

    await user.click(options);
    await user.click(
      document.querySelector(
        '[data-cy="menu-dialog-settings-button"]',
      ) as HTMLButtonElement,
    );
    await user.click(
      document.querySelector(
        '[data-cy="settings-dialog-close-button"]',
      ) as HTMLButtonElement,
    );
    expect(document.activeElement).toBe(options);
  });

  it("keeps startup warning content in document-scroll mode", async () => {
    const user = userEvent.setup();
    await renderReadyApp();
    await startDuelFromPicker(user);
    emitDuelState(EMPTY_SNAPSHOT);

    await vi.waitFor(() =>
      expect(
        document.querySelector(
          '[data-cy="app-storage-warning-panel"], [data-cy="app-image-warning-panel"]',
        ),
      ).not.toBeNull(),
    );
    const main = document.querySelector('[data-cy="app-main"]');
    expect(main?.getAttribute("data-duel-viewport")).toBeNull();
    expect(main?.classList.contains("is-duel-viewport")).toBe(false);
  });

  it("restores document scrolling while the fatal error dialog renders", async () => {
    const user = userEvent.setup();
    await renderReadyApp();
    await startDuelFromPicker(user);
    emitDuelState(EMPTY_SNAPSHOT);

    emitDuelError();

    await vi.waitFor(() =>
      expect(
        document.querySelector('[data-cy="duel-error-dialog"]'),
      ).not.toBeNull(),
    );
    const main = document.querySelector('[data-cy="app-main"]');
    expect(main?.getAttribute("data-duel-viewport")).toBeNull();
    expect(main?.classList.contains("is-duel-viewport")).toBe(false);
  });

  /* Only a dead duel is modal. A rejected choice is still answerable, so it
     keeps the in-flow panel and its Dismiss. */
  it("keeps the dismissable in-flow panel for a recoverable rejection", async () => {
    const user = userEvent.setup();
    await renderReadyApp();
    await startDuelFromPicker(user);
    emitDuelState(EMPTY_SNAPSHOT);
    emitPrompt(SHARED_ZONE_PLACE_PROMPT);

    emitRecoverableDuelError();

    await vi.waitFor(() =>
      expect(
        document.querySelector('[data-cy="app-error-panel"]'),
      ).not.toBeNull(),
    );
    expect(
      document.querySelector('[data-cy="app-dismiss-error-button"]'),
    ).not.toBeNull();
    expect(document.querySelector('[data-cy="duel-error-dialog"]')).toBeNull();
  });

  it("restores document mode for optional HUD", async () => {
    const user = userEvent.setup();
    await renderReadyApp();
    await startDuelFromPicker(user);
    emitDuelState(EMPTY_SNAPSHOT);

    await user.click(
      document.querySelector(
        '[data-cy="duel-right-rail-options"]',
      ) as HTMLButtonElement,
    );
    await user.click(
      document.querySelector(
        '[data-cy="menu-dialog-settings-button"]',
      ) as HTMLButtonElement,
    );
    await user.click(
      document.querySelector(
        '[data-cy="settings-show-duel-hud-checkbox"]',
      ) as HTMLInputElement,
    );
    await user.click(
      document.querySelector(
        '[data-cy="settings-dialog-close-button"]',
      ) as HTMLButtonElement,
    );

    const main = document.querySelector('[data-cy="app-main"]');
    await vi.waitFor(() =>
      expect(main?.getAttribute("data-duel-viewport")).toBeNull(),
    );
    expect(main?.classList.contains("is-duel-viewport")).toBe(false);
  });

  it("restores document mode for workspace", async () => {
    const user = userEvent.setup();
    await renderReadyApp();
    await startDuelFromPicker(user);
    emitDuelState(EMPTY_SNAPSHOT);

    await user.click(
      document.querySelector(
        '[data-cy="duel-right-rail-options"]',
      ) as HTMLButtonElement,
    );
    await user.click(
      document.querySelector(
        '[data-cy="menu-dialog-settings-button"]',
      ) as HTMLButtonElement,
    );
    await user.click(
      document.querySelector(
        '[data-cy="settings-show-workspace-checkbox"]',
      ) as HTMLInputElement,
    );
    await user.click(
      document.querySelector(
        '[data-cy="settings-dialog-close-button"]',
      ) as HTMLButtonElement,
    );

    const main = document.querySelector('[data-cy="app-main"]');
    await vi.waitFor(() =>
      expect(main?.getAttribute("data-duel-viewport")).toBeNull(),
    );
    expect(main?.classList.contains("is-duel-viewport")).toBe(false);
  });

  it("hovering a hidden card keeps the previous preview", async () => {
    const user = userEvent.setup();
    await renderReadyApp();
    await startDuelFromPicker(user);
    emitDuelState(PREVIEW_TEST_STATE);

    const knownCard = await vi.waitFor(() => {
      const el = document.querySelector(
        '[data-cy="field-card-preview-known-monster"]',
      );
      expect(el).not.toBeNull();
      return el!;
    });

    fireEvent.pointerEnter(knownCard);
    const nameBefore = await vi.waitFor(() => {
      const el = document.querySelector('[data-cy="card-preview-name"]');
      expect(el).not.toBeNull();
      return el!.textContent;
    });

    const hiddenCard = document.querySelector(
      '[data-cy="field-card-preview-hidden-monster"]',
    )!;
    fireEvent.pointerEnter(hiddenCard);
    await tick();

    expect(
      document.querySelector('[data-cy="card-preview-name"]')?.textContent,
    ).toBe(nameBefore);
  });

  it("hovering before any known card leaves the empty state", async () => {
    const user = userEvent.setup();
    await renderReadyApp();
    await startDuelFromPicker(user);
    emitDuelState(PREVIEW_TEST_STATE);

    const hiddenCard = await vi.waitFor(() => {
      const el = document.querySelector(
        '[data-cy="field-card-preview-hidden-monster"]',
      );
      expect(el).not.toBeNull();
      return el!;
    });

    expect(
      document.querySelector('[data-cy="card-preview-empty"]'),
    ).not.toBeNull();

    fireEvent.pointerEnter(hiddenCard);
    await tick();

    expect(
      document.querySelector('[data-cy="card-preview-empty"]'),
    ).not.toBeNull();
  });
});

/* The chain window the player opened themselves: two choices, so it is not a
   formality `trivialPromptResponse` would answer, and a chain whose last link
   the player controls, so `ownEffectChainPassResponse` is what has to answer
   it. Everything below turns on whether that automation runs. */
const OWN_CHAIN_PASS = choiceId("own-chain-pass");
const OWN_EFFECT_CHAIN_PROMPT: PlayerPrompt = {
  id: promptId("own-effect-chain-window"),
  kind: "chain",
  player: 0,
  title: "Activate an effect in response?",
  choices: [
    {
      id: choiceId("own-chain-activate"),
      label: "Activate Set card",
      action: "activate",
    },
    { id: OWN_CHAIN_PASS, label: "No response", action: "pass" },
  ],
  minimum: 0,
  maximum: 1,
  cancelable: true,
  ordered: false,
};

const OWN_CHAIN_SNAPSHOT: PublicDuelState = {
  ...EMPTY_SNAPSHOT,
  chain: [
    {
      index: 0,
      controller: 0,
      sourceIdentityVisible: true,
      label: "Your effect",
      phase: "pending",
      outcome: "normal",
    },
  ],
};

/** Lets the prompt reach the auto-resolve reactive statement and its queued
    response. Sized by the positive test below, which fails if it is short. */
async function settleAutoResolve(): Promise<void> {
  for (let round = 0; round < 3; round += 1) {
    await tick();
    await new Promise<void>((resolve) => queueMicrotask(resolve));
  }
  await tick();
}

async function startOwnEffectChainWindow(
  user: ReturnType<typeof userEvent.setup>,
): Promise<void> {
  await startDuelFromPicker(user);
  emitDuelState(OWN_CHAIN_SNAPSHOT);
  await vi.waitFor(() =>
    expect(
      document.querySelector('[data-cy="full-control-checkbox"]'),
    ).not.toBeNull(),
  );
}

function endPhasePrompt(id: string): PlayerPrompt {
  return {
    id: promptId(id),
    kind: "idleCommand",
    player: 0,
    title: "Choose a Main Phase action",
    choices: [
      {
        id: choiceId(`${id}-end`),
        label: "End turn",
        action: "endPhase",
      },
    ],
    minimum: 1,
    maximum: 1,
    cancelable: false,
    ordered: false,
  };
}

function holdCtrl(): void {
  fireEvent.keyDown(window, { key: "Control" });
}

function releaseCtrl(): void {
  fireEvent.keyUp(window, { key: "Control" });
}

describe("App End Turn automation", () => {
  it("pauses prompt auto-response for a manual decision then resumes end-phase exits", async () => {
    const user = userEvent.setup();
    const firstEnd = endPhasePrompt("first-end");
    const resumedEnd = endPhasePrompt("resumed-end");
    workerClientSpies.respond.mockReturnValue(true);
    await renderReadyApp();
    await startDuelFromPicker(user);
    emitDuelState(EMPTY_SNAPSHOT);
    emitPrompt(firstEnd);

    const endTurn = await vi.waitFor(() => {
      const button = document.querySelector(
        '[data-cy="field-end-turn-button"]',
      ) as HTMLButtonElement;
      expect(button.disabled).toBe(false);
      return button;
    });
    await user.click(endTurn);
    expect(workerClientSpies.respond).toHaveBeenCalledWith(firstEnd.id, [
      choiceId("first-end-end"),
    ]);

    emitDuelState(OWN_CHAIN_SNAPSHOT);
    emitPrompt(OWN_EFFECT_CHAIN_PROMPT);
    await settleAutoResolve();

    expect(workerClientSpies.respond).toHaveBeenCalledTimes(1);
    expect(endTurn.getAttribute("data-armed")).toBe("true");
    await user.click(
      document.querySelector(
        '[data-cy="field-action-bar-choice-own-chain-pass"]',
      ) as HTMLButtonElement,
    );
    expect(workerClientSpies.respond).toHaveBeenNthCalledWith(
      2,
      OWN_EFFECT_CHAIN_PROMPT.id,
      [OWN_CHAIN_PASS],
    );

    emitPrompt(resumedEnd);
    await settleAutoResolve();

    expect(workerClientSpies.respond).toHaveBeenNthCalledWith(
      3,
      resumedEnd.id,
      [choiceId("resumed-end-end")],
    );
    expect(workerClientSpies.respond).toHaveBeenCalledTimes(3);
  });
});

describe("App Full Control", () => {
  it("passes on a chain window the player opened themselves", async () => {
    const user = userEvent.setup();
    await renderReadyApp();
    await startOwnEffectChainWindow(user);

    emitPrompt(OWN_EFFECT_CHAIN_PROMPT);
    await settleAutoResolve();

    expect(workerClientSpies.respond).toHaveBeenCalledTimes(1);
    expect(workerClientSpies.respond).toHaveBeenCalledWith(
      OWN_EFFECT_CHAIN_PROMPT.id,
      [OWN_CHAIN_PASS],
    );
  });

  it("answers nothing at all while the Full Control setting is on", async () => {
    const user = userEvent.setup();
    await renderReadyApp();
    await startOwnEffectChainWindow(user);

    await user.click(
      document.querySelector(
        '[data-cy="full-control-checkbox"]',
      ) as HTMLInputElement,
    );
    emitPrompt(OWN_EFFECT_CHAIN_PROMPT);
    await settleAutoResolve();

    expect(workerClientSpies.respond).not.toHaveBeenCalled();
  });

  it("answers nothing while Ctrl is held, with the setting left off", async () => {
    const user = userEvent.setup();
    await renderReadyApp();
    await startOwnEffectChainWindow(user);

    holdCtrl();
    await tick();
    expect(
      (
        document.querySelector(
          '[data-cy="full-control-checkbox"]',
        ) as HTMLInputElement
      ).checked,
    ).toBe(false);

    emitPrompt(OWN_EFFECT_CHAIN_PROMPT);
    await settleAutoResolve();

    expect(workerClientSpies.respond).not.toHaveBeenCalled();
  });

  /* Releasing Ctrl must not hand an automation the very window the player is
     looking at. Full Control claims the prompt id on the way out, so the
     window the player already saw stays theirs even after the key comes up. */
  it("keeps a window the player already saw after Ctrl is released", async () => {
    const user = userEvent.setup();
    await renderReadyApp();
    await startOwnEffectChainWindow(user);

    holdCtrl();
    await tick();
    emitPrompt(OWN_EFFECT_CHAIN_PROMPT);
    await settleAutoResolve();
    expect(workerClientSpies.respond).not.toHaveBeenCalled();

    releaseCtrl();
    await settleAutoResolve();

    expect(workerClientSpies.respond).not.toHaveBeenCalled();
  });
});

describe("MenuDialog", () => {
  it("offers settings and surrender", () => {
    render(MenuDialog, {
      surrenderAvailable: true,
      responsePending: false,
      onopensettings: vi.fn(),
      onsurrender: vi.fn(() => true),
      onclose: vi.fn(),
    });

    const settingsButton = document.querySelector(
      '[data-cy="menu-dialog-settings-button"]',
    );
    const surrenderButton = document.querySelector(
      '[data-cy="menu-dialog-surrender-button"]',
    );
    expect(settingsButton).not.toBeNull();
    expect(surrenderButton).not.toBeNull();
    expect(surrenderButton?.classList.contains("danger")).toBe(true);
  });

  /* The host's way out of the match sits under Surrender rather than on a
     control painted over the field. A host that owns its own exit passes none,
     and then the item is absent rather than dead. */
  it("offers the host's exit under surrender, and only when there is one", async () => {
    const user = userEvent.setup();
    const onleavematch = vi.fn();
    const props = {
      surrenderAvailable: true,
      responsePending: false,
      onopensettings: vi.fn(),
      onsurrender: vi.fn(() => true),
      onclose: vi.fn(),
    };
    const rendered = render(MenuDialog, { ...props, onleavematch });

    const buttons = [
      ...document.querySelectorAll('[data-cy="menu-dialog"] button'),
    ].map((button) => button.getAttribute("data-cy"));
    expect(buttons).toEqual([
      "menu-dialog-settings-button",
      "menu-dialog-surrender-button",
      "menu-dialog-leave-match-button",
      "menu-dialog-close-button",
    ]);

    await user.click(
      document.querySelector(
        '[data-cy="menu-dialog-leave-match-button"]',
      ) as HTMLButtonElement,
    );
    expect(onleavematch).toHaveBeenCalledTimes(1);

    await rendered.rerender({ ...props, onleavematch: null });
    expect(
      document.querySelector('[data-cy="menu-dialog-leave-match-button"]'),
    ).toBeNull();
  });

  it("needs confirmation before surrendering", async () => {
    const user = userEvent.setup();
    const onsurrender = vi.fn(() => true);
    render(MenuDialog, {
      surrenderAvailable: true,
      responsePending: false,
      onopensettings: vi.fn(),
      onsurrender,
      onclose: vi.fn(),
    });

    const surrenderButton = document.querySelector(
      '[data-cy="menu-dialog-surrender-button"]',
    ) as HTMLButtonElement;
    await user.click(surrenderButton);

    expect(onsurrender).not.toHaveBeenCalled();
    const confirmButton = document.querySelector(
      '[data-cy="menu-dialog-surrender-confirm-button"]',
    ) as HTMLButtonElement;
    expect(confirmButton).not.toBeNull();

    await user.click(confirmButton);
    expect(onsurrender).toHaveBeenCalledTimes(1);
  });

  it("cancel returns to the menu without surrendering", async () => {
    const user = userEvent.setup();
    const onsurrender = vi.fn(() => true);
    render(MenuDialog, {
      surrenderAvailable: true,
      responsePending: false,
      onopensettings: vi.fn(),
      onsurrender,
      onclose: vi.fn(),
    });

    await user.click(
      document.querySelector(
        '[data-cy="menu-dialog-surrender-button"]',
      ) as HTMLButtonElement,
    );
    await user.click(
      document.querySelector(
        '[data-cy="menu-dialog-surrender-cancel-button"]',
      ) as HTMLButtonElement,
    );

    expect(
      document.querySelector('[data-cy="menu-dialog-surrender-button"]'),
    ).not.toBeNull();
    expect(onsurrender).not.toHaveBeenCalled();
  });

  it("closes the menu once a surrender is under way", async () => {
    const user = userEvent.setup();
    const onclose = vi.fn();
    render(MenuDialog, {
      surrenderAvailable: true,
      responsePending: false,
      onopensettings: vi.fn(),
      onsurrender: vi.fn(() => true),
      onclose,
    });

    await user.click(
      document.querySelector(
        '[data-cy="menu-dialog-surrender-button"]',
      ) as HTMLButtonElement,
    );
    await user.click(
      document.querySelector(
        '[data-cy="menu-dialog-surrender-confirm-button"]',
      ) as HTMLButtonElement,
    );

    expect(onclose).toHaveBeenCalledTimes(1);
    expect(
      document.querySelector('[data-cy="menu-dialog-surrender-error"]'),
    ).toBeNull();
  });

  /* A surrender the store refuses changes nothing, so dismissing the menu
     would leave the player believing an action they never committed. */
  it("keeps the menu open and announces a surrender that never started", async () => {
    const user = userEvent.setup();
    const onclose = vi.fn();
    const onsurrender = vi.fn(() => false);
    render(MenuDialog, {
      surrenderAvailable: true,
      responsePending: false,
      onopensettings: vi.fn(),
      onsurrender,
      onclose,
    });

    await user.click(
      document.querySelector(
        '[data-cy="menu-dialog-surrender-button"]',
      ) as HTMLButtonElement,
    );
    await user.click(
      document.querySelector(
        '[data-cy="menu-dialog-surrender-confirm-button"]',
      ) as HTMLButtonElement,
    );

    expect(onsurrender).toHaveBeenCalledTimes(1);
    expect(onclose).not.toHaveBeenCalled();
    expect(document.querySelector('[data-cy="menu-dialog"]')).not.toBeNull();
    const failure = document.querySelector(
      '[data-cy="menu-dialog-surrender-error"]',
    );
    expect(failure?.getAttribute("role")).toBe("alert");
    expect(failure?.textContent).toContain("could not");
    expect(
      document.querySelector(
        '[data-cy="menu-dialog-surrender-confirm-button"]',
      ),
    ).not.toBeNull();
  });

  it("clears a surrender failure when the player keeps playing", async () => {
    const user = userEvent.setup();
    render(MenuDialog, {
      surrenderAvailable: true,
      responsePending: false,
      onopensettings: vi.fn(),
      onsurrender: vi.fn(() => false),
      onclose: vi.fn(),
    });

    await user.click(
      document.querySelector(
        '[data-cy="menu-dialog-surrender-button"]',
      ) as HTMLButtonElement,
    );
    await user.click(
      document.querySelector(
        '[data-cy="menu-dialog-surrender-confirm-button"]',
      ) as HTMLButtonElement,
    );
    await user.click(
      document.querySelector(
        '[data-cy="menu-dialog-surrender-cancel-button"]',
      ) as HTMLButtonElement,
    );
    await user.click(
      document.querySelector(
        '[data-cy="menu-dialog-surrender-button"]',
      ) as HTMLButtonElement,
    );

    expect(
      document.querySelector('[data-cy="menu-dialog-surrender-error"]'),
    ).toBeNull();
  });

  it("hides surrender when unavailable", () => {
    render(MenuDialog, {
      surrenderAvailable: false,
      responsePending: false,
      onopensettings: vi.fn(),
      onsurrender: vi.fn(() => true),
      onclose: vi.fn(),
    });

    expect(
      document.querySelector('[data-cy="menu-dialog-surrender-button"]'),
    ).toBeNull();
  });

  it("disables the confirm button while a response is pending", async () => {
    const user = userEvent.setup();
    render(MenuDialog, {
      surrenderAvailable: true,
      responsePending: true,
      onopensettings: vi.fn(),
      onsurrender: vi.fn(() => true),
      onclose: vi.fn(),
    });

    await user.click(
      document.querySelector(
        '[data-cy="menu-dialog-surrender-button"]',
      ) as HTMLButtonElement,
    );
    const confirmButton = document.querySelector(
      '[data-cy="menu-dialog-surrender-confirm-button"]',
    ) as HTMLButtonElement;
    expect(confirmButton.disabled).toBe(true);
  });

  it("closes on Escape", () => {
    const onclose = vi.fn();
    render(MenuDialog, {
      surrenderAvailable: false,
      responsePending: false,
      onopensettings: vi.fn(),
      onsurrender: vi.fn(() => true),
      onclose,
    });

    fireEvent.keyDown(document, { key: "Escape" });
    expect(onclose).toHaveBeenCalledTimes(1);
  });

  it("closes on backdrop click", async () => {
    const user = userEvent.setup();
    const onclose = vi.fn();
    render(MenuDialog, {
      surrenderAvailable: false,
      responsePending: false,
      onopensettings: vi.fn(),
      onsurrender: vi.fn(() => true),
      onclose,
    });

    await user.click(
      document.querySelector('[data-cy="menu-dialog-backdrop"]') as HTMLElement,
    );
    expect(onclose).toHaveBeenCalledTimes(1);
  });
});

describe("SettingsDialog", () => {
  it("renders exact display rows and reports independent toggles", async () => {
    const user = userEvent.setup();
    const onshowzoneoutlines = vi.fn();
    const onshowzonecounts = vi.fn();
    render(SettingsDialog, {
      settings: {
        showDuelHud: false,
        showWorkspace: false,
        autoPlaceCards: true,
        autoResolveTrivialPrompts: true,
        fullControl: false,
        showZoneOutlines: true,
        showZoneCounts: false,
        showCardShadows: true,
        showZoneLabels: true,
      },
      onshowduelhud: vi.fn(),
      onshowworkspace: vi.fn(),
      onautoplacecards: vi.fn(),
      onautoresolvetrivialprompts: vi.fn(),
      onshowzoneoutlines,
      onshowzonecounts,
      onshowcardshadows: vi.fn(),
      onshowzonelabels: vi.fn(),
      onreset: vi.fn(),
      onclose: vi.fn(),
    });
    expect(
      document.querySelector('[data-cy="settings-show-zone-outlines-label"]')
        ?.textContent,
    ).toContain("Draw the dashed square footprint of every zone.");
    expect(
      document.querySelector(
        '[data-cy="settings-show-zone-counts-description"]',
      )?.textContent,
    ).toBe(
      "Show the number of cards in Deck, Extra Deck, GY, Banished and both hands.",
    );
    await user.click(
      document.querySelector(
        '[data-cy="settings-show-zone-outlines-checkbox"]',
      ) as HTMLInputElement,
    );
    await user.click(
      document.querySelector(
        '[data-cy="settings-show-zone-counts-checkbox"]',
      ) as HTMLInputElement,
    );
    expect(onshowzoneoutlines).toHaveBeenCalledWith(false);
    expect(onshowzonecounts).toHaveBeenCalledWith(true);
  });

  it("reflects the current settings state", () => {
    render(SettingsDialog, {
      settings: {
        showDuelHud: true,
        showWorkspace: false,
        autoPlaceCards: true,
        autoResolveTrivialPrompts: true,
        fullControl: false,
        showZoneOutlines: true,
        showZoneCounts: true,
        showCardShadows: true,
        showZoneLabels: true,
      },
      coreVersion: null,
      activeSnapshotId: null,
      fallbackSnapshotId: null,
      onshowduelhud: vi.fn(),
      onshowworkspace: vi.fn(),
      onautoplacecards: vi.fn(),
      onautoresolvetrivialprompts: vi.fn(),
      onshowzoneoutlines: vi.fn(),
      onshowzonecounts: vi.fn(),
      onshowcardshadows: vi.fn(),
      onshowzonelabels: vi.fn(),
      onreset: vi.fn(),
      onclose: vi.fn(),
    });

    const hudCheckbox = document.querySelector(
      '[data-cy="settings-show-duel-hud-checkbox"]',
    ) as HTMLInputElement;
    const workspaceCheckbox = document.querySelector(
      '[data-cy="settings-show-workspace-checkbox"]',
    ) as HTMLInputElement;
    expect(hudCheckbox.checked).toBe(true);
    expect(workspaceCheckbox.checked).toBe(false);
  });

  it("exposes the auto-place and auto-resolve toggles", () => {
    render(SettingsDialog, {
      settings: {
        showDuelHud: false,
        showWorkspace: false,
        autoPlaceCards: true,
        autoResolveTrivialPrompts: true,
        fullControl: false,
        showZoneOutlines: true,
        showZoneCounts: true,
        showCardShadows: true,
        showZoneLabels: true,
      },
      coreVersion: null,
      activeSnapshotId: null,
      fallbackSnapshotId: null,
      onshowduelhud: vi.fn(),
      onshowworkspace: vi.fn(),
      onautoplacecards: vi.fn(),
      onautoresolvetrivialprompts: vi.fn(),
      onshowzoneoutlines: vi.fn(),
      onshowzonecounts: vi.fn(),
      onshowcardshadows: vi.fn(),
      onshowzonelabels: vi.fn(),
      onreset: vi.fn(),
      onclose: vi.fn(),
    });

    const autoPlaceCheckbox = document.querySelector(
      '[data-cy="settings-auto-place-cards-checkbox"]',
    ) as HTMLInputElement;
    const autoResolveCheckbox = document.querySelector(
      '[data-cy="settings-auto-resolve-checkbox"]',
    ) as HTMLInputElement;
    expect(autoPlaceCheckbox.checked).toBe(true);
    expect(autoResolveCheckbox.checked).toBe(true);
  });

  it("reports auto-resolve toggling through its callback", async () => {
    const user = userEvent.setup();
    const onautoresolvetrivialprompts = vi.fn();
    render(SettingsDialog, {
      settings: {
        showDuelHud: false,
        showWorkspace: false,
        autoPlaceCards: true,
        autoResolveTrivialPrompts: true,
        fullControl: false,
        showZoneOutlines: true,
        showZoneCounts: true,
        showCardShadows: true,
        showZoneLabels: true,
      },
      coreVersion: null,
      activeSnapshotId: null,
      fallbackSnapshotId: null,
      onshowduelhud: vi.fn(),
      onshowworkspace: vi.fn(),
      onautoplacecards: vi.fn(),
      onautoresolvetrivialprompts,
      onshowzoneoutlines: vi.fn(),
      onshowzonecounts: vi.fn(),
      onshowcardshadows: vi.fn(),
      onshowzonelabels: vi.fn(),
      onreset: vi.fn(),
      onclose: vi.fn(),
    });

    await user.click(
      document.querySelector(
        '[data-cy="settings-auto-resolve-checkbox"]',
      ) as HTMLInputElement,
    );
    expect(onautoresolvetrivialprompts).toHaveBeenCalledTimes(1);
    expect(onautoresolvetrivialprompts).toHaveBeenCalledWith(false);
  });

  it("reports toggles through callbacks", async () => {
    const user = userEvent.setup();
    const onshowworkspace = vi.fn();
    render(SettingsDialog, {
      settings: {
        showDuelHud: false,
        showWorkspace: false,
        autoPlaceCards: true,
        autoResolveTrivialPrompts: true,
        fullControl: false,
        showZoneOutlines: true,
        showZoneCounts: true,
        showCardShadows: true,
        showZoneLabels: true,
      },
      coreVersion: null,
      activeSnapshotId: null,
      fallbackSnapshotId: null,
      onshowduelhud: vi.fn(),
      onshowworkspace,
      onautoplacecards: vi.fn(),
      onautoresolvetrivialprompts: vi.fn(),
      onshowzoneoutlines: vi.fn(),
      onshowzonecounts: vi.fn(),
      onshowcardshadows: vi.fn(),
      onshowzonelabels: vi.fn(),
      onreset: vi.fn(),
      onclose: vi.fn(),
    });

    await user.click(
      document.querySelector(
        '[data-cy="settings-show-workspace-checkbox"]',
      ) as HTMLInputElement,
    );
    expect(onshowworkspace).toHaveBeenCalledTimes(1);
    expect(onshowworkspace).toHaveBeenCalledWith(true);
  });

  it("shows engine build and snapshot info", () => {
    render(SettingsDialog, {
      settings: {
        showDuelHud: false,
        showWorkspace: false,
        autoPlaceCards: true,
        autoResolveTrivialPrompts: true,
        fullControl: false,
        showZoneOutlines: true,
        showZoneCounts: true,
        showCardShadows: true,
        showZoneLabels: true,
      },
      coreVersion: [11, 0],
      activeSnapshotId: "abc123def456ghi",
      fallbackSnapshotId: null,
      onshowduelhud: vi.fn(),
      onshowworkspace: vi.fn(),
      onautoplacecards: vi.fn(),
      onautoresolvetrivialprompts: vi.fn(),
      onshowzoneoutlines: vi.fn(),
      onshowzonecounts: vi.fn(),
      onshowcardshadows: vi.fn(),
      onshowzonelabels: vi.fn(),
      onreset: vi.fn(),
      onclose: vi.fn(),
    });

    expect(
      document.querySelector('[data-cy="settings-engine-version"]')
        ?.textContent,
    ).toContain("ocgcore 11.0");
    expect(
      document.querySelector('[data-cy="settings-active-snapshot"]')
        ?.textContent,
    ).toContain("abc123def456");
  });
});
