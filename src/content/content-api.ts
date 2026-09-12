import type { ContentInstaller } from "./contracts/content-installer.ts";
import type { ContentReadPort } from "./contracts/content-read-port.ts";
import type { ContentResult } from "./contracts/content-result.ts";
import type { CoreBootstrap } from "./contracts/core-bootstrap.ts";
import type { RuntimeActivationPort } from "./contracts/runtime-activation-port.ts";
import type { SavedContentRefsPort } from "./contracts/saved-content-refs-port.ts";

/** Storage/download implementation stays outside the eager CORE bootstrap closure. */
export async function createContentInstaller(options: {
  readonly bootstrap: CoreBootstrap;
  readonly savedRefs: SavedContentRefsPort;
  readonly activation: RuntimeActivationPort;
}): Promise<ContentResult<ContentInstaller>> {
  try {
    const implementation = await import("./create-content-installer.ts");
    return implementation.createContentInstaller(options);
  } catch {
    return {
      kind: "failed",
      code: "CONTENT_STORAGE_UNAVAILABLE",
      packId: null,
      path: null,
    };
  }
}
export async function openContentReader(): Promise<
  ContentResult<ContentReadPort>
> {
  try {
    const implementation = await import("./storage/content-reader.ts");
    return implementation.openContentReader();
  } catch {
    return {
      kind: "failed",
      code: "CONTENT_STORAGE_UNAVAILABLE",
      packId: null,
      path: null,
    };
  }
}
