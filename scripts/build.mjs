import fs from "node:fs/promises";
import path from "node:path";

import { build } from "esbuild";

const root = path.resolve(import.meta.dirname, "..");
const dist = path.join(root, "dist");
await fs.mkdir(path.join(dist, "extension"), { recursive: true });
await fs.mkdir(path.join(dist, "tests"), { recursive: true });
await fs.mkdir(path.join(dist, "worker"), { recursive: true });

const shared = {
  bundle: true,
  minify: false,
  sourcemap: true,
  target: "es2023",
};

await Promise.all([
  build({
    ...shared,
    entryPoints: [path.join(root, "extension", "src", "node.ts")],
    outfile: path.join(dist, "extension", "node.cjs"),
    platform: "node",
    format: "cjs",
    external: ["vscode"],
  }),
  build({
    ...shared,
    entryPoints: [path.join(root, "extension", "src", "browser.ts")],
    outfile: path.join(dist, "extension", "browser.js"),
    platform: "browser",
    format: "esm",
    external: ["vscode"],
  }),
  build({
    ...shared,
    entryPoints: [path.join(root, "worker", "src", "node-entry.ts")],
    outfile: path.join(dist, "worker", "node.mjs"),
    platform: "node",
    format: "esm",
  }),
  build({
    ...shared,
    entryPoints: [path.join(root, "worker", "src", "browser-entry.ts")],
    outfile: path.join(dist, "worker", "browser.js"),
    platform: "browser",
    format: "iife",
  }),
  build({
    ...shared,
    entryPoints: [path.join(root, "tests", "browser", "harness.ts")],
    outfile: path.join(dist, "tests", "browser-harness.js"),
    platform: "browser",
    format: "esm",
  }),
]);
