import fs from "node:fs/promises";
import path from "node:path";

import { repositoryRoot } from "./lib/core-config.mjs";
import { run } from "./lib/process.mjs";

// This gate verifies the pin and must exercise that same staged artifact.
// The separately built Scan gate intentionally supports an override; this one does not.
if (process.env.PIXELS_SCAN_WASM_DIR !== undefined) {
  throw new Error("Native Worker corpus gate requires staged Core; unset PIXELS_SCAN_WASM_DIR");
}

const npm = process.platform === "win32" ? "npm.cmd" : "npm";
const compilerTag = path.basename(process.env.CXX ?? "c++")
  .replace(/[^a-zA-Z0-9_.-]/gu, "-");
const executable = path.join(repositoryRoot, "build",
  `core-native-sanitized-${compilerTag}`,
  process.platform === "win32" ? "pixels-inspector-tests.exe" : "pixels-inspector-tests");

// Reconfigure/rebuild first: an old fixture generator must never validate a new pin.
await run(npm, ["run", "test:core-native"], { cwd: repositoryRoot });
await run(npm, ["run", "verify:core"], { cwd: repositoryRoot });
const outputRoot = path.join(repositoryRoot, "out");
await fs.mkdir(outputRoot, { recursive: true });
const directory = await fs.mkdtemp(path.join(outputRoot, "native-worker-corpus-"));
const first = path.join(directory, "first");
const second = path.join(directory, "second");
try {
  for (const target of [first, second]) {
    await run(executable, ["--write-corpus", target], { cwd: repositoryRoot });
  }
  const files = (await fs.readdir(first)).sort();
  if (JSON.stringify(files) !== JSON.stringify((await fs.readdir(second)).sort())) {
    throw new Error("native corpus generation is not deterministic: inventory differs");
  }
  for (const file of files) {
    if (!(await fs.readFile(path.join(first, file))).equals(
      await fs.readFile(path.join(second, file)),
    )) {
      throw new Error(`native corpus generation is not deterministic: ${file}`);
    }
  }
  await run(npm, ["run", "build"], { cwd: repositoryRoot });
  const options = {
    cwd: repositoryRoot,
    env: { ...process.env, PIXELS_WORKER_CORPUS_DIR: first },
  };
  await run(npm, ["test", "--", "tests/worker/node-worker.test.ts"], options);
  await run(process.execPath,
    ["tests/browser/run-browser-tests.mjs", "--worker-only"], options);
  process.stdout.write(`Native-generated corpus: ${String(files.length)} deterministic files; Node + Chromium Workers passed.\n`);
} finally {
  // Only remove this gate's freshly created temporary corpus, never user fixtures.
  await fs.rm(directory, { recursive: true, force: true });
}
