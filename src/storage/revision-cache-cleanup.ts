const REVISION_CACHE_PREFIXES = [
  "ygo-runtime-v1-",
  "ygo-card-images-v1-",
] as const;
const SNAPSHOT_UPDATE_LOCK = "ygo-snapshot-update-v1";

interface LockCoordinator {
  request<T>(
    name: string,
    options: { readonly mode: "exclusive" },
    callback: () => Promise<T>,
  ): Promise<T>;
}

export async function withSnapshotUpdateLock<T>(
  operation: () => Promise<T>,
  coordinator: LockCoordinator | undefined = typeof globalThis.navigator ===
  "undefined"
    ? undefined
    : globalThis.navigator.locks,
): Promise<T> {
  return coordinator === undefined
    ? operation()
    : coordinator.request(
        SNAPSHOT_UPDATE_LOCK,
        { mode: "exclusive" },
        operation,
      );
}

export async function pruneRevisionCaches(
  retainedCacheNames: ReadonlySet<string>,
  cacheStorage: Pick<CacheStorage, "keys" | "delete"> = globalThis.caches,
): Promise<number> {
  if (retainedCacheNames.size === 0) return 0;
  const names = await cacheStorage.keys();
  const stale = names.filter((name) => {
    const prefix = REVISION_CACHE_PREFIXES.find((candidate) =>
      name.startsWith(candidate),
    );
    if (prefix === undefined) return false;
    return !retainedCacheNames.has(name);
  });
  const deleted = await Promise.all(
    stale.map((name) => cacheStorage.delete(name)),
  );
  return deleted.filter(Boolean).length;
}
