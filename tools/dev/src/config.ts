import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  APP_KEYS,
  createRuntimeToken,
  resolveControllerIpcPath,
  resolveLogFilePath,
  resolveManifestPath,
  resolveNamespace,
  resolveNamespaceRoot,
  resolvePointerPath,
  resolveRuntimeRoot,
  resolveToolsDevBase,
} from "@open-design/sidecar";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ENTRY_DIR_NAME = path.basename(__dirname);

export const WORKSPACE_ROOT = path.resolve(__dirname, ENTRY_DIR_NAME === "dist" ? "../../.." : "../../..");

export type ToolDevOptions = {
  daemonPort?: number | string | null;
  json?: boolean;
  namespace?: string;
  toolsDevRoot?: string;
  webPort?: number | string | null;
};

export type NodeEntryInvocation = {
  args: string[];
  command: string;
  entryPath: string;
};

function resolveInternalEntry(name: string): string {
  if (ENTRY_DIR_NAME === "dist") return path.join(__dirname, `${name}.mjs`);
  return path.join(__dirname, `${name}.ts`);
}

function resolveTsxCliPath(): string {
  const require = createRequire(import.meta.url);
  return require.resolve("tsx/cli");
}

export function resolveNodeEntryInvocation(entryPath: string): NodeEntryInvocation {
  return {
    args: entryPath.endsWith(".ts") ? [resolveTsxCliPath(), entryPath] : [entryPath],
    command: process.execPath,
    entryPath,
  };
}

export function resolveBaseConfig(options: ToolDevOptions = {}) {
  const namespace = resolveNamespace({ namespace: options.namespace, env: process.env });
  const toolsDevRoot = resolveToolsDevBase({ base: options.toolsDevRoot, env: process.env });
  const namespaceRoot = resolveNamespaceRoot({ base: toolsDevRoot, namespace });

  return {
    namespace,
    namespaceRoot,
    pointerPath: resolvePointerPath({ base: toolsDevRoot, namespace }),
    toolsDevRoot,
    workspaceRoot: WORKSPACE_ROOT,
  };
}

export function resolveRunConfig(options: ToolDevOptions = {}) {
  const base = resolveBaseConfig(options);
  const runtimeToken = createRuntimeToken();
  const runtimeRoot = resolveRuntimeRoot({
    base: base.toolsDevRoot,
    namespace: base.namespace,
    runtimeToken,
  });
  const controllerIpcPath = resolveControllerIpcPath({
    appKey: "tools-dev",
    base: base.toolsDevRoot,
    namespace: base.namespace,
    runtimeToken,
  });
  const controller = resolveNodeEntryInvocation(resolveInternalEntry("controller"));
  const webRunner = resolveNodeEntryInvocation(resolveInternalEntry("web-runner"));

  return {
    ...base,
    apps: {
      controller: {
        ...controller,
        logPath: resolveLogFilePath({ runtimeRoot, appKey: APP_KEYS.CONTROLLER }),
      },
      daemon: {
        entryPath: path.join(base.workspaceRoot, "apps/daemon/cli.js"),
        logPath: resolveLogFilePath({ runtimeRoot, appKey: APP_KEYS.DAEMON }),
      },
      web: {
        ...webRunner,
        logPath: resolveLogFilePath({ runtimeRoot, appKey: APP_KEYS.WEB }),
      },
    },
    controllerIpcPath,
    manifestPath: resolveManifestPath({ runtimeRoot }),
    runtimeRoot,
    runtimeToken,
  };
}

export function parsePortOption(value: number | string | null | undefined, optionName: string): number | null {
  if (value == null || value === "") return null;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0 || parsed > 65535) {
    throw new Error(`${optionName} must be an integer between 1 and 65535`);
  }
  return parsed;
}
