import path from "node:path";

import { coreRoot, repositoryRoot } from "./lib/core-config.mjs";
import { run } from "./lib/process.mjs";

const compiler = process.env.CXX ?? "c++";
const compilerTag = path.basename(compiler).replace(/[^a-zA-Z0-9_.-]/gu, "-");
const buildDirectory = path.join(
  repositoryRoot,
  "build",
  `core-native-sanitized-${compilerTag}`,
);
const linuxNonPieFlags = process.platform === "linux"
  ? [
      // Older Clang ASan runtimes can collide with high-entropy PIE mappings
      // before main(), which makes otherwise clean sanitizer CTests flaky.
      "-DCMAKE_C_FLAGS=-fno-pie",
      "-DCMAKE_CXX_FLAGS=-fno-pie",
      "-DCMAKE_EXE_LINKER_FLAGS=-fsanitize=address,undefined -no-pie",
    ]
  : ["-DCMAKE_EXE_LINKER_FLAGS=-fsanitize=address,undefined"];

await run(
  "git",
  ["submodule", "update", "--init", "cpp/third-party/protobuf"],
  { cwd: coreRoot },
);
await run(
  "cmake",
  [
    "-S",
    path.join(coreRoot, "cpp", "pixels-inspector"),
    "-B",
    buildDirectory,
    "-DCMAKE_BUILD_TYPE=Debug",
    "-DPIXELS_INSPECTOR_BUILD_TESTS=ON",
    "-DPIXELS_INSPECTOR_ENABLE_SANITIZERS=ON",
    ...linuxNonPieFlags,
  ],
  { cwd: repositoryRoot },
);
await run(
  "cmake",
  ["--build", buildDirectory, "--parallel", "2"],
  { cwd: repositoryRoot },
);
await run(
  "ctest",
  ["--test-dir", buildDirectory, "--output-on-failure"],
  { cwd: repositoryRoot },
);
