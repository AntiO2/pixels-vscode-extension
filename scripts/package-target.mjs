import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";

import { repositoryRoot } from "./lib/core-config.mjs";

const targets = new Set([
  "darwin-arm64",
  "darwin-x64",
  "linux-arm64",
  "linux-x64",
  "win32-arm64",
  "win32-x64",
]);

const target = process.argv[2];
if (target === undefined || !targets.has(target)) {
  throw new Error(
    `target must be one of: ${[...targets].sort().join(", ")}`,
  );
}

const outputDirectory = path.join(repositoryRoot, "out", "vsix");
await fs.mkdir(outputDirectory, { recursive: true });
const output = path.join(
  outputDirectory,
  `pixels-pxl-inspector-${target}-0.1.0.vsix`,
);
const executable = path.join(
  repositoryRoot,
  "node_modules",
  ".bin",
  process.platform === "win32" ? "vsce.cmd" : "vsce",
);

await new Promise((resolve, reject) => {
  const child = spawn(
    executable,
    [
      "package",
      "--no-dependencies",
      "--allow-missing-repository",
      "--target",
      target,
      "--out",
      output,
    ],
    {
      cwd: repositoryRoot,
      stdio: "inherit",
    },
  );
  child.once("error", reject);
  child.once("exit", (code) => {
    if (code === 0) {
      resolve();
    } else {
      reject(new Error(`vsce exited with ${String(code)}`));
    }
  });
});
