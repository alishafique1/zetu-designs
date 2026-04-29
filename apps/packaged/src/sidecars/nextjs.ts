import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { basename, dirname, join } from "node:path";

import {
  APP_KEYS,
  createStampedLaunchEnv,
  createStampedProcessArgs,
  inspectNextjsRuntime,
  requestJsonIpc,
  resolveNextjsIpcPath,
  type SidecarRuntimeContext,
  waitForNextjsRuntime,
} from "@open-design/sidecar";

function resolveNextjsSidecarEntryPath(): string {
  const require = createRequire(import.meta.url);
  return require.resolve("@open-design/nextjs/sidecar");
}

function resolveElectronNodeCommand(execPath = process.execPath): string {
  if (process.platform !== "darwin") return execPath;

  const executableName = basename(execPath);
  const contentsRoot = dirname(dirname(execPath));
  const helperPath = join(
    contentsRoot,
    "Frameworks",
    `${executableName} Helper.app`,
    "Contents",
    "MacOS",
    `${executableName} Helper`,
  );

  return existsSync(helperPath) ? helperPath : execPath;
}

async function waitForProcessExit(pid: number | undefined, timeoutMs = 5000): Promise<boolean> {
  if (pid == null) return true;

  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    try {
      process.kill(pid, 0);
    } catch {
      return true;
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 100));
  }

  return false;
}

export async function ensurePackagedNextjsRuntime(
  runtime: Pick<SidecarRuntimeContext, "base" | "namespace">,
): Promise<{ close(): Promise<void> }> {
  const existing = await inspectNextjsRuntime(runtime, 1000);
  if (existing?.url != null) {
    return {
      async close() {
        await requestJsonIpc(resolveNextjsIpcPath(runtime), { type: "shutdown" }, { timeoutMs: 1500 }).catch(
          () => undefined,
        );
      },
    };
  }

  const entryPath = resolveNextjsSidecarEntryPath();
  const controllerIpcPath = resolveNextjsIpcPath(runtime);
  const child = spawn(
    resolveElectronNodeCommand(),
    [
      entryPath,
      ...createStampedProcessArgs({
        origin: {
          namespace: runtime.namespace,
          role: "nextjs-sidecar",
          source: "packaged",
        },
        stamp: {
          appKey: APP_KEYS.NEXTJS,
          controllerIpcPath,
          mode: "runtime",
          namespace: runtime.namespace,
        },
      }),
    ],
    {
      cwd: dirname(entryPath),
      env: createStampedLaunchEnv({
        controllerIpcPath,
        extraEnv: {
          ...process.env,
          ELECTRON_RUN_AS_NODE: "1",
          NODE_ENV: "production",
        },
        namespace: runtime.namespace,
        sidecarBase: runtime.base,
      }),
      stdio: "ignore",
      windowsHide: process.platform === "win32",
    },
  );

  child.unref();
  await waitForNextjsRuntime(runtime, 45_000);

  return {
    async close() {
      await requestJsonIpc(controllerIpcPath, { type: "shutdown" }, { timeoutMs: 1500 }).catch(() => undefined);
      if (!(await waitForProcessExit(child.pid))) {
        try {
          child.kill("SIGKILL");
        } catch {
          // Process already exited.
        }
      }
    },
  };
}
