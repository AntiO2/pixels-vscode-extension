import path from "node:path";

import { repositoryRoot, stagedCore } from "./lib/core-config.mjs";
import { run } from "./lib/process.mjs";

const npm = process.platform === "win32" ? "npm.cmd" : "npm";

for (const script of ["build:core", "stage:core", "build"]) {
  await run(npm, ["run", script], { cwd: repositoryRoot });
}

await run(
  npm,
  ["test", "--", "tests/worker/scan-worker.test.ts"],
  {
    cwd: repositoryRoot,
    env: {
      ...process.env,
      PIXELS_SCAN_WASM_DIR: path.resolve(stagedCore),
    },
  },
);
