// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/svelte";
import { userEvent } from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import YdkExport from "../../../src/prototypes/deck-builder/components/YdkExport.svelte";
import { deckFixture } from "../../fixtures/deck-builder.ts";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("YDK export UI", () => {
  it("warns but exports invalid drafts through clipboard", async () => {
    const user = userEvent.setup();
    const writeText = vi
      .spyOn(navigator.clipboard, "writeText")
      .mockResolvedValue(undefined);
    render(YdkExport, { deck: deckFixture(), oncancel: vi.fn() });
    expect(screen.getByRole("alert").textContent).toContain("invalid");
    expect(screen.getByDisplayValue("Prototype-Control.ydk")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Copy YDK text" }));
    expect(writeText).toHaveBeenCalledWith(expect.stringContaining("#main"));
    expect(screen.getByRole("status").textContent).toContain("copied");
  });

  it("downloads deterministic YDK text", async () => {
    const user = userEvent.setup();
    Object.defineProperty(URL, "createObjectURL", {
      configurable: true,
      value: vi.fn(() => "blob:deck"),
    });
    Object.defineProperty(URL, "revokeObjectURL", {
      configurable: true,
      value: vi.fn(),
    });
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(
      () => undefined,
    );
    render(YdkExport, { deck: deckFixture(), oncancel: vi.fn() });
    await user.click(screen.getByRole("button", { name: "Download .ydk" }));
    expect(URL.createObjectURL).toHaveBeenCalled();
    expect(screen.getByRole("status").textContent).toContain(
      "Downloaded Prototype-Control.ydk",
    );
  });

  it("shows download failure without closing", async () => {
    const user = userEvent.setup();
    Object.defineProperty(URL, "createObjectURL", {
      configurable: true,
      value: vi.fn(() => {
        throw new Error("blocked");
      }),
    });
    render(YdkExport, { deck: deckFixture(), oncancel: vi.fn() });
    await user.click(screen.getByRole("button", { name: "Download .ydk" }));
    expect(screen.getByRole("status").textContent).toContain(
      "Download failed: blocked",
    );
  });

  it("shows clipboard failure without closing", async () => {
    const user = userEvent.setup();
    vi.spyOn(navigator.clipboard, "writeText").mockRejectedValue(
      new Error("denied"),
    );
    render(YdkExport, { deck: deckFixture(), oncancel: vi.fn() });
    await user.click(screen.getByRole("button", { name: "Copy YDK text" }));
    expect(screen.getByRole("status").textContent).toContain(
      "Copy failed: denied",
    );
  });
});
