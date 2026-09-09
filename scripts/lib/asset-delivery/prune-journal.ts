import type { InstallReceipt } from "./install-receipt.ts";
import type { PrunePlan } from "./prune-plan.ts";
import type { PublicationInventory } from "./publication-inventory.ts";

export interface PruneJournal {
  readonly schemaVersion: 1;
  readonly plan: PrunePlan;
  readonly phase: "prepared" | "deleting" | "committed";
  readonly intentPaths: readonly string[];
  readonly completedPaths: readonly string[];
  readonly nextState: PublicationInventory | null;
  readonly nextReceipt: InstallReceipt | null;
}

import { array, literal, nullable, object, version } from "./schema.ts";
import { parsePrunePlan } from "./prune-plan.ts";
import { parsePublicationInventory } from "./publication-inventory.ts";
import { parseInstallReceipt } from "./install-receipt.ts";
import { assertSafePath } from "./path-guards.ts";
import { fail } from "./failure.ts";
export function parsePruneJournal(value: unknown): PruneJournal {
  const journal = object(value, {
    schemaVersion: version,
    plan: parsePrunePlan,
    phase: literal("prepared", "deleting", "committed"),
    intentPaths: array(assertSafePath, (v) => v),
    completedPaths: array(assertSafePath, (v) => v),
    nextState: nullable(parsePublicationInventory),
    nextReceipt: nullable(parseInstallReceipt),
  });
  const paths = new Set(journal.plan.candidates.map((file) => file.path));
  const intents = new Set(journal.intentPaths);
  if (
    (journal.plan.scope === "local"
      ? journal.nextState !== null || journal.nextReceipt === null
      : journal.nextState === null || journal.nextReceipt !== null) ||
    journal.intentPaths.some((p) => !paths.has(p)) ||
    journal.completedPaths.some((p) => !intents.has(p)) ||
    (journal.phase === "prepared" && intents.size !== 0) ||
    (journal.phase === "committed" &&
      journal.completedPaths.length !== paths.size)
  )
    fail();
  return journal;
}
