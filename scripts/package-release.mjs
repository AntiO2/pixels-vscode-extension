import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";

import { repositoryRoot } from "./lib/core-config.mjs";
import { capture } from "./lib/process.mjs";

const manifest = JSON.parse(
  await fs.readFile(path.join(repositoryRoot, "package.json"), "utf8"),
);
if (
  typeof manifest.version !== "string" ||
  !/^\d+\.\d+\.\d+$/u.test(manifest.version)
) {
  throw new Error("package.json version must use major.minor.patch");
}

const releaseRef =
  process.env.PIXELS_RELEASE_REF ??
  (await capture("git", ["rev-parse", "HEAD"], { cwd: repositoryRoot }));
if (!/^[0-9a-f]{40}$/u.test(releaseRef) && !/^v?\d+\.\d+\.\d+$/u.test(releaseRef)) {
  throw new Error("PIXELS_RELEASE_REF must be a full commit or release tag");
}

const outputDirectory = path.join(repositoryRoot, "out", "vsix");
await fs.mkdir(outputDirectory, { recursive: true });
const output = path.join(
  outputDirectory,
  `pixels-pxl-inspector-${manifest.version}.vsix`,
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
      "--githubBranch",
      releaseRef,
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

process.stdout.write(`${output}\n`);
