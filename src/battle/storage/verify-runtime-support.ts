import { cardCode } from "../duel/contracts/ids.ts";
import {
  loadActiveDuelDependencies,
  type ActiveDuelAssetReader,
} from "../worker/assets/active-duel-dependencies.ts";

/** Declared support plus every indexed script/global must close over verified files. */
export async function verifyRuntimeSupport(
  reader: ActiveDuelAssetReader,
  codes: readonly number[],
): Promise<void> {
  const reject = (): never => {
    throw new Error("Runtime support closure is incomplete");
  };
  if (!codes.length) reject();
  const index = await reader.readJson<{
    official: unknown;
    preRelease: unknown;
    globals: unknown;
    shardCount: unknown;
  }>("scripts/index.json");
  if (!index || index.shardCount !== 256) reject();
  const scripts = new Map<string, Set<string>>();
  for (const values of [index.official, index.preRelease]) {
    if (!Array.isArray(values) || values.length > 50000) reject();
    for (const name of values as unknown[]) {
      if (typeof name !== "string" || !/^c[1-9][0-9]{0,9}\.lua$/.test(name))
        reject();
      const code = Number((name as string).slice(1, -4));
      if (!Number.isSafeInteger(code) || code > 0xffffffff) reject();
      const shard = (code % 256).toString(16).padStart(2, "0");
      const names = scripts.get(shard) ?? new Set<string>();
      names.add(name as string);
      scripts.set(shard, names);
    }
  }
  for (const [shard, names] of scripts) {
    const records = await reader.readJson<Record<string, unknown>>(
      `scripts/cards/${shard}.json`,
    );
    if (!records || typeof records !== "object" || Array.isArray(records))
      reject();
    for (const name of names)
      if (!Object.hasOwn(records, name) || typeof records[name] !== "string")
        reject();
  }
  if (
    !Array.isArray(index.globals) ||
    index.globals.length > 2048 ||
    index.globals.some(
      (name: unknown) =>
        typeof name !== "string" || !/^[a-z0-9_]+\.lua$/i.test(name),
    )
  )
    reject();
  const globals = await reader.readJson<Record<string, unknown>>(
    "scripts/globals.json",
  );
  if (!globals || typeof globals !== "object" || Array.isArray(globals))
    reject();
  for (const name of new Set([
    "constant.lua",
    "utility.lua",
    ...(index.globals as string[]),
  ])) {
    const source = globals[name];
    if (
      !Object.hasOwn(globals, name) ||
      typeof source !== "string" ||
      !source.trim()
    )
      reject();
  }
  const dependencies = await loadActiveDuelDependencies(
    reader,
    new Set(codes.map(cardCode)),
  );
  for (const image of dependencies.images.values())
    if (
      typeof image.full !== "string" ||
      !image.full ||
      typeof image.cropped !== "string" ||
      !image.cropped
    )
      reject();
}
