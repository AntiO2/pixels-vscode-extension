import path from "node:path";
import { fileURLToPath } from "node:url";

export const repositoryRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
export const coreRoot = path.join(repositoryRoot, "third_party", "pixels");
export const coreCommit =
  "9ccd9407181bf9c88b8d37fedd68fb068a2a30a3";
export const coreAbi = 2;
export const protobufVersion = "3.21.6";
export const nativeBuild = path.join(repositoryRoot, "build", "core-native");
export const wasmBuild = path.join(repositoryRoot, "build", "core-wasm");
export const stagedCore = path.join(repositoryRoot, "resources", "core");
export const manifestPath = path.join(stagedCore, "core-manifest.json");
export const wasmFileName = "pixels-inspector-wasm.wasm";
export const builtLoaderFileName = "pixels-inspector-wasm.cjs";
export const loaderFileName = "pixels-inspector-wasm.cjs";
