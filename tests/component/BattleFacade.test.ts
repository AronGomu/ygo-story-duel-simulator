// @vitest-environment jsdom

import { cleanup, fireEvent, render } from "@testing-library/svelte";
import { tick } from "svelte";
import { userEvent } from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

const diagnosticsSpies = vi.hoisted(() => ({ download: vi.fn() }));

vi.mock("../../src/battle/app/diagnostics/download-diagnostics.ts", () => ({
  downloadDuelDiagnostics: diagnosticsSpies.download,
}));

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
  return {
    dispose: vi.fn(),
    requestDiagnostics: vi.fn(),
    restore: vi.fn(),
    startDuel: vi.fn(),
  };
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

    respond() {
      return false;
    }

    surrender() {
      return false;
    }

    diagnosticsAccepted = false;
    restoreAccepted = true;

    requestDiagnostics() {
      workerClientSpies.requestDiagnostics();
      return this.diagnosticsAccepted;
    }

    restore() {
      workerClientSpies.restore();
      return this.restoreAccepted;
    }

    async replace() {
      this.context = {
        workerGeneration: this.context.workerGeneration + 1,
        sessionGeneration: 0,
      };
      return { graceful: true };
    }

    async dispose() {
      workerClientSpies.dispose();
      return { graceful: true };
    }
  }

  return { DuelWorkerClient: DuelWorkerClientMock };
});

import { DuelWorkerClient as MockedDuelWorkerClient } from "../../src/battle/app/DuelWorkerClient.ts";
import {
  BattleFacade,
  parseBattleRequest,
  type BattleFacadeResult,
} from "../../src/battle/index.ts";
import type { DuelDiagnosticTrace } from "../../src/battle/duel/contracts/duel-diagnostics.ts";
import type { DuelResult } from "../../src/battle/duel/contracts/duel-result.ts";
import type { PlayerPrompt } from "../../src/battle/duel/contracts/player-prompt.ts";
import {
  choiceId,
  promptId,
  snapshotId,
} from "../../src/battle/duel/contracts/ids.ts";

interface MockedWorkerInstance {
  readonly context: { workerGeneration: number; sessionGeneration: number };
  readonly listeners: Set<(received: unknown) => void>;
  diagnosticsAccepted: boolean;
  restoreAccepted: boolean;
}
interface MockedWorkerClientCtor {
  instances: MockedWorkerInstance[];
}

const mockedWorkerClientCtor =
  MockedDuelWorkerClient as unknown as MockedWorkerClientCtor;

const HOSTED_REQUEST = parseBattleRequest({
  player: { kind: "preset", deckId: "chapter-one-starter" },
  opponent: { kind: "preset", deckId: "chapter-one-practice" },
});

const RESTORED_PROMPT: PlayerPrompt = {
  id: promptId("restored-decision"),
  kind: "yesNo",
  player: 0,
  title: "Activate the effect?",
  choices: [
    { id: choiceId("restored-yes"), label: "Yes", action: "yes" },
    { id: choiceId("restored-no"), label: "No", action: "no" },
  ],
  minimum: 1,
  maximum: 1,
  cancelable: false,
  ordered: false,
};

const TRACE: DuelDiagnosticTrace = {
  schemaVersion: 2,
  sensitivity: "contains-production-seed",
  presetId: "mvp-preset-v1",
  snapshotId: snapshotId("a".repeat(64)),
  seed: ["1", "2", "3", "4"],
  coreVersion: [11, 0],
  revisions: {
    enginePackage: "ocgcore-wasm",
    engineVersion: "0.1.2",
    babelCdb: "babel",
    cardScripts: "scripts",
    distribution: "strings",
    activeImageManifestSha256: "b".repeat(64),
  },
  entries: [{ sequence: 1, kind: "message", messageType: 15 }],
};

afterEach(() => {
  cleanup();
  localStorage.clear();
  workerClientSpies.dispose.mockReset();
  workerClientSpies.requestDiagnostics.mockReset();
  workerClientSpies.restore.mockReset();
  workerClientSpies.startDuel.mockReset();
  diagnosticsSpies.download.mockReset();
  mockedWorkerClientCtor.instances.length = 0;
});

function latestWorker(): MockedWorkerInstance {
  const worker =
    mockedWorkerClientCtor.instances[
      mockedWorkerClientCtor.instances.length - 1
    ];
  if (worker === undefined) throw new Error("No mocked worker client instance");
  return worker;
}

function emit(event: unknown): void {
  const worker = latestWorker();
  for (const listener of worker.listeners)
    listener({ context: worker.context, event });
}

function emitResult(result: DuelResult): void {
  emit({ type: "result", result });
}

function emitFatalWorkerError(): void {
  emit({
    type: "error",
    error: {
      code: "worker_error",
      message: "Unable to initialize the Duel Worker",
      recoverable: false,
    },
  });
}

/* The rejection the recovery dialog exists for: `canRestore` rides the error
   itself, because the response that killed the duel is recorded during the
   very command that fails and no state event follows it (ADR-048). */
function emitRejectedResponse(canRestore?: boolean): void {
  emit({
    type: "error",
    error: {
      code: "engine_error",
      message: "ocgcore rejected the previous response",
      recoverable: false,
    },
    ...(canRestore === undefined ? {} : { canRestore }),
  });
}

function element(dataCy: string): HTMLElement {
  const found = document.querySelector<HTMLElement>(`[data-cy="${dataCy}"]`);
  if (found === null) throw new Error(`Missing ${dataCy}`);
  return found;
}

async function startDuelFromPicker(
  user: ReturnType<typeof userEvent.setup>,
): Promise<void> {
  await user.selectOptions(
    element("deck-picker-player-select") as HTMLSelectElement,
    "preset:chapter-one-starter",
  );
  await user.click(element("deck-picker-start-button"));
}

/* A started duel is the only state the recovery dialog is reachable from: it
   is what gives the session a trace to download and a duel to rebuild. */
async function failStartedDuel(
  canRestore?: boolean,
): Promise<ReturnType<typeof userEvent.setup>> {
  const user = userEvent.setup();
  await renderFacade(null, vi.fn());
  await startDuelFromPicker(user);

  emitRejectedResponse(canRestore);
  await vi.waitFor(() =>
    expect(
      document.querySelector('[data-cy="duel-error-dialog"]'),
    ).not.toBeNull(),
  );
  return user;
}

/* T17 reversal: a request used to be inert — the facade read it only to decide
   whether a result was owed, and every render, hosted or not, waited on the
   duel's own picker. A request now starts the duel it names, so a hosted render
   waits on the dispatch instead; the picker it no longer opens is what
   `starts a host request without opening its own picker` asserts. */
async function renderFacade(
  request: ReturnType<typeof parseBattleRequest> | null,
  oncomplete: (result: BattleFacadeResult) => void,
) {
  const rendered = render(BattleFacade, { request, oncomplete });
  await vi.waitFor(() =>
    request === null
      ? expect(document.querySelector('[data-cy="deck-picker"]')).not.toBeNull()
      : expect(workerClientSpies.startDuel).toHaveBeenCalled(),
  );
  return rendered;
}

describe("BattleFacade", () => {
  it("mounts the duel inside the battle root", async () => {
    await renderFacade(null, vi.fn());

    const root = document.querySelector('[data-cy="battle-root"]');
    expect(root).not.toBeNull();
    expect(root?.querySelector('[data-cy="app-main"]')).not.toBeNull();
    expect(root?.querySelector('[data-cy="deck-picker"]')).not.toBeNull();
    expect(mockedWorkerClientCtor.instances).toHaveLength(1);
  });

  /* The decks were chosen one screen ago. Asking again would discard the
     opponent the host picked, since the duel's own picker fixes that seat. */
  it("starts a host request without opening its own picker", async () => {
    await renderFacade(HOSTED_REQUEST, vi.fn());

    expect(workerClientSpies.startDuel).toHaveBeenCalledTimes(1);
    expect(workerClientSpies.startDuel).toHaveBeenCalledWith(
      "bundled-v1:chapter-one-starter:vs:chapter-one-practice",
      { kind: "preset", deckId: "chapter-one-starter" },
      { kind: "preset", deckId: "chapter-one-practice" },
    );
    expect(document.querySelector('[data-cy="deck-picker"]')).toBeNull();
  });

  /* Standalone mode is today's `#/duel`: the duel owns its picker and reports
     nothing outwards, so the shell keeps behaving exactly as before. */
  it("never reports completion in standalone mode", async () => {
    const oncomplete = vi.fn();
    await renderFacade(null, oncomplete);

    emitResult({ type: "completed", winner: 0, loser: 1, reason: 1 });
    await vi.waitFor(() =>
      expect(
        document.querySelector('[data-cy="duel-result-dialog"]'),
      ).not.toBeNull(),
    );

    expect(oncomplete).not.toHaveBeenCalled();
  });

  it("settles a hosted session exactly once", async () => {
    const oncomplete = vi.fn();
    await renderFacade(HOSTED_REQUEST, oncomplete);

    emitResult({ type: "completed", winner: 0, loser: 1, reason: 1 });
    emitResult({ type: "completed", winner: 1, loser: 0, reason: 1 });
    await vi.waitFor(() => expect(oncomplete).toHaveBeenCalled());

    expect(oncomplete).toHaveBeenCalledTimes(1);
    expect(oncomplete).toHaveBeenCalledWith({
      kind: "resolved",
      outcome: "player-win",
    });
  });

  it("maps a fatal worker error to a failure, never to a resolved loss", async () => {
    const oncomplete = vi.fn();
    await renderFacade(HOSTED_REQUEST, oncomplete);

    emitFatalWorkerError();
    await vi.waitFor(() => expect(oncomplete).toHaveBeenCalled());

    expect(oncomplete).toHaveBeenCalledTimes(1);
    expect(oncomplete).toHaveBeenCalledWith({
      kind: "failed",
      message: "Unable to initialize the Duel Worker",
    });
  });

  /* Navigating away mid-duel still owes the host one result, or a story would
     wait forever on a duel that no longer exists. */
  it("settles a hosted session that is unmounted before it finishes", async () => {
    const oncomplete = vi.fn();
    const { unmount } = await renderFacade(HOSTED_REQUEST, oncomplete);

    unmount();

    expect(oncomplete).toHaveBeenCalledTimes(1);
    expect(oncomplete).toHaveBeenCalledWith({
      kind: "aborted",
      reason: "exit",
    });
  });

  it("disposes the duel worker client exactly once on unmount", async () => {
    const { unmount } = await renderFacade(null, vi.fn());

    unmount();
    await vi.waitFor(() =>
      expect(workerClientSpies.dispose).toHaveBeenCalledTimes(1),
    );

    expect(mockedWorkerClientCtor.instances).toHaveLength(1);
  });

  it("a fatal error opens the recovery dialog", async () => {
    await failStartedDuel();

    expect(element("duel-error-dialog").getAttribute("role")).toBe("dialog");
    expect(element("duel-error-dialog").getAttribute("aria-modal")).toBe(
      "true",
    );
    expect(element("duel-error-heading").textContent).toBe(
      "ocgcore rejected the previous response",
    );
    expect(element("duel-error-code").textContent).toContain("engine_error");
    expect(element("duel-error-sensitive-note").textContent).toContain("seed");
    expect(document.activeElement).toBe(element("duel-error-heading"));
    /* The in-flow panel is the recoverable path only; a dead duel is modal. */
    expect(document.querySelector('[data-cy="app-error-panel"]')).toBeNull();
  });

  it("restore is hidden when the trace holds no human response", async () => {
    await failStartedDuel();

    expect(
      document.querySelector('[data-cy="duel-error-restore-button"]'),
    ).toBeNull();
    expect(element("duel-error-retry-button")).toBeDefined();
    expect(element("duel-error-download-button")).toBeDefined();
  });

  it("restore calls the worker and closes on success", async () => {
    const user = await failStartedDuel(true);

    await user.click(element("duel-error-restore-button"));
    expect(workerClientSpies.restore).toHaveBeenCalledTimes(1);

    emit({ type: "restored" });
    emit({ type: "prompt", prompt: RESTORED_PROMPT });

    await vi.waitFor(() =>
      expect(
        document.querySelector('[data-cy="duel-error-dialog"]'),
      ).toBeNull(),
    );
    expect(element("prompt-controls-heading").textContent).toBe(
      "Activate the effect?",
    );
  });

  it("a failed restore keeps the dialog open", async () => {
    const user = await failStartedDuel(true);

    await user.click(element("duel-error-restore-button"));
    emit({ type: "restore_failed", reason: "replay_diverged" });

    await vi.waitFor(() =>
      expect(
        document.querySelector('[data-cy="duel-error-restore-failure"]'),
      ).not.toBeNull(),
    );
    expect(element("duel-error-dialog")).toBeDefined();
    expect(element("duel-error-restore-failure").textContent).toContain(
      "different",
    );
    /* The offer that just proved impossible goes away; the report does not. */
    expect(
      document.querySelector('[data-cy="duel-error-restore-button"]'),
    ).toBeNull();
    expect(
      (element("duel-error-download-button") as HTMLButtonElement).disabled,
    ).toBe(false);
  });

  /* A refusal is answered by the client, not the Worker, so nothing comes back
     to say it happened. Silence here is the failure this dialog exists to
     prevent. */
  it("a restore the client refuses says so instead of doing nothing", async () => {
    const user = await failStartedDuel(true);
    latestWorker().restoreAccepted = false;

    await user.click(element("duel-error-restore-button"));

    await vi.waitFor(() =>
      expect(
        document.querySelector('[data-cy="duel-error-restore-failure"]'),
      ).not.toBeNull(),
    );
    expect(element("duel-error-restore-failure").textContent).toContain(
      "could not be handed back to the engine",
    );
    expect(element("duel-error-dialog")).toBeDefined();
    expect(
      (element("duel-error-restore-button") as HTMLButtonElement).disabled,
    ).toBe(false);
  });

  it("download still works from the dialog", async () => {
    const user = await failStartedDuel(true);
    latestWorker().diagnosticsAccepted = true;

    await user.click(element("duel-error-download-button"));
    expect(workerClientSpies.requestDiagnostics).toHaveBeenCalledTimes(1);
    emit({ type: "diagnostics", trace: TRACE });

    await vi.waitFor(() =>
      expect(diagnosticsSpies.download).toHaveBeenCalledTimes(1),
    );
    expect(element("duel-error-message").textContent).toContain(
      "Diagnostics downloaded",
    );
  });

  /* The Worker pushes a trace nobody asked for when it reports that its own
     cleanup was uncertain. That push carries the production seed, so it must
     not reach the disk on its own. */
  it("an unsolicited diagnostics push writes no file", async () => {
    await failStartedDuel(true);

    emit({ type: "diagnostics", trace: TRACE });
    await tick();

    expect(diagnosticsSpies.download).not.toHaveBeenCalled();
    expect(document.querySelector('[data-cy="duel-error-message"]')).toBeNull();
  });

  /* The same failure replaces the Worker, so the client refuses every later
     request: the pushed trace is the only copy that will ever exist, and the
     button falls back to that one once the refusal comes back. */
  it("the dialog's download button serves the held push", async () => {
    const user = await failStartedDuel(true);
    latestWorker().diagnosticsAccepted = false;
    emit({ type: "diagnostics", trace: TRACE });
    await tick();

    await user.click(element("duel-error-download-button"));

    await vi.waitFor(() =>
      expect(diagnosticsSpies.download).toHaveBeenCalledTimes(1),
    );
    expect(diagnosticsSpies.download.mock.calls[0]?.[0]).toBe(TRACE);
    expect(workerClientSpies.requestDiagnostics).toHaveBeenCalledTimes(1);
    expect(element("duel-error-message").textContent).toContain(
      "Diagnostics downloaded",
    );
  });

  /* A restore puts the duel back into play and the store keeps the failure's
     trace, which now describes a duel that no longer exists. This session can
     still answer for itself, so the button must ask it rather than hand back
     what it is holding — a held-trace-first button writes the wrong duel's
     evidence to disk under a "downloaded" notice. */
  it("a restored duel asks for its own trace, not the failure's", async () => {
    const user = await failStartedDuel(true);
    latestWorker().diagnosticsAccepted = true;

    await user.click(element("duel-error-download-button"));
    emit({ type: "diagnostics", trace: TRACE });
    await vi.waitFor(() =>
      expect(diagnosticsSpies.download).toHaveBeenCalledTimes(1),
    );

    await user.click(element("duel-error-restore-button"));
    emit({ type: "restored" });
    emit({ type: "prompt", prompt: RESTORED_PROMPT });
    await vi.waitFor(() =>
      expect(
        document.querySelector('[data-cy="duel-error-dialog"]'),
      ).toBeNull(),
    );

    emitResult({ type: "completed", winner: 0, loser: 1, reason: 1 });
    await vi.waitFor(() =>
      expect(
        document.querySelector('[data-cy="duel-result-dialog"]'),
      ).not.toBeNull(),
    );

    await user.click(element("app-result-download-diagnostics-button"));

    expect(workerClientSpies.requestDiagnostics).toHaveBeenCalledTimes(2);
    expect(diagnosticsSpies.download).toHaveBeenCalledTimes(1);
  });

  /* The trace the failure left behind is not evidence about the duel that
     replaced it. Once a restore puts the player back in play, a later failure
     that the client cannot answer for owes them "unavailable", not the
     pre-restore trace written to disk under a "downloaded" notice. */
  it("a trace the restore left behind is never served to the duel after it", async () => {
    const user = await failStartedDuel(true);
    latestWorker().diagnosticsAccepted = true;

    await user.click(element("duel-error-download-button"));
    emit({ type: "diagnostics", trace: TRACE });
    await vi.waitFor(() =>
      expect(diagnosticsSpies.download).toHaveBeenCalledTimes(1),
    );

    await user.click(element("duel-error-restore-button"));
    emit({ type: "restored" });
    emit({ type: "prompt", prompt: RESTORED_PROMPT });
    await vi.waitFor(() =>
      expect(
        document.querySelector('[data-cy="duel-error-dialog"]'),
      ).toBeNull(),
    );

    /* The duel now dies for its own reason, and the Worker that replaced it
       has no session to report on, so every later request is refused. */
    latestWorker().diagnosticsAccepted = false;
    emitFatalWorkerError();
    await vi.waitFor(() =>
      expect(
        document.querySelector('[data-cy="duel-error-dialog"]'),
      ).not.toBeNull(),
    );

    await user.click(element("duel-error-download-button"));

    expect(diagnosticsSpies.download).toHaveBeenCalledTimes(1);
    expect(element("duel-error-message").textContent).toContain(
      "Diagnostics are unavailable for this session.",
    );
  });

  it("Escape does not dismiss a fatal dialog", async () => {
    await failStartedDuel(true);

    await fireEvent.keyDown(document.body, { key: "Escape" });

    expect(element("duel-error-dialog")).toBeDefined();
    expect(element("duel-error-restore-button")).toBeDefined();
  });
});
