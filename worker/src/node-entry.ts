import fs from "node:fs/promises";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { parentPort } from "node:worker_threads";

import { InspectorWorkerCore } from "./worker-core.js";
import type {
  InspectorModuleFactory,
} from "./wasm-types.js";

if (parentPort === null) {
  throw new Error("Pixels inspector worker requires a parent port");
}

const require = createRequire(import.meta.url);
const port = parentPort;
const core = new InspectorWorkerCore(
  {
    loadFactory(loaderUrl): Promise<InspectorModuleFactory> {
      const loaderPath = loaderUrl.startsWith("file:")
        ? fileURLToPath(loaderUrl)
        : loaderUrl;
      return Promise.resolve(require(loaderPath) as InspectorModuleFactory);
    },
    async loadBytes(wasmUrl): Promise<Uint8Array> {
      const wasmPath = wasmUrl.startsWith("file:")
        ? fileURLToPath(wasmUrl)
        : wasmUrl;
      return await fs.readFile(wasmPath);
    },
  },
  {
    post(message): void {
      port.postMessage(message);
    },
    close(): void {
      port.close();
    },
  },
);

port.on("message", (message: unknown) => {
  void core.receive(message);
});
