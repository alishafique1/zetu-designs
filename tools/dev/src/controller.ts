import { open } from "node:fs/promises";
import path from "node:path";

import {
  collectProcessTreePids,
  listProcessSnapshots,
  spawnLoggedProcess,
  stopProcesses,
  waitForHttpOk,
} from "@open-design/platform";
import {
  APP_KEYS,
  createJsonIpcServer,
  createStampedLaunchEnv,
  createStampedProcessArgs,
  removePointerIfCurrent,
  writeJsonFile,
} from "@open-design/sidecar";

function parseArgs(argv: string[]): Record<string, string | undefined> {
  const out: Record<string, string | undefined> = {};

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg?.startsWith("--")) continue;

    const eq = arg.indexOf("=");
    if (eq !== -1) {
      out[arg.slice(2, eq)] = arg.slice(eq + 1);
      continue;
    }

    out[arg.slice(2)] = argv[index + 1];
    index += 1;
  }

  return out;
}

function nowIso(): string {
  return new Date().toISOString();
}

function createAppState({ logPath, pid = null, status = "pending", url = null }: any) {
  return { exitCode: null, logPath, pid, status, url };
}

async function openLogFd(filePath: string) {
  await import("node:fs/promises").then(({ mkdir }) => mkdir(path.dirname(filePath), { recursive: true }));
  return await open(filePath, "a");
}

function required(args: Record<string, string | undefined>, name: string): string {
  const value = args[name];
  if (value == null || value.length === 0) throw new Error(`controller missing --${name}`);
  return value;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const namespace = required(args, "namespace");
  const runtimeToken = required(args, "runtime-token");
  const toolsDevRoot = required(args, "tools-dev-root");
  const runtimeRoot = required(args, "runtime-root");
  const manifestPath = required(args, "manifest");
  const pointerPath = required(args, "pointer");
  const workspaceRoot = required(args, "workspace-root");
  const controllerIpcPath = required(args, "controller-ipc");
  const daemonPort = Number(required(args, "daemon-port"));
  const webPort = Number(required(args, "web-port"));
  const host = args.host || "127.0.0.1";
  const daemonUrl = `http://${host}:${daemonPort}`;
  const webUrl = `http://${host}:${webPort}`;
  const webRunnerEntry = required(args, "web-runner-entry");
  const webRunnerCommand = required(args, "web-runner-command");
  const webRunnerArgs = JSON.parse(required(args, "web-runner-args")) as string[];

  const state: any = {
    apps: {
      controller: createAppState({ logPath: required(args, "controller-log"), pid: process.pid, status: "running" }),
      daemon: createAppState({ logPath: required(args, "daemon-log"), url: daemonUrl }),
      web: createAppState({ logPath: required(args, "web-log"), url: webUrl }),
    },
    controller: {
      ipcPath: controllerIpcPath,
      pid: process.pid,
    },
    createdAt: nowIso(),
    error: null,
    mode: "dev",
    namespace,
    ports: {
      daemon: daemonPort,
      host,
      web: webPort,
    },
    runtimeRoot,
    runtimeToken,
    schemaVersion: 1,
    status: "starting",
    toolsDevRoot,
    updatedAt: nowIso(),
    urls: {
      daemon: daemonUrl,
      web: webUrl,
    },
    workspaceRoot,
  };

  const children = new Map<string, any>();
  let ipcServer: any = null;
  let shuttingDown = false;

  async function persist() {
    state.updatedAt = nowIso();
    await writeJsonFile(manifestPath, state);
  }

  function snapshot() {
    return JSON.parse(JSON.stringify(state));
  }

  async function markError(error: unknown) {
    state.error = error instanceof Error ? error.message : String(error);
    state.status = "error";
    await persist();
  }

  async function spawnManagedApp(appKey: string, request: any) {
    const logHandle = await openLogFd(request.logPath);

    try {
      const child = await spawnLoggedProcess({
        args: request.args,
        command: request.command ?? process.execPath,
        cwd: workspaceRoot,
        detached: false,
        env: request.env,
        logFd: logHandle.fd,
      });

      state.apps[appKey].pid = child.pid;
      state.apps[appKey].status = "starting";
      children.set(appKey, child);
      child.on("exit", async (code: number | null, signal: string | null) => {
        state.apps[appKey].exitCode = code;
        state.apps[appKey].signal = signal;
        state.apps[appKey].status = shuttingDown ? "stopped" : "exited";
        if (!shuttingDown && state.status !== "error") state.status = "unhealthy";
        await persist().catch(() => {});
      });
    } finally {
      await logHandle.close();
    }
  }

  const runtimeStamp = (appKey: string) => ({
    appKey,
    controllerIpcPath,
    mode: "dev",
    namespace,
    runtimeToken,
  });
  const origin = (role: string) => ({ namespace, role, source: "tools-dev" });
  const stampedEnv = (extraEnv: NodeJS.ProcessEnv) =>
    createStampedLaunchEnv({
      controllerIpcPath,
      extraEnv,
      runtimeToken,
      sidecarBase: toolsDevRoot,
    });

  async function startApps() {
    const commonEnv = {
      ...process.env,
      OD_DAEMON_URL: daemonUrl,
      OD_PORT: String(daemonPort),
      VITE_PORT: String(webPort),
    };

    await spawnManagedApp(APP_KEYS.DAEMON, {
      args: [
        path.join(workspaceRoot, "apps/daemon/cli.js"),
        "--no-open",
        ...createStampedProcessArgs({
          origin: origin("daemon"),
          stamp: runtimeStamp(APP_KEYS.DAEMON),
        }),
      ],
      command: process.execPath,
      env: stampedEnv(commonEnv),
      logPath: state.apps.daemon.logPath,
    });

    await spawnManagedApp(APP_KEYS.WEB, {
      args: [
        ...webRunnerArgs,
        "--workspace-root",
        workspaceRoot,
        "--web-runner-entry",
        webRunnerEntry,
        ...createStampedProcessArgs({
          origin: origin("web"),
          stamp: runtimeStamp(APP_KEYS.WEB),
        }),
      ],
      command: webRunnerCommand,
      env: stampedEnv(commonEnv),
      logPath: state.apps.web.logPath,
    });
  }

  async function waitReadiness() {
    await Promise.all([
      waitForHttpOk(`${daemonUrl}/api/health`, { timeoutMs: 30000 }),
      waitForHttpOk(webUrl, { timeoutMs: 30000 }),
    ]);
    state.apps.daemon.status = "running";
    state.apps.web.status = "running";
    state.status = "running";
    await persist();
  }

  async function terminateChild(appKey: string, child: any) {
    if (child.exitCode != null || child.signalCode != null) return;
    const processes = await listProcessSnapshots();
    const pids = collectProcessTreePids(processes, [child.pid]).filter(
      (pid: number) => pid !== process.pid,
    );
    await stopProcesses(pids.length > 0 ? pids : [child.pid]);
    state.apps[appKey].status = "stopped";
  }

  async function stopChildren() {
    for (const [appKey, child] of [...children.entries()].reverse()) {
      await terminateChild(appKey, child).catch(() => {});
    }
  }

  async function shutdown() {
    if (shuttingDown) return snapshot();
    shuttingDown = true;
    state.status = "stopping";
    await persist();
    await stopChildren();
    state.status = "stopped";
    await persist();
    await removePointerIfCurrent(pointerPath, runtimeToken);
    if (ipcServer) await ipcServer.close().catch(() => {});
    setTimeout(() => process.exit(0), 10).unref();
    return snapshot();
  }

  ipcServer = await createJsonIpcServer({
    socketPath: controllerIpcPath,
    handler: async (message: any) => {
      if (message?.type === "status" || message?.type === "inspect") return snapshot();
      if (message?.type === "shutdown") {
        const before = snapshot();
        setTimeout(() => shutdown().catch(() => process.exit(1)), 10).unref();
        return { ...before, status: "stopping" };
      }
      throw new Error(`unknown controller message: ${message?.type}`);
    },
  });

  await persist();

  try {
    await startApps();
    await persist();
    await waitReadiness();
  } catch (error) {
    await markError(error);
    await stopChildren();
    await persist();
  }

  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    process.on(signal, () => {
      shutdown().catch(() => process.exit(1));
    });
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : String(error));
  process.exit(1);
});
