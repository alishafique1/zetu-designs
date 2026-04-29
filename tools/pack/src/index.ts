import { execFile } from "node:child_process";
import { createWriteStream, readFileSync } from "node:fs";
import {
  access,
  mkdir,
  readdir,
  readFile,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import {
  collectProcessTreePids,
  createPackageManagerInvocation,
  listProcessSnapshots,
  readLogTail,
  spawnBackgroundProcess,
  stopProcesses,
} from "@open-design/platform";
import {
  createProcessOriginArgs,
  matchesStampedProcess,
  requestJsonIpc,
  resolveDesktopIpcPath,
  resolveNamespace,
} from "@open-design/sidecar";
import { cac } from "cac";

const execFileAsync = promisify(execFile);
const __dirname = fileURLToPath(new URL(".", import.meta.url));
const ENTRY_DIR_NAME = __dirname.split(/[\\/]/).filter(Boolean).at(-1);
const WORKSPACE_ROOT = resolve(__dirname, ENTRY_DIR_NAME === "dist" ? "../../.." : "../../..");
const PRODUCT_NAME = "Open Design";
const APP_ID = "io.nexu.open-design";
const CONFIG_FILE_NAME = "open-design-packaged.json";
const LAUNCH_CONFIG_ENV = "OD_PACKAGED_CONFIG_PATH";
const DESKTOP_PROCESS_ROLE = "desktop-sidecar";
const TOOLS_PACK_SOURCE = "tools-pack";

const INTERNAL_TARBALL_PACKAGES = [
  { directory: "packages/shared", name: "@open-design/shared" },
  { directory: "packages/platform", name: "@open-design/platform" },
  { directory: "packages/sidecar", name: "@open-design/sidecar" },
  { directory: "apps/nextjs", name: "@open-design/nextjs" },
  { directory: "apps/desktop", name: "@open-design/desktop" },
  { directory: "apps/packaged", name: "@open-design/packaged" },
] as const;

type BuildOutput = "all" | "app" | "dmg";

type CliOptions = {
  dir?: string;
  dryRun?: boolean;
  json?: boolean;
  namespace?: string;
  sidecarBaseDir?: string;
  to?: string;
};

type ToolPackConfig = {
  namespace: string;
  platform: "mac";
  roots: {
    outputNamespaceRoot: string;
    outputPlatformRoot: string;
    toolPackRoot: string;
  };
  sidecarBaseDir: string;
  to: BuildOutput;
  workspaceRoot: string;
};

type MacPaths = {
  appBuilderConfigPath: string;
  appBuilderOutputRoot: string;
  appExecutablePath: string;
  appPath: string;
  appTarballsRoot: string;
  assembledAppRoot: string;
  assembledMainEntryPath: string;
  assembledPackageJsonPath: string;
  bakedConfigPath: string;
  controllerSocketPath: string;
  dataRoot: string;
  dmgPath: string;
  installApplicationsRoot: string;
  installedAppPath: string;
  installedExecutablePath: string;
  launchConfigPath: string;
  logDir: string;
  logsRoot: string;
  mountPoint: string;
  namespaceOutputRoot: string;
  sidecarBaseDir: string;
  volumeName: string;
};

type PackedTarballInfo = {
  fileName: string;
  packageName: (typeof INTERNAL_TARBALL_PACKAGES)[number]["name"];
};

function printJson(payload: unknown): void {
  process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function sanitizeNamespace(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]+/g, "-");
}

function resolveBuildOutput(value: string | undefined): BuildOutput {
  if (value == null || value.length === 0) return "dmg";
  if (value === "all" || value === "app" || value === "dmg") return value;
  throw new Error(`unsupported --to target: ${value}`);
}

function resolveToolPackConfig(options: CliOptions): ToolPackConfig {
  const namespace = resolveNamespace({ namespace: options.namespace, env: process.env });
  const toolPackRoot = resolve(options.dir ?? join(WORKSPACE_ROOT, ".tmp", "tools-pack"));
  const outputPlatformRoot = join(toolPackRoot, "out", "mac");
  const outputNamespaceRoot = join(outputPlatformRoot, "namespaces", namespace);
  const sidecarBaseDir = resolve(options.sidecarBaseDir ?? join(outputNamespaceRoot, "sidecar-base"));

  return {
    namespace,
    platform: "mac",
    roots: {
      outputNamespaceRoot,
      outputPlatformRoot,
      toolPackRoot,
    },
    sidecarBaseDir,
    to: resolveBuildOutput(options.to),
    workspaceRoot: WORKSPACE_ROOT,
  };
}

function resolveMacAppOutputDirectoryName(): string {
  return process.arch === "arm64" ? "mac-arm64" : "mac";
}

function resolveElectronPackageRoot(config: ToolPackConfig): string {
  const require = createRequire(join(config.workspaceRoot, "apps", "desktop", "package.json"));
  return dirname(require.resolve("electron/package.json"));
}

function resolveElectronVersion(config: ToolPackConfig): string {
  const packageJson = JSON.parse(readFileSync(join(resolveElectronPackageRoot(config), "package.json"), "utf8")) as {
    version?: string;
  };
  if (typeof packageJson.version !== "string" || packageJson.version.length === 0) {
    throw new Error("failed to resolve electron package version");
  }
  return packageJson.version;
}

function resolveElectronDistPath(config: ToolPackConfig): string {
  return join(resolveElectronPackageRoot(config), "dist");
}

function resolveMacPaths(config: ToolPackConfig): MacPaths {
  const namespaceToken = sanitizeNamespace(config.namespace);
  const namespaceOutputRoot = config.roots.outputNamespaceRoot;
  const appBuilderOutputRoot = join(namespaceOutputRoot, "app-builder");
  const appPath = join(appBuilderOutputRoot, resolveMacAppOutputDirectoryName(), `${PRODUCT_NAME}.app`);
  const dataRoot = join(namespaceOutputRoot, "data");
  const logsRoot = join(namespaceOutputRoot, "app-logs");

  return {
    appBuilderConfigPath: join(appBuilderOutputRoot, "config.json"),
    appBuilderOutputRoot,
    appExecutablePath: join(appPath, "Contents", "MacOS", PRODUCT_NAME),
    appPath,
    appTarballsRoot: join(namespaceOutputRoot, "tarballs"),
    assembledAppRoot: join(namespaceOutputRoot, "assembled", "app"),
    assembledMainEntryPath: join(namespaceOutputRoot, "assembled", "app", "main.cjs"),
    assembledPackageJsonPath: join(namespaceOutputRoot, "assembled", "app", "package.json"),
    bakedConfigPath: join(namespaceOutputRoot, "assembled", "app", CONFIG_FILE_NAME),
    controllerSocketPath: resolveDesktopIpcPath({ base: config.sidecarBaseDir, namespace: config.namespace }),
    dataRoot,
    dmgPath: join(namespaceOutputRoot, "dmg", `${PRODUCT_NAME}-${namespaceToken}.dmg`),
    installApplicationsRoot: join(namespaceOutputRoot, "install", "Applications"),
    installedAppPath: join(namespaceOutputRoot, "install", "Applications", `${PRODUCT_NAME}.app`),
    installedExecutablePath: join(
      namespaceOutputRoot,
      "install",
      "Applications",
      `${PRODUCT_NAME}.app`,
      "Contents",
      "MacOS",
      PRODUCT_NAME,
    ),
    launchConfigPath: join(namespaceOutputRoot, "launch", CONFIG_FILE_NAME),
    logDir: join(namespaceOutputRoot, "logs"),
    logsRoot,
    mountPoint: join(namespaceOutputRoot, "mount"),
    namespaceOutputRoot,
    sidecarBaseDir: config.sidecarBaseDir,
    volumeName: `${PRODUCT_NAME}-${namespaceToken}`,
  };
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function clearQuarantine(path: string): Promise<void> {
  try {
    await execFileAsync("xattr", ["-dr", "com.apple.quarantine", path]);
  } catch {
    // Unsigned local artifacts may not have quarantine metadata.
  }
}

async function runPnpm(config: ToolPackConfig, args: string[], extraEnv: NodeJS.ProcessEnv = {}): Promise<void> {
  const invocation = createPackageManagerInvocation(args, process.env);
  await execFileAsync(invocation.command, invocation.args, {
    cwd: config.workspaceRoot,
    env: { ...process.env, ...extraEnv },
    maxBuffer: 64 * 1024 * 1024,
  });
}

async function runNpmInstall(appRoot: string): Promise<void> {
  await execFileAsync("npm", ["install", "--omit=dev", "--ignore-scripts", "--no-package-lock"], {
    cwd: appRoot,
    env: process.env,
    maxBuffer: 64 * 1024 * 1024,
  });
}

async function buildWorkspaceArtifacts(config: ToolPackConfig): Promise<void> {
  await runPnpm(config, ["-C", "packages/shared", "build"]);
  await runPnpm(config, ["-C", "packages/platform", "build"]);
  await runPnpm(config, ["-C", "packages/sidecar", "build"]);
  await runPnpm(config, ["-C", "apps/nextjs", "build"]);
  await runPnpm(config, ["-C", "apps/desktop", "build"]);
  await runPnpm(config, ["-C", "apps/packaged", "build"]);
}

async function collectWorkspaceTarballs(config: ToolPackConfig): Promise<PackedTarballInfo[]> {
  const macPaths = resolveMacPaths(config);
  await rm(macPaths.appTarballsRoot, { force: true, recursive: true });
  await mkdir(macPaths.appTarballsRoot, { recursive: true });

  const packedTarballs: PackedTarballInfo[] = [];
  for (const packageInfo of INTERNAL_TARBALL_PACKAGES) {
    const beforeEntries = new Set(await readdir(macPaths.appTarballsRoot));
    await runPnpm(config, ["-C", packageInfo.directory, "pack", "--pack-destination", macPaths.appTarballsRoot]);
    const afterEntries = await readdir(macPaths.appTarballsRoot);
    const newEntries = afterEntries.filter((entry) => !beforeEntries.has(entry));

    if (newEntries.length !== 1) {
      throw new Error(`expected exactly one tarball for ${packageInfo.name}, got ${newEntries.length}`);
    }

    packedTarballs.push({ fileName: newEntries[0], packageName: packageInfo.name });
  }

  return packedTarballs;
}

async function readPackageVersion(config: ToolPackConfig, packageDir: string): Promise<string> {
  const packageJson = JSON.parse(await readFile(join(config.workspaceRoot, packageDir, "package.json"), "utf8")) as {
    version?: string;
  };
  if (typeof packageJson.version !== "string" || packageJson.version.length === 0) {
    throw new Error(`missing package version: ${packageDir}`);
  }
  return packageJson.version;
}

function createPackagedConfig(config: ToolPackConfig): Record<string, string> {
  const macPaths = resolveMacPaths(config);
  return {
    dataRoot: macPaths.dataRoot,
    logsRoot: macPaths.logsRoot,
    namespace: config.namespace,
    sidecarBase: config.sidecarBaseDir,
  };
}

async function writePackagedConfig(filePath: string, config: ToolPackConfig): Promise<void> {
  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(createPackagedConfig(config), null, 2)}\n`, "utf8");
}

async function writeAssembledAppRoot(
  config: ToolPackConfig,
  packedTarballs: Record<string, string>,
): Promise<void> {
  const macPaths = resolveMacPaths(config);
  const packagedVersion = await readPackageVersion(config, "apps/packaged");

  await rm(join(macPaths.namespaceOutputRoot, "assembled"), { force: true, recursive: true });
  await mkdir(macPaths.assembledAppRoot, { recursive: true });
  await writeFile(
    macPaths.assembledPackageJsonPath,
    `${JSON.stringify(
      {
        dependencies: Object.fromEntries(
          INTERNAL_TARBALL_PACKAGES.map((packageInfo) => {
            const tarballFileName = packedTarballs[packageInfo.name];
            if (tarballFileName == null) throw new Error(`missing tarball for ${packageInfo.name}`);
            return [packageInfo.name, `file:../../tarballs/${tarballFileName}`];
          }),
        ),
        main: "./main.cjs",
        name: "open-design-packaged-app",
        private: true,
        productName: PRODUCT_NAME,
        version: packagedVersion,
      },
      null,
      2,
    )}\n`,
    "utf8",
  );
  await writeFile(
    macPaths.assembledMainEntryPath,
    'import("@open-design/packaged").catch((error) => {\n  console.error("open-design packaged entry failed", error);\n  process.exit(1);\n});\n',
    "utf8",
  );
  await writePackagedConfig(macPaths.bakedConfigPath, config);
}

async function assembleStandaloneApp(config: ToolPackConfig): Promise<void> {
  const tarballs = await collectWorkspaceTarballs(config);
  const tarballMap = Object.fromEntries(tarballs.map((item) => [item.packageName, item.fileName]));
  await writeAssembledAppRoot(config, tarballMap);
  await runNpmInstall(resolveMacPaths(config).assembledAppRoot);
}

async function runElectronBuilder(config: ToolPackConfig, targets: Array<"dir" | "dmg">): Promise<void> {
  const macPaths = resolveMacPaths(config);
  const namespaceToken = sanitizeNamespace(config.namespace);
  const packagedVersion = await readPackageVersion(config, "apps/packaged");
  const builderConfig = {
    appId: APP_ID,
    artifactName: `${PRODUCT_NAME}-${namespaceToken}.\${ext}`,
    asar: false,
    buildDependenciesFromSource: false,
    compression: "store",
    directories: {
      output: macPaths.appBuilderOutputRoot,
    },
    dmg: {
      title: macPaths.volumeName,
    },
    electronDist: resolveElectronDistPath(config),
    electronVersion: resolveElectronVersion(config),
    executableName: PRODUCT_NAME,
    extraMetadata: {
      main: "./main.cjs",
      name: "open-design",
      productName: PRODUCT_NAME,
      version: packagedVersion,
    },
    files: ["**/*", "!**/node_modules/.bin", "!**/node_modules/electron{,/**/*}"],
    mac: {
      category: "public.app-category.developer-tools",
      gatekeeperAssess: false,
      hardenedRuntime: false,
      identity: null,
      target: targets,
    },
    nodeGypRebuild: false,
    npmRebuild: false,
    productName: PRODUCT_NAME,
  };

  await rm(macPaths.appBuilderOutputRoot, { force: true, recursive: true });
  await mkdir(macPaths.appBuilderOutputRoot, { recursive: true });
  await writeFile(macPaths.appBuilderConfigPath, `${JSON.stringify(builderConfig, null, 2)}\n`, "utf8");

  const invocation = createPackageManagerInvocation(
    [
      "-C",
      "tools/pack",
      "exec",
      "electron-builder",
      "--mac",
      "--projectDir",
      macPaths.assembledAppRoot,
      "--config",
      macPaths.appBuilderConfigPath,
      "--publish",
      "never",
    ],
    process.env,
  );
  await execFileAsync(invocation.command, invocation.args, {
    cwd: config.workspaceRoot,
    env: { ...process.env, CSC_IDENTITY_AUTO_DISCOVERY: "false" },
    maxBuffer: 64 * 1024 * 1024,
  });
}

async function packMac(config: ToolPackConfig) {
  const macPaths = resolveMacPaths(config);
  const phases: Array<{ phase: string }> = [];

  await buildWorkspaceArtifacts(config);
  phases.push({ phase: "workspace-build" });
  await assembleStandaloneApp(config);
  phases.push({ phase: "assembled-app" });
  await runElectronBuilder(config, config.to === "app" ? ["dir"] : ["dir", "dmg"]);
  phases.push({ phase: "app" });
  await clearQuarantine(macPaths.appPath);

  let dmgPath: string | null = null;
  if (config.to === "dmg" || config.to === "all") {
    const builtDmgPath = join(macPaths.appBuilderOutputRoot, `${PRODUCT_NAME}-${sanitizeNamespace(config.namespace)}.dmg`);
    if (!(await pathExists(builtDmgPath))) {
      throw new Error(`electron-builder did not produce dmg: ${builtDmgPath}`);
    }
    await mkdir(join(macPaths.namespaceOutputRoot, "dmg"), { recursive: true });
    await rm(macPaths.dmgPath, { force: true });
    await rename(builtDmgPath, macPaths.dmgPath);
    await clearQuarantine(macPaths.dmgPath);
    phases.push({ phase: "dmg" });
    dmgPath = macPaths.dmgPath;
  }

  return {
    appPath: macPaths.appPath,
    controllerSocketPath: macPaths.controllerSocketPath,
    dmgPath,
    outputRoot: macPaths.namespaceOutputRoot,
    phases,
    sidecarBaseDir: config.sidecarBaseDir,
    to: config.to,
  };
}

async function detachMount(mountPoint: string): Promise<boolean> {
  try {
    await execFileAsync("hdiutil", ["detach", mountPoint, "-quiet"]);
    return true;
  } catch {
    try {
      await execFileAsync("hdiutil", ["detach", mountPoint, "-force", "-quiet"]);
      return true;
    } catch {
      return false;
    }
  }
}

async function installPackedMacDmg(config: ToolPackConfig) {
  const macPaths = resolveMacPaths(config);
  if (!(await pathExists(macPaths.dmgPath))) {
    throw new Error(`no dmg available for namespace=${config.namespace}; run tools-pack mac build --to=dmg first`);
  }

  await rm(macPaths.mountPoint, { force: true, recursive: true });
  await mkdir(macPaths.mountPoint, { recursive: true });
  await rm(macPaths.installedAppPath, { force: true, recursive: true });
  await mkdir(macPaths.installApplicationsRoot, { recursive: true });

  let detached = false;
  try {
    await execFileAsync("hdiutil", ["attach", macPaths.dmgPath, "-mountpoint", macPaths.mountPoint, "-nobrowse", "-quiet"]);
    await execFileAsync("ditto", [join(macPaths.mountPoint, `${PRODUCT_NAME}.app`), macPaths.installedAppPath]);
    await clearQuarantine(macPaths.installedAppPath);
  } finally {
    detached = await detachMount(macPaths.mountPoint);
  }

  return {
    appPath: macPaths.appPath,
    detached,
    dmgPath: macPaths.dmgPath,
    installedAppPath: macPaths.installedAppPath,
    mountPoint: macPaths.mountPoint,
    namespace: config.namespace,
    volumeName: macPaths.volumeName,
  };
}

async function rotateLatestLog(logDir: string): Promise<string> {
  const latestLogPath = join(logDir, "desktop.latest.log");
  await mkdir(logDir, { recursive: true });

  if (await pathExists(latestLogPath)) {
    const timestamp = new Date().toISOString().replaceAll(":", "-");
    await rename(latestLogPath, join(logDir, `${timestamp}.back.log`));
  }

  return latestLogPath;
}

async function openPackedMacLogStream(config: ToolPackConfig): Promise<{ fd: number; logPath: string }> {
  const logPath = await rotateLatestLog(resolveMacPaths(config).logDir);
  const stream = createWriteStream(logPath, { flags: "a" });
  const fd = await new Promise<number>((resolveOpen, rejectOpen) => {
    stream.on("open", resolveOpen);
    stream.on("error", rejectOpen);
  });
  return { fd, logPath };
}

async function waitForDesktopStatus(socketPath: string, timeoutMs = 30_000): Promise<unknown> {
  const startedAt = Date.now();
  let lastError: unknown = null;

  while (Date.now() - startedAt < timeoutMs) {
    try {
      return await requestJsonIpc(socketPath, { type: "status" }, { timeoutMs: 1000 });
    } catch (error) {
      lastError = error;
      await new Promise((resolveWait) => setTimeout(resolveWait, 150));
    }
  }

  throw new Error(`packaged desktop did not expose status in time: ${formatError(lastError)}`);
}

async function resolveStartTarget(config: ToolPackConfig): Promise<{ appPath: string; executablePath: string; source: "built" | "installed" }> {
  const macPaths = resolveMacPaths(config);
  if (await pathExists(macPaths.installedAppPath)) {
    return { appPath: macPaths.installedAppPath, executablePath: macPaths.installedExecutablePath, source: "installed" };
  }
  if (await pathExists(macPaths.appPath)) {
    return { appPath: macPaths.appPath, executablePath: macPaths.appExecutablePath, source: "built" };
  }
  throw new Error(`no packed mac app available for namespace=${config.namespace}; build or install it first`);
}

async function startPackedMacApp(config: ToolPackConfig) {
  const macPaths = resolveMacPaths(config);
  const target = await resolveStartTarget(config);
  await writePackagedConfig(macPaths.launchConfigPath, config);
  const logStream = await openPackedMacLogStream(config);
  const result = await spawnBackgroundProcess({
    args: createProcessOriginArgs({
      namespace: config.namespace,
      role: DESKTOP_PROCESS_ROLE,
      source: TOOLS_PACK_SOURCE,
    }),
    command: target.executablePath,
    cwd: target.appPath,
    detached: true,
    env: {
      ...process.env,
      [LAUNCH_CONFIG_ENV]: macPaths.launchConfigPath,
    },
    logFd: logStream.fd,
  });
  const status = await waitForDesktopStatus(macPaths.controllerSocketPath);

  return {
    appPath: target.appPath,
    controllerSocketPath: macPaths.controllerSocketPath,
    executablePath: target.executablePath,
    logPath: logStream.logPath,
    namespace: config.namespace,
    pid: result.pid,
    sidecarBaseDir: config.sidecarBaseDir,
    source: target.source,
    status: "started",
    desktopStatus: status,
  };
}

async function findPackedNamespaceRootPids(config: ToolPackConfig, namespace = config.namespace): Promise<number[]> {
  const processes = await listProcessSnapshots();
  return processes
    .filter((processInfo) =>
      matchesStampedProcess(processInfo, {
        namespace,
        role: DESKTOP_PROCESS_ROLE,
        source: TOOLS_PACK_SOURCE,
      }),
    )
    .map((processInfo) => processInfo.pid);
}

async function findPackedNamespaceProcessPids(config: ToolPackConfig, namespace = config.namespace): Promise<number[]> {
  const processes = await listProcessSnapshots();
  return processes
    .filter(
      (processInfo) =>
        processInfo.command.includes(config.roots.toolPackRoot) &&
        matchesStampedProcess(processInfo, { namespace }),
    )
    .map((processInfo) => processInfo.pid);
}

async function findPackedNamespaceProcesses(config: ToolPackConfig, namespace = config.namespace) {
  const processes = await listProcessSnapshots();
  return processes
    .filter(
      (processInfo) =>
        processInfo.command.includes(config.roots.toolPackRoot) &&
        matchesStampedProcess(processInfo, { namespace }),
    )
    .map((processInfo) => ({ command: processInfo.command, pid: processInfo.pid }));
}

async function waitForPackedNamespaceExit(config: ToolPackConfig, namespace = config.namespace, timeoutMs = 5000): Promise<number[]> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const pids = await findPackedNamespaceProcessPids(config, namespace);
    if (pids.length === 0) return [];
    await new Promise((resolveWait) => setTimeout(resolveWait, 120));
  }
  return await findPackedNamespaceProcessPids(config, namespace);
}

async function requestDesktopShutdown(config: ToolPackConfig): Promise<boolean> {
  try {
    await requestJsonIpc(resolveMacPaths(config).controllerSocketPath, { type: "shutdown" }, { timeoutMs: 1500 });
    return true;
  } catch {
    return false;
  }
}

async function stopPackedMacNamespace(config: ToolPackConfig, namespace = config.namespace) {
  const processes = await findPackedNamespaceProcesses(config, namespace);
  const allProcesses = await listProcessSnapshots();
  const rootPids = await findPackedNamespaceRootPids(config, namespace);
  const treePids = collectProcessTreePids(allProcesses, rootPids);
  const gracefulRequested = await requestDesktopShutdown(config);
  const remainingAfterGraceful = gracefulRequested ? await waitForPackedNamespaceExit(config, namespace) : treePids;
  const stop = await stopProcesses(remainingAfterGraceful);
  const residualPids = await findPackedNamespaceProcessPids(config, namespace);
  const residualStop = residualPids.length === 0 ? null : await stopProcesses(residualPids);
  const remaining = await findPackedNamespaceProcesses(config, namespace);

  return {
    gracefulRequested,
    namespace,
    processes,
    remaining,
    status: remaining.length === 0 ? (processes.length === 0 && !gracefulRequested ? "already-stopped" : "stopped") : "partial",
    stop,
    residualStop,
  };
}

async function readPackedMacLogs(config: ToolPackConfig) {
  const logDir = resolveMacPaths(config).logDir;
  const entries = await readdir(logDir).catch(() => []);
  const candidates = await Promise.all(
    entries
      .filter((entry) => entry.endsWith(".latest.log") || entry.endsWith(".back.log"))
      .map(async (entry) => {
        const logPath = join(logDir, entry);
        return { logPath, modifiedAt: (await stat(logPath)).mtimeMs };
      }),
  );
  const logPath = candidates.sort((left, right) => right.modifiedAt - left.modifiedAt)[0]?.logPath ?? null;

  return {
    lines: logPath == null ? [] : await readLogTail(logPath, 200),
    logPath,
    namespace: config.namespace,
  };
}

async function uninstallPackedMacApp(config: ToolPackConfig) {
  const macPaths = resolveMacPaths(config);
  const removed = await pathExists(macPaths.installedAppPath);
  await rm(macPaths.installedAppPath, { force: true, recursive: true });
  return { installedAppPath: macPaths.installedAppPath, namespace: config.namespace, removed };
}

async function cleanupPackedMacNamespace(config: ToolPackConfig) {
  const macPaths = resolveMacPaths(config);
  const detachedMount = await detachMount(macPaths.mountPoint);
  const removedOutputRoot = await pathExists(macPaths.namespaceOutputRoot);
  await rm(macPaths.namespaceOutputRoot, { force: true, recursive: true });
  return {
    detachedMount,
    mountPoint: macPaths.mountPoint,
    namespace: config.namespace,
    outputRoot: macPaths.namespaceOutputRoot,
    removedOutputRoot,
  };
}

async function readNamespaceNames(root: string): Promise<string[]> {
  try {
    const entries = await readdir(root, { withFileTypes: true });
    return entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name);
  } catch {
    return [];
  }
}

async function listPackedMacNamespaces(config: ToolPackConfig) {
  const namespaceNames = new Set(await readNamespaceNames(join(config.roots.outputPlatformRoot, "namespaces")));
  for (const processInfo of await listProcessSnapshots()) {
    const match = processInfo.command.match(/--od-(?:proc|stamp)-namespace(?:=|\s+)([^\s"]+)/);
    if (match?.[1] != null && processInfo.command.includes(config.roots.toolPackRoot)) namespaceNames.add(match[1]);
  }

  return {
    namespaces: await Promise.all(
      [...namespaceNames].sort().map(async (namespace) => ({
        namespace,
        outputRoot: join(config.roots.outputPlatformRoot, "namespaces", namespace),
        processes: await findPackedNamespaceProcesses(config, namespace),
      })),
    ),
    toolPackRoot: config.roots.toolPackRoot,
  };
}

async function resetPackedMacNamespaces(config: ToolPackConfig, dryRun: boolean) {
  const listed = await listPackedMacNamespaces(config);
  const namespaces = [];
  for (const entry of listed.namespaces) {
    const namespaceConfig = resolveToolPackConfig({
      dir: config.roots.toolPackRoot,
      namespace: entry.namespace,
      sidecarBaseDir: join(entry.outputRoot, "sidecar-base"),
    });
    if (dryRun) {
      namespaces.push({ ...entry, actions: ["stop", "cleanup"], cleanup: null, stop: null });
      continue;
    }
    namespaces.push({
      ...entry,
      actions: ["stop", "cleanup"],
      cleanup: await cleanupPackedMacNamespace(namespaceConfig),
      stop: await stopPackedMacNamespace(namespaceConfig, entry.namespace),
    });
  }

  return { dryRun, namespaces, toolPackRoot: config.roots.toolPackRoot };
}

async function handleMacAction(action: string, options: CliOptions): Promise<unknown> {
  const config = resolveToolPackConfig(options);
  switch (action) {
    case "build":
      return await packMac(config);
    case "install":
      return await installPackedMacDmg(config);
    case "start":
      return await startPackedMacApp(config);
    case "stop":
      return await stopPackedMacNamespace(config);
    case "logs":
      return await readPackedMacLogs(config);
    case "uninstall":
      return await uninstallPackedMacApp(config);
    case "cleanup":
      return await cleanupPackedMacNamespace(config);
    case "list":
      return await listPackedMacNamespaces(config);
    case "reset":
      return await resetPackedMacNamespaces(config, options.dryRun === true);
    default:
      throw new Error(`unsupported mac action: ${action}`);
  }
}

const cli = cac("tools-pack");

cli
  .command("mac <action>", "Mac packaging commands: build|install|start|stop|logs|uninstall|cleanup|list|reset")
  .option("--dir <path>", "tools-pack root (default: .tmp/tools-pack)")
  .option("--dry-run", "Describe reset actions without executing")
  .option("--json", "print JSON")
  .option("--namespace <name>", "runtime namespace (default: default)")
  .option("--sidecar-base-dir <path>", "sidecar base directory used by packaged runtime")
  .option("--to <target>", "Build target: app|dmg|all (default: dmg)")
  .action(async (action: string, options: CliOptions) => {
    printJson(await handleMacAction(action, options));
  });

cli.help();

const rawCliArgs = process.argv.slice(2);
const cliArgs = rawCliArgs[0] === "--" ? rawCliArgs.slice(1) : rawCliArgs;
process.argv.splice(2, process.argv.length - 2, ...cliArgs);

try {
  cli.parse();
} catch (error) {
  process.stderr.write(`${formatError(error)}\n`);
  process.exit(1);
}
