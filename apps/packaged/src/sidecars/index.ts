import type { SidecarRuntimeContext } from "@open-design/sidecar";

import { ensurePackagedNextjsRuntime } from "./nextjs.js";

export type PackagedSidecarsHandle = {
  close(): Promise<void>;
};

export async function startPackagedSidecars(
  runtime: Pick<SidecarRuntimeContext, "base" | "namespace">,
): Promise<PackagedSidecarsHandle> {
  const nextjs = await ensurePackagedNextjsRuntime(runtime);

  return {
    async close() {
      await nextjs.close();
    },
  };
}
