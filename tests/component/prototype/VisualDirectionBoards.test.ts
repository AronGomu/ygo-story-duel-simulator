// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from "@testing-library/svelte";
import { userEvent } from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";
import VisualDirectionBoards from "../../../src/prototype/components/VisualDirectionBoards.svelte";

afterEach(() => cleanup());

describe("VisualDirectionBoards", () => {
  it("compares exactly three named directions using shared content and tradeoffs", () => {
    render(VisualDirectionBoards);
    const radios = screen.getAllByRole("radio");
    expect(radios).toHaveLength(3);
    for (const name of [
      "Existing client continuity",
      "Duel-anime broadcast",
      "Cinematic visual novel",
    ])
      expect(
        screen.getByRole("radio", { name: new RegExp(name, "i") }),
      ).toBeTruthy();
    expect(screen.getAllByText("The Signal Beneath the City")).toHaveLength(3);
    expect(screen.getAllByText(/You came/)).toHaveLength(3);
    expect(screen.getAllByText(/Old Arena/)).toHaveLength(3);
    expect(screen.getAllByText(/Benefit:/)).toHaveLength(3);
    expect(screen.getAllByText(/Risk:/)).toHaveLength(3);
    expect(radios[0]?.getAttribute("aria-checked")).toBe("true");
  });

  it("supports keyboard selection with semantic selected state", async () => {
    render(VisualDirectionBoards);
    const cinematic = screen.getByRole("radio", {
      name: /Cinematic visual novel/i,
    });
    cinematic.focus();
    await userEvent.setup().keyboard(" ");
    await waitFor(() =>
      expect(cinematic.getAttribute("aria-checked")).toBe("true"),
    );
  });
});
