import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

import {
  coreAbi,
  coreCapabilities,
  builtLoaderFileName,
  coreCommit,
  coreRoot,
  loaderFileName,
  manifestPath,
  protobufVersion,
  stagedCore,
  wasmBuild,
  wasmFileName,
} from "./lib/core-config.mjs";

async function sha256(filePath) {
  const bytes = await fs.readFile(filePath);
  return createHash("sha256").update(bytes).digest("hex");
}

const emscriptenVersion = (
  await fs.readFile(
    path.join(
      coreRoot,
      "cpp",
      "pixels-inspector",
      "toolchain",
      "emscripten.version",
    ),
    "utf8",
  )
).trim();

await fs.mkdir(stagedCore, { recursive: true });
const inputs = [
  {
    fileName: loaderFileName,
    source: path.join(wasmBuild, builtLoaderFileName),
  },
  {
    fileName: wasmFileName,
    source: path.join(wasmBuild, wasmFileName),
  },
];

const artifacts = {};
for (const input of inputs) {
  const destination = path.join(stagedCore, input.fileName);
  const temporary = `${destination}.tmp`;
  await fs.copyFile(input.source, temporary);
  await fs.rename(temporary, destination);
  const stat = await fs.stat(destination);
  artifacts[input.fileName] = {
    bytes: stat.size,
    sha256: await sha256(destination),
  };
}

const manifest = {
  schemaVersion: 1,
  abiVersion: coreAbi,
  coreCommit,
  toolchain: {
    emscripten: emscriptenVersion,
    protobuf: protobufVersion,
  },
  capabilities: coreCapabilities,
  artifacts,
};
const temporaryManifest = `${manifestPath}.tmp`;
await fs.writeFile(
  temporaryManifest,
  `${JSON.stringify(manifest, undefined, 2)}\n`,
);
await fs.rename(temporaryManifest, manifestPath);
