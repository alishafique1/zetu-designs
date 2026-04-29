import { cac } from "cac";
import { mkdir, open } from "node:fs/promises";
import path from "node:path";

import {
  allocateDevPorts,
  APP_KEYS,
  createStampedLaunchEnv,
  createStampedProcessArgs,
  matchesStampedProcess,
  readJsonFile,
  removeFile,
  requestJsonIpc,
  writeJsonFile,
} from "@open-design/sidecar";
import {
  collectProcessTreePids,
  isProcessAlive,
  listProcessSnapshots,
  readLogTail,
  spawnBackgroundProcess,
  stopProcesses,
  waitForProcessExit,
} from "@open-design/platform";

import { parsePortOption, resolveBaseConfig, resolveRunConfig, type ToolDevOptions } from "./config.js";

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function exitWithError(error: unknown): never {
  process.stderr.write(`${formatError(error)}\n`);
  process.exit(1);
}

process.on("uncaughtException", exitWithError);
process.on("unhandledRejection", exitWithError);

type CliOptions = ToolDevOptions & {
  positionals?: string[];
};

function printJson(payload: unknown): void {
  process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
}

function output(payload: unknown, options: CliOptions = {}): void {
  if (options.json === true) {
    printJson(payload);
    return;
  }

  if (typeof payload === "string") process.stdout.write(`${payload}\n`);
  else printJson(payload);
}

async function requestStatus(pointer: any, timeoutMs = 1500) {
  return await requestJsonIpc(pointer.controllerIpcPath, { type: "status" }, { timeoutMs });
}

async function findStampedProcesses(manifest: any) {
  const processes = await listProcessSnapshots();
  return processes.filter((processInfo: any) =>
    matchesStampedProcess(processInfo, {
      namespace: manifest.namespace,
      runtimeToken: manifest.runtimeToken,
      source: "tools-dev",
    }),
  );
}

async function readCurrentRuntime(options: CliOptions) {
  const base = resolveBaseConfig(options);
  const pointer = await readJsonFile(base.pointerPath);
  if (!pointer) return { base, state: "missing" };

  try {
    const currentStatus = await requestStatus(pointer);
    return { base, pointer, state: "running", status: currentStatus };
  } catch (error) {
    const manifest = await readJsonFile(pointer.manifestPath);
    const activeProcesses = manifest ? await findStampedProcesses(manifest) : [];
    return {
      activeProcesses,
      base,
      error: error instanceof Error ? error.message : String(error),
      manifest,
      pointer,
      state: activeProcesses.length > 0 ? "stale-active" : "stale-dead",
    };
  }
}

async function cleanupDeadPointer(runtime: any) {
  if (runtime.state === "stale-dead" && runtime.base?.pointerPath) {
    await removeFile(runtime.base.pointerPath);
  }
}

function createInitialManifest({ config, controllerPid, portPlan }: any) {
  const host = portPlan.host;
  const daemonUrl = `http://${host}:${portPlan.daemon.port}`;
  const webUrl = `http://${host}:${portPlan.web.port}`;
  const now = new Date().toISOString();

  return {
    apps: {
      controller: {
        exitCode: null,
        logPath: config.apps.controller.logPath,
        pid: controllerPid,
        status: "starting",
        url: null,
      },
      daemon: {
        exitCode: null,
        logPath: config.apps.daemon.logPath,
        pid: null,
        status: "pending",
        url: daemonUrl,
      },
      web: {
        exitCode: null,
        logPath: config.apps.web.logPath,
        pid: null,
        status: "pending",
        url: webUrl,
      },
    },
    controller: {
      ipcPath: config.controllerIpcPath,
      pid: controllerPid,
    },
    createdAt: now,
    error: null,
    mode: "dev",
    namespace: config.namespace,
    portSources: {
      daemon: portPlan.daemon.source,
      web: portPlan.web.source,
    },
    ports: {
      daemon: portPlan.daemon.port,
      host,
      web: portPlan.web.port,
    },
    runtimeRoot: config.runtimeRoot,
    runtimeToken: config.runtimeToken,
    schemaVersion: 1,
    status: "starting",
    toolsDevRoot: config.toolsDevRoot,
    updatedAt: now,
    urls: {
      daemon: daemonUrl,
      web: webUrl,
    },
    workspaceRoot: config.workspaceRoot,
  };
}

async function openControllerLog(config: any) {
  await mkdir(path.dirname(config.apps.controller.logPath), { recursive: true });
  return await open(config.apps.controller.logPath, "a");
}

async function waitForControllerReady(pointer: any, timeoutMs = 35000) {
  const startedAt = Date.now();
  let lastError: unknown = null;

  while (Date.now() - startedAt < timeoutMs) {
    try {
      const currentStatus: any = await requestStatus(pointer, 1000);
      if (currentStatus.status === "running") return currentStatus;
      if (currentStatus.status === "error") {
        throw new Error(currentStatus.error || "controller failed to start");
      }
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }

  throw new Error(
    `controller did not become ready in time${lastError instanceof Error ? `: ${lastError.message}` : ""}`,
  );
}

async function start(options: CliOptions) {
  const existing = await readCurrentRuntime(options);
  if (existing.state === "running") {
    throw new Error(`namespace "${(existing as any).status.namespace}" is already running; use tools-dev status, stop, or restart`);
  }
  if (existing.state === "stale-active") {
    throw new Error(
      `namespace "${(existing as any).manifest?.namespace ?? options.namespace ?? "default"}" has stale active processes; run tools-dev stop first`,
    );
  }
  await cleanupDeadPointer(existing);

  const daemonPort = parsePortOption(options.daemonPort ?? process.env.OD_PORT, "--daemon-port");
  const webPort = parsePortOption(options.webPort ?? process.env.VITE_PORT, "--web-port");
  const portPlan = await allocateDevPorts({ daemonPort, webPort });
  const config = resolveRunConfig(options);
  const pointer = {
    controllerIpcPath: config.controllerIpcPath,
    manifestPath: config.manifestPath,
    namespace: config.namespace,
    runtimeRoot: config.runtimeRoot,
    runtimeToken: config.runtimeToken,
    toolsDevRoot: config.toolsDevRoot,
    updatedAt: new Date().toISOString(),
  };

  await mkdir(config.runtimeRoot, { recursive: true });
  const logHandle = await openControllerLog(config);
  let controllerPid: number | null = null;

  try {
    const controllerStamp = {
      appKey: APP_KEYS.CONTROLLER,
      controllerIpcPath: config.controllerIpcPath,
      mode: "dev",
      namespace: config.namespace,
      runtimeToken: config.runtimeToken,
    };
    const env = createStampedLaunchEnv({
      controllerIpcPath: config.controllerIpcPath,
      extraEnv: process.env,
      runtimeToken: config.runtimeToken,
      sidecarBase: config.toolsDevRoot,
    });
    const spawned = await spawnBackgroundProcess({
      args: [
        ...config.apps.controller.args,
        "--workspace-root",
        config.workspaceRoot,
        "--tools-dev-root",
        config.toolsDevRoot,
        "--runtime-root",
        config.runtimeRoot,
        "--manifest",
        config.manifestPath,
        "--pointer",
        config.pointerPath,
        "--namespace",
        config.namespace,
        "--runtime-token",
        config.runtimeToken,
        "--controller-ipc",
        config.controllerIpcPath,
        "--controller-log",
        config.apps.controller.logPath,
        "--daemon-log",
        config.apps.daemon.logPath,
        "--web-log",
        config.apps.web.logPath,
        "--web-runner-entry",
        config.apps.web.entryPath,
        "--web-runner-command",
        config.apps.web.command,
        "--web-runner-args",
        JSON.stringify(config.apps.web.args),
        "--daemon-port",
        String(portPlan.daemon.port),
        "--web-port",
        String(portPlan.web.port),
        "--host",
        portPlan.host,
        ...createStampedProcessArgs({
          origin: { namespace: config.namespace, role: "dev-controller", source: "tools-dev" },
          stamp: controllerStamp,
        }),
      ],
      command: config.apps.controller.command,
      cwd: config.workspaceRoot,
      detached: true,
      env,
      logFd: logHandle.fd,
    });
    controllerPid = spawned.pid;
  } finally {
    await logHandle.close();
  }

  const manifest = createInitialManifest({ config, controllerPid, portPlan });
  await writeJsonFile(config.manifestPath, manifest);
  await writeJsonFile(config.pointerPath, pointer);

  try {
    const currentStatus: any = await waitForControllerReady(pointer);
    return {
      created: true,
      logPath: config.apps.controller.logPath,
      namespace: config.namespace,
      ports: currentStatus.ports,
      runtimeRoot: config.runtimeRoot,
      runtimeToken: config.runtimeToken,
      status: currentStatus.status,
      urls: currentStatus.urls,
    };
  } catch (error) {
    await stop({ ...options, json: true }).catch(() => {});
    throw error;
  }
}

async function status(options: CliOptions) {
  const runtime: any = await readCurrentRuntime(options);
  if (runtime.state === "missing") {
    return { namespace: runtime.base.namespace, status: "not-running" };
  }
  if (runtime.state === "running") return runtime.status;

  return {
    activeProcesses: runtime.activeProcesses?.map(({ command, pid, ppid }: any) => ({ command, pid, ppid })) ?? [],
    error: runtime.error,
    manifest: runtime.manifest,
    namespace: runtime.manifest?.namespace ?? runtime.base.namespace,
    status: runtime.state,
  };
}

async function fallbackStop(runtime: any) {
  if (!runtime.manifest) {
    if (runtime.base?.pointerPath) await removeFile(runtime.base.pointerPath);
    return { via: "fallback", stop: { alreadyStopped: true, forcedPids: [], matchedPids: [], remainingPids: [], stoppedPids: [] } };
  }

  const processes = await listProcessSnapshots();
  const rootPids = processes
    .filter((processInfo: any) =>
      matchesStampedProcess(processInfo, {
        namespace: runtime.manifest.namespace,
        runtimeToken: runtime.manifest.runtimeToken,
        source: "tools-dev",
      }),
    )
    .map((processInfo: any) => processInfo.pid);
  const pids = collectProcessTreePids(processes, rootPids);
  const stopResult = await stopProcesses(pids);
  if (runtime.base?.pointerPath) await removeFile(runtime.base.pointerPath);
  return { matchedRootPids: rootPids, via: "fallback", stop: stopResult };
}

async function stop(options: CliOptions) {
  const runtime: any = await readCurrentRuntime(options);
  if (runtime.state === "missing") {
    return { namespace: runtime.base.namespace, status: "not-running" };
  }
  if (runtime.state !== "running") {
    return await fallbackStop(runtime);
  }

  const before: any = await requestJsonIpc(runtime.pointer.controllerIpcPath, { type: "shutdown" }, { timeoutMs: 2000 });
  const controllerPid = before.controller?.pid ?? before.apps?.controller?.pid;
  if (controllerPid && isProcessAlive(controllerPid)) await waitForProcessExit(controllerPid, 7000);
  await removeFile(runtime.base.pointerPath);
  return {
    namespace: before.namespace,
    status: "stopped",
    via: "controller",
  };
}

async function restart(options: CliOptions) {
  const stopped = await stop(options);
  const started = await start(options);
  return { started, stopped };
}

async function logs(app: string | undefined, options: CliOptions) {
  const targetApp = app ?? "all";
  const current: any = await status({ ...options, json: true });
  const manifest = current.schemaVersion ? current : current.manifest;
  if (!manifest?.apps) return { app: targetApp, lines: [], logPath: null, status: current.status };

  const apps = targetApp === "all" ? ["controller", "daemon", "web"] : [targetApp];
  const result: Record<string, { lines: string[]; logPath: string | null }> = {};
  for (const name of apps) {
    const logPath = manifest.apps[name]?.logPath;
    result[name] = {
      lines: logPath ? await readLogTail(logPath, 120) : [],
      logPath: logPath ?? null,
    };
  }
  return result;
}

function printStartResult(result: any, options: CliOptions) {
  if (options.json === true) return output(result, options);
  process.stdout.write(`[tools-dev] started namespace "${result.namespace}"\n`);
  process.stdout.write(`  web:    ${result.urls.web}\n`);
  process.stdout.write(`  daemon: ${result.urls.daemon}\n`);
  process.stdout.write(`  root:   ${result.runtimeRoot}\n`);
}

const cli = cac("tools-dev");

function addSharedOptions(command: ReturnType<typeof cli.command>) {
  return command
    .option("--namespace <name>", "runtime namespace (default: default)")
    .option("--tools-dev-root <path>", "tools-dev runtime root")
    .option("--json", "print JSON");
}

addSharedOptions(cli.command("start", "Start the background dev controller, daemon, and web app"))
  .option("--daemon-port <port>", "force daemon port; conflict quick-fails")
  .option("--web-port <port>", "force web port; conflict quick-fails")
  .action(async (options: CliOptions) => {
    printStartResult(await start(options), options);
  });

addSharedOptions(cli.command("status", "Show current namespace status")).action(async (options: CliOptions) => {
  output(await status(options), options);
});

addSharedOptions(cli.command("inspect", "Show detailed current namespace status")).action(async (options: CliOptions) => {
  output(await status(options), options);
});

addSharedOptions(cli.command("stop", "Stop the current namespace")).action(async (options: CliOptions) => {
  output(await stop(options), options);
});

addSharedOptions(cli.command("restart", "Stop and start the current namespace"))
  .option("--daemon-port <port>", "force daemon port; conflict quick-fails")
  .option("--web-port <port>", "force web port; conflict quick-fails")
  .action(async (options: CliOptions) => {
    output(await restart(options), options);
  });

addSharedOptions(cli.command("logs [app]", "Show log tail for controller, daemon, web, or all apps")).action(
  async (app: string | undefined, options: CliOptions) => {
    output(await logs(app, options), options);
  },
);

cli.help();

const rawCliArgs = process.argv.slice(2);
const cliArgs = rawCliArgs[0] === "--" ? rawCliArgs.slice(1) : rawCliArgs;
process.argv.splice(2, process.argv.length - 2, ...cliArgs);

if (cliArgs.length === 0 || (cliArgs[0]?.startsWith("-") && cliArgs[0] !== "--help" && cliArgs[0] !== "-h")) {
  process.argv.splice(2, 0, "start");
}

cli.parse();
