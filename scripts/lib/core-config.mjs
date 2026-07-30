import path from "node:path";
import { fileURLToPath } from "node:url";

export const repositoryRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
export const coreRoot = path.join(repositoryRoot, "third_party", "pixels");
export const coreCommit =
  "64b5b5075076c571606dfc65eeebc29886717980";
export const coreAbi = 3;
export const coreCapabilities = Object.freeze([
  "metadata-v2",
  "row-group-layout-v1",
  "generic-page-v1",
  "rows-v1",
  "filter-v1",
  "default-rows-100",
  "max-rows-500",
  "type-inventory-20-v1",
  "portable-nested-v1",
  "inactive-compression-metadata-v1",
  "range-io-v1",
  "cancellation-v1",
]);
export const protobufVersion = "3.21.6";
export const nativeBuild = path.join(repositoryRoot, "build", "core-native");
export const wasmBuild = path.join(repositoryRoot, "build", "core-wasm");
export const stagedCore = path.join(repositoryRoot, "resources", "core");
export const manifestPath = path.join(stagedCore, "core-manifest.json");
export const wasmFileName = "pixels-inspector-wasm.wasm";
export const builtLoaderFileName = "pixels-inspector-wasm.cjs";
export const loaderFileName = "pixels-inspector-wasm.cjs";
