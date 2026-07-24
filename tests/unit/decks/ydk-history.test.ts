// @vitest-environment node

import "fake-indexeddb/auto";
import { afterEach, describe, expect, it } from "vitest";
import { deleteDB } from "idb";
import { get } from "svelte/store";
import { importYdk } from "../../../src/decks/ydk-adapter.ts";
import { IndexedDbDeckRepository } from "../../../src/decks/indexeddb-deck-repository.ts";
import { DeckBuilderController } from "../../../src/prototypes/deck-builder/deck-builder-store.ts";
import {
  catalogByCode,
  PROTOTYPE_RULESET,
} from "../../../src/decks/catalog/pinned-ruleset.ts";
import { PROTOTYPE_CATALOG } from "../../../src/prototypes/deck-builder/fixtures/catalog.ts";

const names: string[] = [];
afterEach(async () =>
  Promise.all(names.splice(0).map((name) => deleteDB(name))),
);

describe("YDK history integration", () => {
  it("records a whole import as one card update", async () => {
    const parsed = importYdk(
      "#main\n89631139\n46986414\n#extra\n8505920\n!side\n",
    );
    expect(parsed.type).toBe("ready");
    if (parsed.type !== "ready") return;
    const name = "ydk-history";
    names.push(name);
    const repo = await IndexedDbDeckRepository.open(name);
    const controller = new DeckBuilderController(
      repo,
      catalogByCode(PROTOTYPE_CATALOG),
      PROTOTYPE_RULESET,
    );
    await controller.initialize();
    await controller.createDeck("Import");
    await controller.mutate({ type: "import", cards: parsed.cards });
    expect(get(controller).current?.history.undo).toHaveLength(1);
    expect(get(controller).current?.history.undo[0]?.reason).toBe("import");
    repo.close();
  });
});
