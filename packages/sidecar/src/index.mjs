import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { createConnection, createServer as createNetServer } from 'node:net';
import { tmpdir } from 'node:os';
import path, { dirname, join, resolve } from 'node:path';

export const APP_KEYS = Object.freeze({
  CONTROLLER: 'controller',
  DAEMON: 'daemon',
  WEB: 'web',
});

export const SIDECAR_BASE_ENV = 'OD_SIDECAR_BASE';
export const SIDECAR_NAMESPACE_ENV = 'OD_SIDECAR_NAMESPACE';
export const NAMESPACE_PREFIX_ENV = 'OD_NAMESPACE_PREFIX';
export const SIDECAR_CONTROLLER_IPC_PATH_ENV = 'OD_SIDECAR_CONTROLLER_IPC_PATH';
export const SIDECAR_IPC_BASE_ENV = 'OD_SIDECAR_IPC_BASE';
export const SIDECAR_RUNTIME_TOKEN_ENV = 'OD_SIDECAR_RUNTIME_TOKEN';

export const STAMP_APP_FLAG = '--od-stamp-app';
export const STAMP_MODE_FLAG = '--od-stamp-mode';
export const STAMP_NAMESPACE_FLAG = '--od-stamp-namespace';
export const STAMP_CONTROLLER_IPC_FLAG = '--od-stamp-controller-ipc';
export const STAMP_RUNTIME_TOKEN_FLAG = '--od-stamp-runtime-token';
export const PROCESS_ROLE_FLAG = '--od-proc-role';
export const PROCESS_NAMESPACE_FLAG = '--od-proc-namespace';
export const PROCESS_SOURCE_FLAG = '--od-proc-source';

const DEFAULT_NAMESPACE = 'default';
const DEFAULT_HOST = '127.0.0.1';
const SHORT_IPC_HASH_LENGTH = 24;
const DARWIN_SHORT_IPC_BASE = '/tmp/open-design-ipc';

function normalizeNamespace(namespace) {
  const value = String(namespace ?? '').trim();
  if (value.length === 0) throw new Error('namespace must not be empty');
  if (/[\\/]/.test(value)) throw new Error(`namespace must not contain path separators: ${value}`);
  return value;
}

export function resolveNamespace(options = {}) {
  return normalizeNamespace(
    options.namespace ??
      options.env?.[SIDECAR_NAMESPACE_ENV] ??
      options.env?.[NAMESPACE_PREFIX_ENV] ??
      DEFAULT_NAMESPACE,
  );
}

export function resolveToolsDevBase(options = {}) {
  return resolve(
    options.base ??
      options.env?.[SIDECAR_BASE_ENV] ??
      join(tmpdir(), 'open-design', 'tools-dev'),
  );
}

export function createRuntimeToken() {
  return randomUUID();
}

export function resolveNamespaceRoot({ base, namespace }) {
  return join(resolveToolsDevBase({ base }), normalizeNamespace(namespace));
}

export function resolveRuntimeRoot({ base, namespace, runtimeToken }) {
  return join(resolveNamespaceRoot({ base, namespace }), 'runs', runtimeToken);
}

export function resolvePointerPath({ base, namespace }) {
  return join(resolveNamespaceRoot({ base, namespace }), 'current.json');
}

export function resolveManifestPath({ runtimeRoot }) {
  return join(runtimeRoot, 'manifest.json');
}

export function resolveLogsDir({ runtimeRoot, appKey }) {
  return join(runtimeRoot, 'logs', appKey);
}

export function resolveLogFilePath({ runtimeRoot, appKey, fileName = 'latest.log' }) {
  return join(resolveLogsDir({ runtimeRoot, appKey }), fileName);
}

export function isWindowsNamedPipePath(value) {
  return typeof value === 'string' && value.startsWith('\\\\.\\pipe\\');
}

export function resolveControllerIpcPath({ appKey = 'tools-dev', base, env = process.env, namespace, runtimeToken }) {
  const hash = createHash('sha256')
    .update(JSON.stringify({ appKey, base: resolveToolsDevBase({ base }), namespace, runtimeToken }))
    .digest('hex')
    .slice(0, SHORT_IPC_HASH_LENGTH);

  if (process.platform === 'win32') {
    return `\\\\.\\pipe\\open-design-${appKey}-${hash}`;
  }

  const ipcBase =
    env[SIDECAR_IPC_BASE_ENV] ??
    (process.platform === 'darwin' ? DARWIN_SHORT_IPC_BASE : join(tmpdir(), 'open-design-ipc'));
  return join(ipcBase, appKey, `${hash}.sock`);
}

export function createSidecarStampArgs({ appKey, controllerIpcPath, mode = 'dev', namespace, runtimeToken }) {
  return [
    `${STAMP_APP_FLAG}=${appKey}`,
    `${STAMP_MODE_FLAG}=${mode}`,
    `${STAMP_NAMESPACE_FLAG}=${namespace}`,
    `${STAMP_CONTROLLER_IPC_FLAG}=${controllerIpcPath}`,
    `${STAMP_RUNTIME_TOKEN_FLAG}=${runtimeToken}`,
  ];
}

export function createProcessOriginArgs({ namespace, role, source = 'tools-dev' }) {
  return [
    `${PROCESS_ROLE_FLAG}=${role}`,
    `${PROCESS_NAMESPACE_FLAG}=${namespace}`,
    `${PROCESS_SOURCE_FLAG}=${source}`,
  ];
}

export function createStampedProcessArgs({ origin, stamp }) {
  return [
    ...createSidecarStampArgs(stamp),
    ...(origin == null ? [] : createProcessOriginArgs(origin)),
  ];
}

export function createStampedLaunchEnv({ controllerIpcPath, extraEnv = process.env, sidecarBase, runtimeToken }) {
  return {
    ...extraEnv,
    [SIDECAR_BASE_ENV]: sidecarBase,
    [SIDECAR_CONTROLLER_IPC_PATH_ENV]: controllerIpcPath,
    [SIDECAR_RUNTIME_TOKEN_ENV]: runtimeToken,
  };
}

export function readFlagValue(args, flagName) {
  const inlinePrefix = `${flagName}=`;
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === flagName) return args[index + 1] ?? null;
    if (typeof argument === 'string' && argument.startsWith(inlinePrefix)) {
      return argument.slice(inlinePrefix.length);
    }
  }
  return null;
}

export function readSidecarStamp(args) {
  const appKey = readFlagValue(args, STAMP_APP_FLAG);
  const mode = readFlagValue(args, STAMP_MODE_FLAG);
  const namespace = readFlagValue(args, STAMP_NAMESPACE_FLAG);
  const controllerIpcPath = readFlagValue(args, STAMP_CONTROLLER_IPC_FLAG);
  const runtimeToken = readFlagValue(args, STAMP_RUNTIME_TOKEN_FLAG);
  if (!appKey || !mode || !namespace || !controllerIpcPath || !runtimeToken) return null;
  return { appKey, controllerIpcPath, mode, namespace, runtimeToken };
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function commandHasArg(command, flagName, value) {
  const escapedFlag = escapeRegExp(flagName);
  const escapedValue = escapeRegExp(value);
  return new RegExp(`(?:^|\\s)${escapedFlag}(?:=${escapedValue}|\\s+${escapedValue})(?=\\s|$)`).test(command);
}

export function matchesStampedProcess(processInfo, criteria = {}) {
  const { command } = processInfo;
  return (
    (criteria.appKey == null || commandHasArg(command, STAMP_APP_FLAG, criteria.appKey)) &&
    (criteria.mode == null || commandHasArg(command, STAMP_MODE_FLAG, criteria.mode)) &&
    (criteria.namespace == null ||
      commandHasArg(command, STAMP_NAMESPACE_FLAG, criteria.namespace) ||
      commandHasArg(command, PROCESS_NAMESPACE_FLAG, criteria.namespace)) &&
    (criteria.runtimeToken == null || commandHasArg(command, STAMP_RUNTIME_TOKEN_FLAG, criteria.runtimeToken)) &&
    (criteria.role == null || commandHasArg(command, PROCESS_ROLE_FLAG, criteria.role)) &&
    (criteria.source == null || commandHasArg(command, PROCESS_SOURCE_FLAG, criteria.source))
  );
}

async function closeServer(server) {
  await new Promise((resolveClose, rejectClose) => {
    server.close((error) => (error == null ? resolveClose() : rejectClose(error)));
  });
}

async function listenOnPort(port, host) {
  const server = createNetServer();
  await new Promise((resolveListen, rejectListen) => {
    server.once('error', rejectListen);
    server.listen({ port, host, exclusive: true }, () => {
      server.off('error', rejectListen);
      resolveListen();
    });
  });
  return server;
}

function parsePort(value, label) {
  if (value == null || value === '') return null;
  const port = Number(value);
  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    throw new Error(`${label} port must be an integer between 1 and 65535`);
  }
  return port;
}

async function allocateForcedPort(port, label, host, reserved) {
  if (reserved.has(port)) {
    throw new Error(`forced ${label} port ${port} conflicts with another managed port`);
  }
  let server;
  try {
    server = await listenOnPort(port, host);
  } catch (error) {
    throw new Error(`forced ${label} port ${port} is not available (${error.code ?? error.message})`);
  } finally {
    if (server) await closeServer(server);
  }
  reserved.add(port);
  return { port, source: 'forced' };
}

async function allocateDynamicPort(label, host, reserved) {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const server = await listenOnPort(0, host);
    const address = server.address();
    await closeServer(server);
    if (address == null || typeof address === 'string') {
      throw new Error(`failed to allocate dynamic ${label} port`);
    }
    if (!reserved.has(address.port)) {
      reserved.add(address.port);
      return { port: address.port, source: 'dynamic' };
    }
  }
  throw new Error(`failed to allocate dynamic ${label} port without conflict`);
}

export async function allocateDevPorts({ daemonPort, host = DEFAULT_HOST, webPort } = {}) {
  const reserved = new Set();
  const forcedDaemon = parsePort(daemonPort, 'daemon');
  const forcedWeb = parsePort(webPort, 'web');
  return {
    daemon: forcedDaemon == null
      ? await allocateDynamicPort('daemon', host, reserved)
      : await allocateForcedPort(forcedDaemon, 'daemon', host, reserved),
    host,
    web: forcedWeb == null
      ? await allocateDynamicPort('web', host, reserved)
      : await allocateForcedPort(forcedWeb, 'web', host, reserved),
  };
}

export async function readJsonFile(filePath) {
  try {
    return JSON.parse(await readFile(filePath, 'utf8'));
  } catch {
    return null;
  }
}

export async function writeJsonFile(filePath, payload) {
  await mkdir(dirname(filePath), { recursive: true });
  const tmpPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(tmpPath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
  await rename(tmpPath, filePath);
}

export async function removeFile(filePath) {
  await rm(filePath, { force: true });
}

export async function removePointerIfCurrent(pointerPath, runtimeToken) {
  const pointer = await readJsonFile(pointerPath);
  if (pointer?.runtimeToken === runtimeToken) await removeFile(pointerPath);
}

async function prepareIpcPath(socketPath) {
  if (isWindowsNamedPipePath(socketPath)) return;
  await mkdir(dirname(socketPath), { recursive: true });
  await rm(socketPath, { force: true });
}

export async function createJsonIpcServer({ handler, socketPath }) {
  await prepareIpcPath(socketPath);
  const server = createNetServer((socket) => {
    let buffer = '';
    socket.on('data', async (chunk) => {
      buffer += chunk.toString();
      const newlineIndex = buffer.indexOf('\n');
      if (newlineIndex < 0) return;
      const frame = buffer.slice(0, newlineIndex);
      try {
        const result = await handler(JSON.parse(frame));
        socket.end(`${JSON.stringify({ ok: true, result })}\n`);
      } catch (error) {
        socket.end(
          `${JSON.stringify({
            ok: false,
            error: { message: error instanceof Error ? error.message : String(error) },
          })}\n`,
        );
      }
    });
  });

  await new Promise((resolveListen, rejectListen) => {
    server.once('error', rejectListen);
    server.listen(socketPath, () => {
      server.off('error', rejectListen);
      resolveListen();
    });
  });

  return {
    async close() {
      await closeServer(server);
      if (!isWindowsNamedPipePath(socketPath)) await rm(socketPath, { force: true });
    },
  };
}

export async function requestJsonIpc(socketPath, payload, { timeoutMs = 1500 } = {}) {
  return await new Promise((resolveRequest, rejectRequest) => {
    const socket = createConnection(socketPath);
    let buffer = '';
    const timeout = setTimeout(() => {
      socket.destroy();
      rejectRequest(new Error(`IPC request timed out: ${socketPath}`));
    }, timeoutMs);

    socket.on('connect', () => {
      socket.write(`${JSON.stringify(payload)}\n`);
    });
    socket.on('data', (chunk) => {
      buffer += chunk.toString();
      const newlineIndex = buffer.indexOf('\n');
      if (newlineIndex < 0) return;
      clearTimeout(timeout);
      socket.end();
      const response = JSON.parse(buffer.slice(0, newlineIndex));
      if (!response.ok) {
        rejectRequest(new Error(response.error?.message ?? 'IPC request failed'));
        return;
      }
      resolveRequest(response.result);
    });
    socket.on('error', (error) => {
      clearTimeout(timeout);
      rejectRequest(error);
    });
  });
}

export const sidecar = Object.freeze({
  allocateDevPorts,
  appKeys: APP_KEYS,
  createRuntimeToken,
  createStampedLaunchEnv,
  createStampedProcessArgs,
  createJsonIpcServer,
  matchesStampedProcess,
  readJsonFile,
  removeFile,
  removePointerIfCurrent,
  requestJsonIpc,
  resolveControllerIpcPath,
  resolveLogFilePath,
  resolveLogsDir,
  resolveManifestPath,
  resolveNamespace,
  resolveNamespaceRoot,
  resolvePointerPath,
  resolveRuntimeRoot,
  resolveToolsDevBase,
  writeJsonFile,
});
