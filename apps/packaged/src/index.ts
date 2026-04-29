import { mkdir } from "node:fs/promises";
import { join } from "node:path";

import { runDesktopMain } from "@open-design/desktop/main";
import {
  APP_KEYS,
  bootstrapSidecarRuntime,
  createSidecarStampArgs,
  resolveDesktopIpcPath,
  SIDECAR_BASE_ENV,
} from "@open-design/sidecar";
import { app } from "electron";

import { readPackagedConfig, type PackagedConfig } from "./config.js";
import { startPackagedSidecars } from "./sidecars/index.js";

async function applyPackagedPathOverrides(config: Pick<PackagedConfig, "dataRoot" | "logsRoot">): Promise<void> {
  if (config.dataRoot != null && config.dataRoot.length > 0) {
    await mkdir(config.dataRoot, { recursive: true });
    await mkdir(join(config.dataRoot, "session"), { recursive: true });
    app.setPath("userData", config.dataRoot);
    app.setPath("sessionData", join(config.dataRoot, "session"));
  }

  if (config.logsRoot != null && config.logsRoot.length > 0) {
    await mkdir(config.logsRoot, { recursive: true });
    app.setPath("logs", config.logsRoot);
  }
}

async function main(): Promise<void> {
  const config = await readPackagedConfig();

  await applyPackagedPathOverrides(config);

  const sidecarBase =
    config.sidecarBase != null && config.sidecarBase.length > 0
      ? config.sidecarBase
      : join(app.getPath("userData"), "runtime");
  const controllerIpcPath = resolveDesktopIpcPath({
    base: sidecarBase,
    namespace: config.namespace,
  });

  process.env[SIDECAR_BASE_ENV] = sidecarBase;

  const runtime = bootstrapSidecarRuntime(
    createSidecarStampArgs({
      appKey: APP_KEYS.DESKTOP,
      controllerIpcPath,
      mode: "runtime",
      namespace: config.namespace,
    }),
    process.env,
    { appKey: APP_KEYS.DESKTOP },
  );

  const sidecars = await startPackagedSidecars(runtime);
  await runDesktopMain(runtime, {
    async beforeShutdown() {
      await sidecars.close();
    },
  });
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.stack || error.message : String(error));
  process.exit(1);
});
