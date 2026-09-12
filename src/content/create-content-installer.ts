import type { CoreBootstrap } from "./contracts/core-bootstrap.ts";
import type { SavedContentRefsPort } from "./contracts/saved-content-refs-port.ts";
import type { RuntimeActivationPort } from "./contracts/runtime-activation-port.ts";
import type { RuntimeSnapshotRef } from "./contracts/runtime-snapshot-ref.ts";
import type { ContentInstaller } from "./contracts/content-installer.ts";
import type { ContentResult } from "./contracts/content-result.ts";
import type { ChapterId } from "./contracts/chapter-id.ts";
import type { ChapterReadiness } from "./contracts/chapter-readiness.ts";
import type { DownloadTarget } from "./contracts/download-target.ts";
import type { DownloadProgress } from "./contracts/download-progress.ts";
import type { DownloadResult } from "./contracts/download-result.ts";
import type { PersistedDownloadJob } from "./contracts/persisted-download-job.ts";
import type { ManifestRef } from "./contracts/manifest-ref.ts";
import type { ContentFailure } from "./contracts/content-failure.ts";
import type { ContentSetRef } from "./contracts/content-set-ref.ts";
import {
  CONTENT_CACHE_NAME,
  CONTENT_INSTALLER_LOCK,
} from "./content-constants.ts";
import { ContentReader } from "./storage/content-reader.ts";
import {
  abortContentTransaction,
  commitInstall,
  EMPTY_CONTENT,
  openContentDatabase,
} from "./storage/content-database.ts";
import {
  fileKey,
  partKey,
  STAGING_CACHE_NAME,
} from "./storage/content-cache.ts";
import {
  activationId,
  contentError,
  failure,
  json,
  readCachedBytes,
  same,
  unwrap,
  verifyBytes,
} from "./content-verification.ts";
import { parseContentIndex } from "./parsers/content-index.ts";
import { parseContentManifest } from "./parsers/content-manifest.ts";
import { parseContentFailure } from "./parsers/content-failure.ts";
import {
  manifestClosure,
  validateInstalledState,
} from "./install/manifest-closure.ts";
import { fetchVerified } from "./install/verified-fetch.ts";
import { extractVerifiedPart } from "./install/verified-archive.ts";
import { verifyGameplay } from "./install/verify-gameplay.ts";

interface InstallerOptions {
  readonly bootstrap: CoreBootstrap;
  readonly savedRefs: SavedContentRefsPort;
  readonly activation: RuntimeActivationPort;
}
class Installer extends ContentReader implements ContentInstaller {
  closed = false;
  readonly controllers = new Set<AbortController>();
  readonly options: InstallerOptions;
  constructor(
    db: ContentReader["db"],
    cache: Cache,
    options: InstallerOptions,
  ) {
    super(db, cache);
    this.options = options;
  }
  async inspect(chapterId: ChapterId): Promise<ChapterReadiness> {
    if (!this.options.bootstrap.chapters.some((c) => c.id === chapterId))
      return failure("CONTENT_INVALID_MANIFEST");
    const state = await this.current();
    if (state.kind === "failed") return state;
    if (state.value.current?.chapters.some((r) => r.packId === chapterId))
      return { kind: "ready", chapterId, content: state.value.current };
    if (!this.options.bootstrap.delivery)
      return { kind: "unreleased", chapterId };
    const catalog = await this.readCatalog(
      this.options.bootstrap.delivery.index.sha256,
    );
    if (
      catalog.kind === "ok" &&
      !catalog.value.value.chapters.some(
        (c) => c.id === chapterId && c.status === "published",
      )
    )
      return { kind: "unreleased", chapterId };
    return { kind: "missing", chapterId, missingPacks: ["runtime", chapterId] };
  }
  async verify(chapterId: ChapterId): Promise<ContentResult<ContentSetRef>> {
    const readiness = await this.inspect(chapterId);
    return readiness.kind === "ready"
      ? this.inspectContent(readiness.content)
      : readiness.kind === "failed"
        ? readiness
        : failure("CONTENT_MISSING");
  }
  listJobs() {
    return this.guard(async () =>
      (await this.db.getAll("jobs")).map(
        ({ jobId, target, progress, failure }) => ({
          jobId,
          target,
          progress,
          failure: failure === null ? null : parseContentFailure(failure),
        }),
      ),
    );
  }
  async download(
    target: DownloadTarget,
    onProgress: (p: DownloadProgress) => void,
    signal?: AbortSignal,
  ): Promise<DownloadResult> {
    if (this.closed) return failure("CONTENT_STORAGE_UNAVAILABLE");
    if (!navigator.locks) return failure("CONTENT_STORAGE_UNAVAILABLE");
    try {
      return await navigator.locks.request(
        CONTENT_INSTALLER_LOCK,
        { mode: "exclusive", ifAvailable: true },
        async (lock) =>
          lock
            ? this.install(target, onProgress, signal)
            : failure("CONTENT_BUSY"),
      );
    } catch (error) {
      return contentError(error);
    }
  }
  private async install(
    target: DownloadTarget,
    onProgress: (p: DownloadProgress) => void,
    external?: AbortSignal,
  ): Promise<DownloadResult> {
    const delivery = this.options.bootstrap.delivery;
    if (!delivery) return failure("CONTENT_NOT_PUBLISHED");
    if (target.kind === "revision")
      return failure("CONTENT_REVISION_UNAVAILABLE");
    if (
      target.kind !== "all-published" &&
      (target.kind !== "chapter" ||
        !this.options.bootstrap.chapters.some((c) => c.id === target.chapterId))
    )
      return failure("CONTENT_INVALID_MANIFEST");
    const controller = new AbortController();
    const pause = () => controller.abort();
    if (external?.aborted) pause();
    external?.addEventListener("abort", pause, { once: true });
    this.controllers.add(controller);
    const signal = controller.signal;
    let job: PersistedDownloadJob | null = null;
    const emit = (patch: Partial<DownloadProgress>) => {
      if (!job) return;
      job = { ...job, progress: { ...job.progress, ...patch } };
      try {
        onProgress(job.progress);
      } catch {
        console.warn("CONTENT_PROGRESS_LISTENER_FAILED");
      }
    };
    try {
      unwrap(await this.options.savedRefs.read());
      const old = validateInstalledState(
        (await this.db.get("active", "current")) ?? EMPTY_CONTENT,
      );
      job = {
        jobId: crypto.randomUUID(),
        target,
        expectedGeneration: old.generation,
        content: null,
        verifiedParts: [],
        failure: null,
        progress: {
          jobId: "",
          packId: target.kind === "chapter" ? target.chapterId : "runtime",
          phase: "queued",
          verifiedDownloadBytes: 0,
          totalDownloadBytes: 0,
          currentPartReceivedBytes: 0,
          currentPartTotalBytes: 0,
        },
      };
      job = { ...job, progress: { ...job.progress, jobId: job.jobId } };
      await this.db.put("jobs", job, job.jobId);
      emit({});
      signal.throwIfAborted();
      const raw = await fetchVerified(
        delivery.baseUrl,
        "indexes",
        delivery.index,
        signal,
        () => undefined,
      );
      const index = unwrap(parseContentIndex(json(raw)));
      if (
        index.chapters.some(
          (c) =>
            !this.options.bootstrap.chapters.some((known) => known.id === c.id),
        )
      )
        throw failure("CONTENT_INCOMPATIBLE");
      await this.db.put("catalogs", raw, delivery.index.sha256);
      const selected = index.chapters.filter(
        (c) =>
          c.status === "published" &&
          (target.kind === "all-published" || c.id === target.chapterId),
      );
      if (!selected.length) throw failure("CONTENT_NOT_PUBLISHED");
      // T4 adds chapters only. Existing content cannot silently switch revision/runtime.
      if (old.current && old.current.catalogSha256 !== delivery.index.sha256)
        throw failure("CONTENT_INCOMPATIBLE");
      const roots = [
        index.runtime,
        ...(old.current?.chapters ?? []),
        ...selected.flatMap((c) =>
          c.status === "published" ? [c.manifest] : [],
        ),
      ];
      const entries = await manifestClosure(roots, async (ref) => {
        const bytes = await fetchVerified(
          delivery.baseUrl,
          "manifests",
          ref,
          signal,
          () => undefined,
        );
        const manifest = unwrap(parseContentManifest(json(bytes)));
        if (manifest.runtimeSnapshotId !== index.runtimeSnapshotId)
          throw failure("CONTENT_INCOMPATIBLE");
        await this.db.put("manifests", bytes, ref.sha256);
        return manifest;
      });
      for (const entry of entries)
        if (
          entry.ref.packId !== "runtime" &&
          !index.chapters.some(
            (c) => c.status === "published" && same(c.manifest, entry.ref),
          )
        )
          throw failure("CONTENT_INCOMPATIBLE");
      const runtime = entries.find((e) => e.ref.packId === "runtime")!;
      const runtimeManifest = runtime.manifest.files.find(
        (f) => f.path === "runtime/current/manifest.json",
      );
      if (!runtimeManifest) throw failure("CONTENT_INTEGRITY_FAILED");
      const content: ContentSetRef = {
        catalogSha256: delivery.index.sha256,
        runtime: index.runtime,
        chapters: entries
          .filter((e) => e.ref.packId !== "runtime")
          .map((e) => e.ref)
          .sort((a, b) => a.packId.localeCompare(b.packId)),
        snapshot: {
          activationId: await activationId(
            index.runtimeSnapshotId,
            delivery.index.sha256,
          ),
          runtimeSnapshotId: index.runtimeSnapshotId,
          runtimeManifestSha256: runtimeManifest.sha256,
          releaseCatalogSha256: delivery.index.sha256,
        },
      };
      job = { ...job, content };
      emit({
        totalDownloadBytes: entries.reduce(
          (n, e) => n + e.manifest.parts.reduce((m, p) => m + p.bytes, 0),
          0,
        ),
      });
      await this.db.put("jobs", job, job.jobId);
      const staging = await caches.open(STAGING_CACHE_NAME);
      const verifiedKeys = new Set<string>();
      for (const entry of entries)
        for (const part of entry.manifest.parts) {
          signal.throwIfAborted();
          emit({
            packId: entry.ref.packId,
            phase: "downloading",
            currentPartReceivedBytes: 0,
            currentPartTotalBytes: part.bytes,
          });
          const bytes = await fetchVerified(
            delivery.baseUrl,
            "parts",
            part,
            signal,
            (n) => emit({ currentPartReceivedBytes: n }),
          );
          emit({ phase: "verifying" });
          await staging.put(
            partKey(job.jobId, part.sha256),
            new Response(bytes.slice()),
          );
          job = {
            ...job,
            verifiedParts: [...new Set([...job.verifiedParts, part.sha256])],
          };
          emit({
            verifiedDownloadBytes:
              job.progress.verifiedDownloadBytes + part.bytes,
            phase: "extracting",
          });
          await this.db.put("jobs", job, job.jobId);
          await extractVerifiedPart(
            bytes,
            entry.manifest.files.filter((f) => f.partSha256 === part.sha256),
            async (file, payload) => {
              signal.throwIfAborted();
              const key = fileKey(entry.ref, file.path);
              const cached = await this.cache.match(key);
              let reuse = false;
              if (cached) {
                try {
                  await verifyBytes(
                    await readCachedBytes(cached, file.bytes),
                    file,
                  );
                  reuse = true;
                } catch (error) {
                  if (contentError(error).code !== "CONTENT_INTEGRITY_FAILED")
                    throw error;
                }
              }
              if (!reuse)
                await this.cache.put(
                  key,
                  new Response(payload.slice(), {
                    headers: { "Content-Type": file.mediaType },
                  }),
                );
              verifiedKeys.add(key);
            },
          );
        }
      const privateReader = new ContentReader(
        this.db,
        this.cache,
        verifiedKeys,
      );
      await verifyGameplay(entries, privateReader);
      signal.throwIfAborted();
      let prepared: RuntimeSnapshotRef;
      let stopPause: (() => void) | undefined;
      try {
        prepared = unwrap(
          await Promise.race([
            this.options.activation.prepare(
              content.snapshot,
              content.runtime,
              privateReader,
            ),
            new Promise<never>((_resolve, reject) => {
              const onAbort = () => reject(signal.reason);
              stopPause = () => signal.removeEventListener("abort", onAbort);
              signal.addEventListener("abort", onAbort, { once: true });
              if (signal.aborted) onAbort();
            }),
          ]),
        );
      } finally {
        stopPause?.();
      }
      if (!same(prepared, content.snapshot))
        throw failure("CONTENT_INTEGRITY_FAILED");
      signal.throwIfAborted();
      emit({ phase: "activating" });
      await commitInstall(
        this.db,
        job,
        entries.map((entry) => ({
          manifest: entry.ref,
          verifiedAt: Date.now(),
          fileKeys: entry.manifest.files.map((f) => fileKey(entry.ref, f.path)),
        })),
      );
      emit({ phase: "complete" });
      await this.notify();
      return { kind: "complete", content };
    } catch (error) {
      if (job) {
        const result = signal.aborted ? null : contentError(error);
        job = {
          ...job,
          failure: result,
          progress: {
            ...job.progress,
            phase: signal.aborted ? "paused" : "failed",
          },
        };
        try {
          await this.db.put("jobs", job, job.jobId);
          emit({});
        } catch (persistError) {
          return contentError(persistError);
        }
        if (signal.aborted) return { kind: "paused", jobId: job.jobId };
        return result!;
      }
      return contentError(error);
    } finally {
      external?.removeEventListener("abort", pause);
      this.controllers.delete(controller);
      if (this.closed && this.controllers.size === 0) super.close();
    }
  }
  invalidate(ref: ManifestRef, reason: ContentFailure) {
    return this.guard(async () => {
      const parsed = parseContentFailure(reason);
      if (!same(parsed, reason)) throw parsed;
      if (!navigator.locks) throw failure("CONTENT_STORAGE_UNAVAILABLE");
      return navigator.locks.request(
        CONTENT_INSTALLER_LOCK,
        { mode: "exclusive", ifAvailable: true },
        async (lock) => {
          if (!lock) throw failure("CONTENT_BUSY");
          unwrap(await this.readManifest(ref));
          const tx = this.db.transaction(["active", "invalid"], "readwrite");
          const done = tx.done.then(
            () => null,
            (error: unknown) => error,
          );
          try {
            const old = validateInstalledState(
              (await tx.objectStore("active").get("current")) ?? EMPTY_CONTENT,
            );
            if (old.generation === Number.MAX_SAFE_INTEGER)
              throw failure("CONTENT_ACTIVATION_CONFLICT");
            await tx.objectStore("invalid").put(parsed, ref.sha256);
            const affected =
              old.current &&
              [old.current.runtime, ...old.current.chapters].some(
                (r) => r.sha256 === ref.sha256,
              );
            const next = affected
              ? {
                  generation: old.generation + 1,
                  current: null,
                  previous: old.current,
                }
              : old;
            await tx.objectStore("active").put(next, "current");
            const error = await done;
            if (error) throw error;
            await this.notify();
            return next;
          } catch (error) {
            await abortContentTransaction(tx, done);
            throw error;
          }
        },
      );
    });
  }
  override close(): void {
    this.closed = true;
    for (const controller of this.controllers) controller.abort();
    if (!this.controllers.size) super.close();
  }
}
export async function createContentInstaller(
  options: InstallerOptions,
): Promise<ContentResult<ContentInstaller>> {
  let db: ContentReader["db"] | undefined;
  let installer: Installer | undefined;
  try {
    if (!navigator.locks || !globalThis.caches || !globalThis.indexedDB)
      throw failure("CONTENT_STORAGE_UNAVAILABLE");
    db = await openContentDatabase();
    installer = new Installer(
      db,
      await caches.open(CONTENT_CACHE_NAME),
      options,
    );
    // Installer screen may fetch metadata, never payload parts, before Install.
    const delivery = options.bootstrap.delivery;
    if (delivery) {
      const cached = await installer.readCatalog(delivery.index.sha256);
      const signal = new AbortController().signal;
      const raw =
        cached.kind === "ok"
          ? cached.value.bytes
          : await fetchVerified(
              delivery.baseUrl,
              "indexes",
              delivery.index,
              signal,
              () => undefined,
            );
      await verifyBytes(raw, delivery.index);
      const index = unwrap(parseContentIndex(json(raw)));
      await db.put("catalogs", raw, delivery.index.sha256);
      await manifestClosure(
        [
          index.runtime,
          ...index.chapters.flatMap((c) =>
            c.status === "published" ? [c.manifest] : [],
          ),
        ],
        async (ref) => {
          const existing = await installer!.readManifest(ref);
          if (existing.kind === "ok") return existing.value.value;
          const bytes = await fetchVerified(
            delivery.baseUrl,
            "manifests",
            ref,
            signal,
            () => undefined,
          );
          const manifest = unwrap(parseContentManifest(json(bytes)));
          await db!.put("manifests", bytes, ref.sha256);
          return manifest;
        },
      );
    }
    // Only an unowned mutation lock proves a persisted nonterminal job was interrupted.
    await navigator.locks.request(
      CONTENT_INSTALLER_LOCK,
      { mode: "exclusive", ifAvailable: true },
      async (lock) => {
        if (!lock) return;
        const tx = db!.transaction("jobs", "readwrite");
        const done = tx.done.then(
          () => null,
          (error: unknown) => error,
        );
        try {
          for (const job of await tx.store.getAll()) {
            if (
              [
                "queued",
                "downloading",
                "verifying",
                "extracting",
                "activating",
              ].includes(job.progress.phase)
            )
              await tx.store.put(
                { ...job, progress: { ...job.progress, phase: "paused" } },
                job.jobId,
              );
          }
          const error = await done;
          if (error) throw error;
        } catch (error) {
          await abortContentTransaction(tx, done);
          throw error;
        }
      },
    );
    // Reconcile on every boot; corrupted refs stay locked, never discarded.
    await installer.current();
    return { kind: "ok", value: installer };
  } catch (error) {
    if (installer) installer.close();
    else db?.close();
    return contentError(error);
  }
}
