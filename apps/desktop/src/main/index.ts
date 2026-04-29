import { realpathSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { app, BrowserWindow } from "electron";

import {
  APP_KEYS,
  bootstrapSidecarRuntime,
  createJsonIpcServer,
  type DesktopClickInput,
  type DesktopClickResult,
  type DesktopConsoleEntry,
  type DesktopConsoleResult,
  type DesktopEvalInput,
  type DesktopEvalResult,
  type DesktopScreenshotInput,
  type DesktopScreenshotResult,
  type DesktopStatusSnapshot,
  inspectNextjsRuntime,
  type JsonIpcServerHandle,
  type SidecarRuntimeContext,
} from "@open-design/sidecar";

const PENDING_POLL_MS = 120;
const RUNNING_POLL_MS = 2000;
const MAX_CONSOLE_ENTRIES = 200;

type DesktopRuntime = {
  close(): Promise<void>;
  click(input: DesktopClickInput): Promise<DesktopClickResult>;
  console(): DesktopConsoleResult;
  eval(input: DesktopEvalInput): Promise<DesktopEvalResult>;
  screenshot(input: DesktopScreenshotInput): Promise<DesktopScreenshotResult>;
  status(): DesktopStatusSnapshot;
};

export type DesktopMainOptions = {
  beforeShutdown?: () => Promise<void>;
};

function isDirectEntry(): boolean {
  const entryPath = process.argv[1];
  if (entryPath == null || entryPath.length === 0 || entryPath.startsWith("--")) return false;

  try {
    return realpathSync(entryPath) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

function createPendingHtml(): string {
  return `data:text/html;charset=utf-8,${encodeURIComponent(`<!doctype html>
<html>
  <head>
    <title>Open Design</title>
    <style>
      body {
        align-items: center;
        background: #05070d;
        color: #f7f7fb;
        display: flex;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        height: 100vh;
        justify-content: center;
        margin: 0;
      }
      main {
        background: rgba(255, 255, 255, 0.08);
        border: 1px solid rgba(255, 255, 255, 0.14);
        border-radius: 24px;
        padding: 32px;
      }
      p { color: #aeb7d5; margin: 12px 0 0; }
    </style>
  </head>
  <body>
    <main>
      <h1>Open Design</h1>
      <p>Waiting for the Next.js sidecar URL…</p>
    </main>
  </body>
</html>`)}`;
}

function normalizeScreenshotPath(filePath: string): string {
  return isAbsolute(filePath) ? filePath : resolve(process.cwd(), filePath);
}

function mapConsoleLevel(level: number): string {
  switch (level) {
    case 0:
      return "debug";
    case 1:
      return "info";
    case 2:
      return "warn";
    case 3:
      return "error";
    default:
      return "log";
  }
}

async function createDesktopRuntime(runtime: SidecarRuntimeContext): Promise<DesktopRuntime> {
  const consoleEntries: DesktopConsoleEntry[] = [];
  const window = new BrowserWindow({
    height: 900,
    show: true,
    title: "Open Design",
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
    width: 1280,
  });
  let currentUrl: string | null = null;
  let stopped = false;
  let timer: NodeJS.Timeout | null = null;

  (window.webContents as any).on("console-message", (event: { level?: number | string; message?: string }) => {
    const level = typeof event.level === "number" ? mapConsoleLevel(event.level) : (event.level ?? "log");
    consoleEntries.push({
      level,
      text: event.message ?? "",
      timestamp: new Date().toISOString(),
    });
    if (consoleEntries.length > MAX_CONSOLE_ENTRIES) {
      consoleEntries.splice(0, consoleEntries.length - MAX_CONSOLE_ENTRIES);
    }
  });

  await window.loadURL(createPendingHtml());

  const schedule = (delayMs: number) => {
    if (stopped) return;
    timer = setTimeout(() => {
      void tick();
    }, delayMs);
  };

  const tick = async () => {
    if (stopped || window.isDestroyed()) return;

    try {
      const nextjs = await inspectNextjsRuntime({ base: runtime.base, namespace: runtime.namespace }, 600);
      if (nextjs?.url != null && nextjs.url !== currentUrl) {
        currentUrl = nextjs.url;
        await window.loadURL(nextjs.url);
      }
      schedule(nextjs?.url == null ? PENDING_POLL_MS : RUNNING_POLL_MS);
    } catch (error) {
      console.error("desktop nextjs discovery failed", error);
      schedule(PENDING_POLL_MS);
    }
  };

  void tick();

  return {
    async click(input) {
      if (window.isDestroyed()) return { clicked: false, found: false };
      const selector = JSON.stringify(input.selector);
      return await window.webContents.executeJavaScript(
        `(() => {
          const element = document.querySelector(${selector});
          if (!element) return { found: false, clicked: false };
          if (typeof element.click === "function") element.click();
          return { found: true, clicked: true };
        })()`,
        true,
      );
    },
    async close() {
      stopped = true;
      if (timer != null) {
        clearTimeout(timer);
        timer = null;
      }
      if (!window.isDestroyed()) window.close();
    },
    console() {
      return { entries: [...consoleEntries] };
    },
    async eval(input) {
      if (window.isDestroyed()) return { error: "desktop window is destroyed", ok: false };
      try {
        const value = await window.webContents.executeJavaScript(input.expression, true);
        return { ok: true, value };
      } catch (error) {
        return { error: error instanceof Error ? error.message : String(error), ok: false };
      }
    },
    async screenshot(input) {
      if (window.isDestroyed()) throw new Error("desktop window is destroyed");
      const outputPath = normalizeScreenshotPath(input.path);
      const image = await window.webContents.capturePage();
      await mkdir(dirname(outputPath), { recursive: true });
      await writeFile(outputPath, image.toPNG());
      return { path: outputPath };
    },
    status() {
      return {
        pid: process.pid,
        state: window.isDestroyed() ? "unknown" : "running",
        title: window.isDestroyed() ? null : window.getTitle(),
        updatedAt: new Date().toISOString(),
        url: currentUrl,
        windowVisible: !window.isDestroyed() && window.isVisible(),
      };
    },
  };
}

export async function runDesktopMain(
  runtime: SidecarRuntimeContext,
  options: DesktopMainOptions = {},
): Promise<void> {
  await app.whenReady();

  const desktop = await createDesktopRuntime(runtime);
  let ipcServer: JsonIpcServerHandle | null = null;
  let shuttingDown = false;

  async function shutdown(): Promise<void> {
    if (shuttingDown) return;
    shuttingDown = true;
    await options.beforeShutdown?.().catch((error: unknown) => {
      console.error("desktop beforeShutdown failed", error);
    });
    await ipcServer?.close().catch(() => undefined);
    await desktop.close().catch(() => undefined);
    app.quit();
  }

  ipcServer = await createJsonIpcServer({
    socketPath: runtime.ipcPath,
    handler: async (message: { input?: unknown; type?: string }) => {
      switch (message?.type) {
        case "status":
          return desktop.status();
        case "eval":
          return await desktop.eval(message.input as DesktopEvalInput);
        case "screenshot":
          return await desktop.screenshot(message.input as DesktopScreenshotInput);
        case "console":
          return desktop.console();
        case "click":
          return await desktop.click(message.input as DesktopClickInput);
        case "shutdown":
          setImmediate(() => {
            void shutdown().finally(() => process.exit(0));
          });
          return { accepted: true };
        default:
          throw new Error(`unknown desktop sidecar message: ${message?.type}`);
      }
    },
  });

  app.on("window-all-closed", () => {
    void shutdown().finally(() => process.exit(0));
  });

  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    process.on(signal, () => {
      void shutdown().finally(() => process.exit(0));
    });
  }
}

if (isDirectEntry()) {
  const runtime = bootstrapSidecarRuntime(process.argv.slice(2), process.env, {
    appKey: APP_KEYS.DESKTOP,
  });

  void runDesktopMain(runtime).catch((error: unknown) => {
    console.error(error instanceof Error ? error.stack || error.message : String(error));
    process.exit(1);
  });
}
