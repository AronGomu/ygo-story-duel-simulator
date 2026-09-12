// @vitest-environment jsdom

import "fake-indexeddb/auto";
import { cleanup, fireEvent, render } from "@testing-library/svelte";
import { tick } from "svelte";
import { afterEach, describe, expect, it, vi } from "vitest";
import AppShell from "../../src/shell/AppShell.svelte";
import type { DomainLoaders } from "../../src/shell/domain-loaders.ts";
import { createShellStore } from "../../src/shell/shell-store.ts";
import type { CoreBootstrap } from "../../src/content/index.ts";
import type { CoreGate } from "../../src/shell/core/core-gate.ts";

const bootstrap: CoreBootstrap = {
  schemaVersion: 1,
  appSchemaVersion: 1,
  contentSchemaVersion: 2,
  hashAlgorithm: "SHA-256",
  delivery: null,
  chapters: [
    {
      id: "chapter-01",
      title: "DM",
      description: "Current Chapter 1 prototype.",
    },
  ],
};
const locked: CoreGate = { kind: "locked", reason: "content-required" };

const query = (cy: string): HTMLElement | null =>
  document.querySelector(`[data-cy="${cy}"]`);

afterEach(cleanup);

describe("asset-free CORE menu", () => {
  it("keeps settings and installer usable while gameplay stays visibly disabled", async () => {
    const hashes: string[] = [];
    const store = createShellStore("#/", (hash) => hashes.push(hash));
    const loaders: DomainLoaders = {
      duel: vi.fn(),
      decks: vi.fn(),
      story: vi.fn(),
    } as unknown as DomainLoaders;
    render(AppShell, {
      store,
      loaders,
      initialCoreGate: locked,
      initialCoreBootstrap: bootstrap,
    });

    for (const cy of [
      "main-menu-new-game",
      "main-menu-continue",
      "main-menu-load",
      "main-menu-free-play",
    ])
      expect(query(cy)).toHaveProperty("disabled", true);
    expect(query("core-gate-status")?.textContent).toContain(
      "Content is required",
    );

    await fireEvent.pointerEnter(query("main-menu-free-play")!);
    await fireEvent.focus(query("main-menu-free-play")!);
    expect(loaders.duel).not.toHaveBeenCalled();

    await fireEvent.click(query("main-menu-settings")!);
    expect(query("shell-settings-dialog")).not.toBeNull();
    expect(query("shell-settings-content-status")?.textContent).toContain(
      "Content is required",
    );

    await fireEvent.click(query("shell-settings-close")!);
    await fireEvent.click(query("main-menu-install-content")!);
    expect(hashes).toStrictEqual(["#/install-content"]);
    expect(query("install-content-screen")).not.toBeNull();
    expect(query("install-content-chapter-chapter-01")?.textContent).toContain(
      "DM",
    );
    expect(loaders.duel).not.toHaveBeenCalled();
    expect(loaders.decks).not.toHaveBeenCalled();
    expect(loaders.story).not.toHaveBeenCalled();
  });

  it.each(["#/free-play", "#/story", "#/admin", "#/duel/session/direct"])(
    "redirects locked direct route %s before any domain loader",
    async (hash) => {
      const hashes: Array<{ hash: string; replace: boolean }> = [];
      const loaders: DomainLoaders = {
        duel: vi.fn(),
        decks: vi.fn(),
        story: vi.fn(),
      } as unknown as DomainLoaders;
      render(AppShell, {
        store: createShellStore(hash, (next, replace) =>
          hashes.push({ hash: next, replace }),
        ),
        loaders,
        initialCoreGate: locked,
        initialCoreBootstrap: bootstrap,
      });
      await tick();

      expect(query("install-content-screen")).not.toBeNull();
      expect(hashes).toContainEqual({
        hash: "#/install-content",
        replace: true,
      });
      expect(loaders.duel).not.toHaveBeenCalled();
      expect(loaders.decks).not.toHaveBeenCalled();
      expect(loaders.story).not.toHaveBeenCalled();
    },
  );
});
