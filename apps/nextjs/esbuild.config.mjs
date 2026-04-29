import { build } from "esbuild";

await build({
  entryPoints: ["./sidecar/index.ts", "./sidecar/server.ts"],
  format: "esm",
  outbase: ".",
  outdir: "./dist",
  packages: "external",
  platform: "node",
  target: "node24",
});
