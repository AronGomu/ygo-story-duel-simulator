import { PROLOGUE } from "../content/prologue.ts";
import {
  PROTOTYPE_SCREENS,
  type PrototypeState,
} from "../model/prototype-state.ts";

export const PROTOTYPE_STORAGE_KEY = "ygo-vn-prototype:review-state:v1";
export type PrototypeSaveSlot = "manual" | "autosave";
export type SaveResult =
  { readonly ok: true } | { readonly ok: false; readonly message: string };
export type PrototypeSlots = {
  readonly manual: PrototypeState | null;
  readonly autosave: PrototypeState | null;
  readonly latest: PrototypeSaveSlot | null;
};
export type LoadSlotsResult =
  | { readonly ok: true; readonly slots: PrototypeSlots }
  | { readonly ok: false; readonly message: string };

type StoredEnvelope = PrototypeSlots & { readonly schemaVersion: 1 };
const EMPTY_SLOTS: PrototypeSlots = {
  manual: null,
  autosave: null,
  latest: null,
};

export function loadPrototypeSlots(storage?: Storage): LoadSlotsResult {
  try {
    const target = storage ?? globalThis.localStorage;
    const raw = target.getItem(PROTOTYPE_STORAGE_KEY);
    if (raw === null) return { ok: true, slots: EMPTY_SLOTS };
    const value: unknown = JSON.parse(raw);
    if (!isStoredEnvelope(value))
      return { ok: false, message: "Prototype save data is invalid" };
    return {
      ok: true,
      slots: {
        manual: value.manual,
        autosave: value.autosave,
        latest: value.latest,
      },
    };
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : "Storage read failed",
    };
  }
}

export function savePrototypeState(
  state: PrototypeState,
  storage?: Storage,
  slot: PrototypeSaveSlot = "manual",
): SaveResult {
  try {
    const target = storage ?? globalThis.localStorage;
    const existing = loadPrototypeSlots(target);
    if (!existing.ok) return existing;
    const envelope: StoredEnvelope = {
      schemaVersion: 1,
      ...existing.slots,
      [slot]: state,
      latest: slot,
    };
    target.setItem(PROTOTYPE_STORAGE_KEY, JSON.stringify(envelope));
    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : "Storage write failed",
    };
  }
}

export function resetPrototypeStorage(
  storage?: Storage,
  slot?: PrototypeSaveSlot,
): SaveResult {
  try {
    const target = storage ?? globalThis.localStorage;
    if (slot === undefined) {
      target.removeItem(PROTOTYPE_STORAGE_KEY);
      return { ok: true };
    }
    const existing = loadPrototypeSlots(target);
    if (!existing.ok) return existing;
    const remaining: PrototypeSlots = {
      ...existing.slots,
      [slot]: null,
      latest:
        existing.slots.latest === slot
          ? slot === "manual"
            ? existing.slots.autosave === null
              ? null
              : "autosave"
            : existing.slots.manual === null
              ? null
              : "manual"
          : existing.slots.latest,
    };
    if (remaining.manual === null && remaining.autosave === null)
      target.removeItem(PROTOTYPE_STORAGE_KEY);
    else
      target.setItem(
        PROTOTYPE_STORAGE_KEY,
        JSON.stringify({ schemaVersion: 1, ...remaining }),
      );
    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : "Storage reset failed",
    };
  }
}

function isStoredEnvelope(value: unknown): value is StoredEnvelope {
  if (typeof value !== "object" || value === null) return false;
  const envelope = value as Record<string, unknown>;
  return (
    envelope.schemaVersion === 1 &&
    (envelope.manual === null || isPrototypeState(envelope.manual)) &&
    (envelope.autosave === null || isPrototypeState(envelope.autosave)) &&
    (envelope.latest === null ||
      envelope.latest === "manual" ||
      envelope.latest === "autosave") &&
    !(envelope.latest === "manual" && envelope.manual === null) &&
    !(envelope.latest === "autosave" && envelope.autosave === null)
  );
}

function isPrototypeState(value: unknown): value is PrototypeState {
  if (typeof value !== "object" || value === null) return false;
  const state = value as Record<string, unknown>;
  const screens = new Set<string>(PROTOTYPE_SCREENS);
  const choices = new Set([
    null,
    "trust-rin",
    "challenge-rin",
    "observe-first",
  ]);
  const outcomes = new Set([null, "win", "loss", "abort", "failure"]);
  if (
    typeof state.screen !== "string" ||
    !screens.has(state.screen) ||
    typeof state.savedScreen !== "string" ||
    !screens.has(state.savedScreen) ||
    typeof state.progressExists !== "boolean" ||
    !Number.isSafeInteger(state.narrativeIndex) ||
    (state.narrativeIndex as number) < 0 ||
    (state.narrativeIndex as number) >= PROLOGUE.beats.length ||
    !(
      state.lastInputId === null ||
      (Number.isSafeInteger(state.lastInputId) &&
        (state.lastInputId as number) >= 0)
    ) ||
    !choices.has(state.choice as null | string) ||
    !(
      state.choiceResponse === null || typeof state.choiceResponse === "string"
    ) ||
    !(
      state.laterAcknowledgment === null ||
      typeof state.laterAcknowledgment === "string"
    ) ||
    !outcomes.has(state.outcome as null | string) ||
    !(state.outcomeScene === null || typeof state.outcomeScene === "string") ||
    typeof state.rewardGranted !== "boolean" ||
    typeof state.rewardAcknowledged !== "boolean" ||
    typeof state.objective !== "string" ||
    !Array.isArray(state.locations)
  )
    return false;
  const locationIds = new Set<string>();
  const validLocations = state.locations.every((location) => {
    if (typeof location !== "object" || location === null) return false;
    const item = location as Record<string, unknown>;
    if (typeof item.id !== "string" || locationIds.has(item.id)) return false;
    locationIds.add(item.id);
    return (
      ["old-arena", "archive", "hidden-gate"].includes(item.id) &&
      typeof item.access === "string" &&
      ["available", "locked", "hidden"].includes(item.access) &&
      typeof item.completed === "boolean"
    );
  });
  return (
    validLocations && state.locations.length === 3 && locationIds.size === 3
  );
}
