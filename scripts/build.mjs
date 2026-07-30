import fs from "node:fs/promises";
import path from "node:path";

import { build } from "esbuild";

const root = path.resolve(import.meta.dirname, "..");
const dist = path.join(root, "dist");
await fs.rm(dist, { recursive: true, force: true });
await fs.mkdir(path.join(dist, "extension"), { recursive: true });
await fs.mkdir(path.join(dist, "tests"), { recursive: true });
await fs.mkdir(path.join(dist, "worker"), { recursive: true });
await fs.mkdir(path.join(dist, "webview"), { recursive: true });
// This checked-in font is a glyph subset of the pinned @vscode/codicons
// package. Keeping only icons used by Icon.tsx avoids shipping 146 KiB of
// unrelated glyphs in every target VSIX.
await fs.copyFile(
  path.join(root, "webview", "assets", "codicon.ttf"),
  path.join(dist, "webview", "codicon.ttf"),
);
await fs.copyFile(
  path.join(root, "node_modules", "@vscode", "codicons", "LICENSE"),
  path.join(dist, "webview", "codicons.LICENSE.txt"),
);

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
  build({
    ...shared,
    entryPoints: [path.join(root, "webview", "src", "main.tsx")],
    outfile: path.join(dist, "webview", "main.js"),
    platform: "browser",
    format: "iife",
    minify: true,
    jsx: "automatic",
  }),
  build({
    entryPoints: [path.join(root, "webview", "src", "styles.css")],
    outfile: path.join(dist, "webview", "styles.css"),
    bundle: true,
    minify: true,
    external: ["./codicon.ttf"],
  }),
]);
