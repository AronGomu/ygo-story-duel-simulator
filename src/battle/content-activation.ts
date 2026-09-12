import type { RuntimeActivationPort } from "../content/index.ts";

/** Install-only public sub-entry. Never evaluates BattleFacade or creates a Worker. */
export function createRuntimeActivationPort(): RuntimeActivationPort {
  return {
    async prepare(ref, runtime, reader) {
      const { prepareInstalledRuntime } =
        await import("./storage/prepare-installed-runtime.ts");
      return prepareInstalledRuntime(ref, runtime, reader);
    },
  };
}
