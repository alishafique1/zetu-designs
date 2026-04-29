import { spawn } from "node:child_process";

import { createPackageManagerInvocation } from "@open-design/platform";

function readFlag(args: string[], flagName: string): string | null {
  const inline = `${flagName}=`;

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === flagName) return args[index + 1] ?? null;
    if (typeof arg === "string" && arg.startsWith(inline)) return arg.slice(inline.length);
  }

  return null;
}

const workspaceRoot = readFlag(process.argv.slice(2), "--workspace-root") ?? process.cwd();
const invocation = createPackageManagerInvocation(["--filter", "@open-design/web", "vite:dev"], process.env);

const child = spawn(invocation.command, invocation.args, {
  cwd: workspaceRoot,
  env: process.env,
  stdio: "inherit",
  windowsHide: process.platform === "win32",
});

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    if (!child.killed) child.kill(signal);
  });
}

child.on("error", (error) => {
  console.error(error instanceof Error ? error.stack || error.message : String(error));
  process.exit(1);
});

child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 0);
});
