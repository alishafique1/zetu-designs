import { createServer as createHttpServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import type { AddressInfo } from "node:net";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  createJsonIpcServer,
  type JsonIpcServerHandle,
  type NextjsStatusSnapshot,
  type SidecarRuntimeContext,
} from "@open-design/sidecar";

const HOST = "127.0.0.1";
const NEXTJS_PORT_ENV = "OD_NEXTJS_PORT";
const require = createRequire(import.meta.url);
const createNextServer = require("next") as (options: { dev: boolean; dir: string }) => {
  close?: () => Promise<void>;
  getRequestHandler(): (request: IncomingMessage, response: ServerResponse) => Promise<void>;
  prepare(): Promise<void>;
};

export type NextjsSidecarHandle = {
  status(): Promise<NextjsStatusSnapshot>;
  stop(): Promise<void>;
  waitUntilStopped(): Promise<void>;
};

function resolveNextjsRoot(): string {
  let current = dirname(fileURLToPath(import.meta.url));

  for (let depth = 0; depth < 8; depth += 1) {
    try {
      const packageJson = JSON.parse(readFileSync(join(current, "package.json"), "utf8")) as { name?: unknown };
      if (packageJson.name === "@open-design/nextjs") return current;
    } catch {
      // Keep walking until the package root is found. This must work from both
      // sidecar/*.ts under tsx and dist/sidecar/*.js in packaged installs.
    }

    const parent = dirname(current);
    if (parent === current) break;
    current = parent;
  }

  throw new Error("failed to resolve @open-design/nextjs package root");
}

function parsePort(value: string | undefined): number {
  if (value == null || value.trim().length === 0) return 0;
  const port = Number(value);
  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    throw new Error(`${NEXTJS_PORT_ENV} must be an integer between 1 and 65535`);
  }
  return port;
}

async function listen(server: Server, port: number): Promise<number> {
  await new Promise<void>((resolveListen, rejectListen) => {
    server.once("error", rejectListen);
    server.listen({ host: HOST, port }, () => {
      server.off("error", rejectListen);
      resolveListen();
    });
  });

  const address = server.address() as AddressInfo | string | null;
  if (address == null || typeof address === "string") {
    throw new Error("failed to resolve Next.js server address");
  }
  return address.port;
}

async function closeHttpServer(server: Server): Promise<void> {
  if (!server.listening) return;
  await new Promise<void>((resolveClose, rejectClose) => {
    server.close((error) => (error == null ? resolveClose() : rejectClose(error)));
  });
}

export async function startNextjsSidecar(runtime: SidecarRuntimeContext): Promise<NextjsSidecarHandle> {
  const dir = resolveNextjsRoot();
  const app = createNextServer({ dev: runtime.mode === "dev", dir });
  await app.prepare();

  const handleRequest = app.getRequestHandler();
  const httpServer = createHttpServer((request, response) => {
    void handleRequest(request, response).catch((error: unknown) => {
      response.statusCode = 500;
      response.end(error instanceof Error ? error.message : String(error));
    });
  });
  const port = await listen(httpServer, parsePort(process.env[NEXTJS_PORT_ENV]));
  const state: NextjsStatusSnapshot = {
    pid: process.pid,
    state: "running",
    updatedAt: new Date().toISOString(),
    url: `http://${HOST}:${port}`,
  };
  let ipcServer: JsonIpcServerHandle | null = null;
  let stopped = false;
  let resolveStopped!: () => void;
  const stoppedPromise = new Promise<void>((resolveStop) => {
    resolveStopped = resolveStop;
  });

  async function stop(): Promise<void> {
    if (stopped) return;
    stopped = true;
    state.state = "stopped";
    state.updatedAt = new Date().toISOString();
    await ipcServer?.close().catch(() => undefined);
    await closeHttpServer(httpServer).catch(() => undefined);
    await (app as unknown as { close?: () => Promise<void> }).close?.().catch(() => undefined);
    resolveStopped();
  }

  ipcServer = await createJsonIpcServer({
    socketPath: runtime.ipcPath,
    handler: async (message: { type?: string }) => {
      if (message?.type === "status") return { ...state };
      if (message?.type === "shutdown") {
        setImmediate(() => {
          void stop().finally(() => process.exit(0));
        });
        return { accepted: true };
      }
      throw new Error(`unknown nextjs sidecar message: ${message?.type}`);
    },
  });

  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    process.on(signal, () => {
      void stop().finally(() => process.exit(0));
    });
  }

  return {
    async status() {
      return { ...state };
    },
    stop,
    waitUntilStopped() {
      return stoppedPromise;
    },
  };
}
