import {
  parseCoreBootstrap,
  type CoreBootstrap,
  type CoreChapterId,
} from "../../content/index.ts";
import { INSTALL_CONTENT_ROUTE, type AppRoute } from "../routes.ts";

export type CoreGate =
  | { readonly kind: "checking" }
  | {
      readonly kind: "locked";
      readonly reason:
        "content-required" | "storage-unavailable" | "content-invalid";
    }
  | {
      readonly kind: "ready";
      readonly chapterIds: readonly CoreChapterId[];
      readonly generation: number;
    };

export interface CoreStartup {
  readonly bootstrap: CoreBootstrap | null;
  readonly gate: CoreGate;
}

export type CoreFetch = (
  input: string,
  init?: RequestInit,
) => Promise<Response>;

export function coreGateMessage(gate: CoreGate): string {
  if (gate.kind === "checking") return "Checking installed content…";
  if (gate.kind === "ready") return "Installed content is ready.";
  switch (gate.reason) {
    case "content-required":
      return "Content is required before Story or Free Play can start.";
    case "storage-unavailable":
      return "Browser storage is unavailable. Content cannot be verified.";
    case "content-invalid":
      return "Content configuration is invalid. Gameplay remains locked.";
  }
}

export function routeForCoreGate(route: AppRoute, gate: CoreGate): AppRoute {
  if (
    gate.kind === "ready" ||
    route.kind === "home" ||
    route.kind === "install-content"
  )
    return route;
  return INSTALL_CONTENT_ROUTE;
}

export async function loadCoreStartup(
  fetch: CoreFetch,
  appBaseUrl: string,
  indexedDB: IDBFactory | undefined,
): Promise<CoreStartup> {
  try {
    const response = await fetch(
      new URL("core-bootstrap.json", appBaseUrl).href,
      {
        cache: "no-store",
        credentials: "omit",
        redirect: "error",
      },
    );
    if (!response.ok) throw new Error("CONTENT_INVALID_MANIFEST");
    const bootstrap = parseCoreBootstrap(await response.json(), appBaseUrl);
    if (bootstrap.delivery === null)
      return {
        bootstrap,
        gate: { kind: "locked", reason: "content-required" },
      };
    if (indexedDB === undefined)
      return {
        bootstrap,
        gate: { kind: "locked", reason: "storage-unavailable" },
      };
    /* T3 owns verified receipts and installation. A delivery pin alone never
       grants readiness. */
    return {
      bootstrap,
      gate: { kind: "locked", reason: "content-required" },
    };
  } catch {
    return {
      bootstrap: null,
      gate: { kind: "locked", reason: "content-invalid" },
    };
  }
}
