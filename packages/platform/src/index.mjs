import { execFile, spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { setTimeout as sleep } from 'node:timers/promises';

function quoteWindowsCommandArg(value) {
  if (!/[\s"&<>|^]/.test(value)) return value;
  return `"${value.replace(/"/g, '""')}"`;
}

export function createCommandInvocation({ args = [], command, env = process.env }) {
  if (process.platform === 'win32' && /\.(bat|cmd)$/i.test(command)) {
    return {
      args: ['/d', '/s', '/c', [command, ...args].map(quoteWindowsCommandArg).join(' ')],
      command: env.ComSpec ?? process.env.ComSpec ?? 'cmd.exe',
    };
  }
  return { args, command };
}

export function createPackageManagerInvocation(args, env = process.env) {
  const execPath = env.npm_execpath;
  if (execPath) return { args: [execPath, ...args], command: process.execPath };
  if (process.platform === 'win32') {
    return {
      args: ['/d', '/s', '/c', ['pnpm', ...args].map(quoteWindowsCommandArg).join(' ')],
      command: env.ComSpec ?? process.env.ComSpec ?? 'cmd.exe',
    };
  }
  return { args, command: 'pnpm' };
}

function createLoggedStdio(logFd) {
  return logFd == null ? ['ignore', 'ignore', 'ignore'] : ['ignore', logFd, logFd];
}

async function waitForChildSpawn(child) {
  await new Promise((resolveSpawn, rejectSpawn) => {
    child.once('error', rejectSpawn);
    child.once('spawn', resolveSpawn);
  });
}

export async function spawnBackgroundProcess(request) {
  const invocation = createCommandInvocation(request);
  const child = spawn(invocation.command, invocation.args, {
    cwd: request.cwd,
    detached: request.detached ?? true,
    env: request.env,
    stdio: createLoggedStdio(request.logFd),
    windowsHide: process.platform === 'win32',
  });
  await waitForChildSpawn(child);
  if (child.pid == null) throw new Error(`failed to spawn background process: ${invocation.command}`);
  child.unref();
  return { pid: child.pid };
}

export async function spawnLoggedProcess(request) {
  const invocation = createCommandInvocation(request);
  const child = spawn(invocation.command, invocation.args, {
    cwd: request.cwd,
    detached: request.detached ?? false,
    env: request.env,
    stdio: createLoggedStdio(request.logFd),
    windowsHide: process.platform === 'win32',
  });
  await waitForChildSpawn(child);
  if (child.pid == null) throw new Error(`failed to spawn process: ${invocation.command}`);
  return child;
}

export function isProcessAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if (error?.code === 'ESRCH') return false;
    return true;
  }
}

export async function waitForProcessExit(pid, timeoutMs = 5000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (!isProcessAlive(pid)) return true;
    await sleep(100);
  }
  return !isProcessAlive(pid);
}

function parsePsOutput(stdout) {
  return stdout
    .split(/\r?\n/)
    .map((line) => {
      const match = line.match(/^\s*(\d+)\s+(\d+)\s+(.+)$/);
      if (!match) return null;
      return { pid: Number(match[1]), ppid: Number(match[2]), command: match[3] };
    })
    .filter(Boolean);
}

async function listPosixProcessSnapshots() {
  const stdout = await new Promise((resolveList, rejectList) => {
    execFile('ps', ['-axo', 'pid=,ppid=,command='], { maxBuffer: 8 * 1024 * 1024 }, (error, out) => {
      if (error) rejectList(error);
      else resolveList(out);
    });
  });
  return parsePsOutput(stdout);
}

async function listWindowsProcessSnapshots() {
  const command = [
    "$ErrorActionPreference = 'Stop'",
    'Get-CimInstance Win32_Process | Select-Object ProcessId, ParentProcessId, CommandLine | ConvertTo-Json -Compress',
  ].join('; ');
  const stdout = await new Promise((resolveList, rejectList) => {
    execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', command], { maxBuffer: 8 * 1024 * 1024 }, (error, out) => {
      if (error) rejectList(error);
      else resolveList(out);
    });
  });
  const payload = stdout.trim();
  if (!payload) return [];
  const records = JSON.parse(payload);
  return (Array.isArray(records) ? records : [records])
    .map((record) => {
      const pid = Number(record.ProcessId);
      const ppid = Number(record.ParentProcessId);
      const commandLine = record.CommandLine?.trim();
      if (!commandLine || Number.isNaN(pid) || Number.isNaN(ppid)) return null;
      return { command: commandLine, pid, ppid };
    })
    .filter(Boolean);
}

export async function listProcessSnapshots() {
  try {
    return process.platform === 'win32'
      ? await listWindowsProcessSnapshots()
      : await listPosixProcessSnapshots();
  } catch {
    return [];
  }
}

export function collectProcessTreePids(processes, rootPids) {
  const queue = [...new Set(rootPids)];
  const visited = new Set();
  const childrenByParent = new Map();
  for (const processInfo of processes) {
    const children = childrenByParent.get(processInfo.ppid) ?? [];
    children.push(processInfo.pid);
    childrenByParent.set(processInfo.ppid, children);
  }
  while (queue.length > 0) {
    const pid = queue.shift();
    if (pid == null || visited.has(pid)) continue;
    visited.add(pid);
    for (const childPid of childrenByParent.get(pid) ?? []) {
      if (!visited.has(childPid)) queue.push(childPid);
    }
  }
  return [...visited].sort((left, right) => right - left);
}

function signalProcesses(pids, signal) {
  for (const pid of pids) {
    try {
      process.kill(pid, signal);
    } catch (error) {
      if (error?.code !== 'ESRCH') throw error;
    }
  }
}

async function waitForProcessesToExit(pids, timeoutMs = 5000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const remaining = pids.filter(isProcessAlive);
    if (remaining.length === 0) return [];
    await sleep(100);
  }
  return pids.filter(isProcessAlive);
}

export async function stopProcesses(pids) {
  const uniquePids = [...new Set(pids)].filter((pid) => pid !== process.pid).sort((a, b) => b - a);
  if (uniquePids.length === 0) {
    return { alreadyStopped: true, forcedPids: [], matchedPids: [], remainingPids: [], stoppedPids: [] };
  }
  signalProcesses(uniquePids, 'SIGTERM');
  const remainingAfterTerm = await waitForProcessesToExit(uniquePids);
  if (remainingAfterTerm.length === 0) {
    return { alreadyStopped: false, forcedPids: [], matchedPids: uniquePids, remainingPids: [], stoppedPids: uniquePids };
  }
  signalProcesses(remainingAfterTerm, 'SIGKILL');
  const remainingAfterKill = await waitForProcessesToExit(remainingAfterTerm);
  const stoppedPids = uniquePids.filter((pid) => !remainingAfterKill.includes(pid));
  return { alreadyStopped: false, forcedPids: remainingAfterTerm, matchedPids: uniquePids, remainingPids: remainingAfterKill, stoppedPids };
}

export async function waitForHttpOk(url, { timeoutMs = 20000 } = {}) {
  const startedAt = Date.now();
  let lastError = null;
  while (Date.now() - startedAt < timeoutMs) {
    try {
      const response = await fetch(url, { cache: 'no-store' });
      if (response.ok) return true;
      lastError = new Error(`HTTP ${response.status} from ${url}`);
    } catch (error) {
      lastError = error;
    }
    await sleep(150);
  }
  throw new Error(`timed out waiting for ${url}${lastError ? ` (${lastError.message})` : ''}`);
}

export async function readLogTail(filePath, maxLines = 80) {
  try {
    const payload = await readFile(filePath, 'utf8');
    return payload.split(/\r?\n/).filter((line) => line.length > 0).slice(-maxLines);
  } catch {
    return [];
  }
}
