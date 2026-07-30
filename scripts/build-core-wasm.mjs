import fs from "node:fs/promises";
import path from "node:path";

import {
  coreCommit,
  coreRoot,
  nativeBuild,
  repositoryRoot,
  wasmBuild,
} from "./lib/core-config.mjs";
import { capture, run } from "./lib/process.mjs";

const actualCommit = await capture("git", ["rev-parse", "HEAD"], {
  cwd: coreRoot,
});
if (actualCommit !== coreCommit) {
  throw new Error(
    `Pixels submodule must be ${coreCommit}; found ${actualCommit}`,
  );
}

await run(
  "git",
  ["submodule", "update", "--init", "cpp/third-party/protobuf"],
  { cwd: coreRoot },
);

const coreStatus = await capture("git", ["status", "--porcelain"], {
  cwd: coreRoot,
});
if (coreStatus !== "") {
  throw new Error(
    "Pixels submodule has uncommitted changes; commit them in third_party/pixels before building",
  );
}

await fs.mkdir(nativeBuild, { recursive: true });
await run(
  "cmake",
  [
    "-S",
    path.join(coreRoot, "cpp", "pixels-inspector"),
    "-B",
    nativeBuild,
    "-DCMAKE_BUILD_TYPE=Release",
    "-DPIXELS_INSPECTOR_BUILD_TESTS=OFF",
  ],
  { cwd: repositoryRoot },
);
await run(
  "cmake",
  ["--build", nativeBuild, "--target", "protoc", "--parallel", "2"],
  { cwd: repositoryRoot },
);

const emcmake = process.env.PIXELS_EMCMAKE ?? "emcmake";
await fs.mkdir(wasmBuild, { recursive: true });
await run(
  emcmake,
  [
    "cmake",
    "-S",
    path.join(coreRoot, "cpp", "pixels-inspector"),
    "-B",
    wasmBuild,
    "-DCMAKE_BUILD_TYPE=Release",
    "-DPIXELS_INSPECTOR_BUILD_TESTS=OFF",
    `-DPIXELS_PROTOC_EXECUTABLE=${path.join(
      nativeBuild,
      "third-party",
      "protobuf",
      process.platform === "win32" ? "protoc.exe" : "protoc",
    )}`,
  ],
  { cwd: repositoryRoot },
);
await run(
  "cmake",
  [
    "--build",
    wasmBuild,
    "--target",
    "pixels-inspector-wasm",
    "--parallel",
    "2",
  ],
  { cwd: repositoryRoot },
);
