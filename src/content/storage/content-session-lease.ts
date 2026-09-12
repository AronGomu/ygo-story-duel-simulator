import type { ContentSetRef } from "../contracts/content-set-ref.ts";
import type { ContentSessionLease } from "../contracts/content-session-lease.ts";
import type { ContentResult } from "../contracts/content-result.ts";
import { contentError, failure, unwrap } from "../content-verification.ts";

/** Sorted, exact immutable-ref locks; unrelated installs need not wait. */
export async function acquireContentLease(
  content: ContentSetRef,
  verify: () => Promise<ContentResult<ContentSetRef>>,
): Promise<ContentSessionLease> {
  if (!navigator.locks) throw failure("CONTENT_STORAGE_UNAVAILABLE");
  const releases: (() => void)[] = [];
  const release = () => {
    for (const unlock of releases.splice(0)) unlock();
  };
  try {
    const hashes = [
      ...new Set(
        [content.runtime, ...content.chapters].map((ref) => ref.sha256),
      ),
    ].sort();
    for (const hash of hashes) {
      let unlock!: () => void;
      const held = new Promise<void>((resolve) => {
        unlock = resolve;
      });
      let acquired!: (result: ContentResult<void>) => void;
      const ready = new Promise<ContentResult<void>>((resolve) => {
        acquired = resolve;
      });
      void navigator.locks
        .request(
          `ygo-content-ref:${hash}`,
          { mode: "shared", ifAvailable: true },
          async (lock) => {
            if (!lock) {
              acquired(failure("CONTENT_BUSY"));
              return;
            }
            acquired({ kind: "ok", value: undefined });
            await held;
          },
        )
        .catch((error: unknown) => {
          acquired(contentError(error));
        });
      releases.push(unlock);
      unwrap(await ready);
    }
    // A removal may have won between initial inspection and acquiring locks.
    unwrap(await verify());
    return { content, release };
  } catch (error) {
    release();
    throw error;
  }
}
