import { InspectorWorkerCore } from "./worker-core.js";
import type {
  InspectorModuleFactory,
} from "./wasm-types.js";

declare function importScripts(...urls: string[]): void;

interface WorkerFactoryGlobal {
  createPixelsInspector?: InspectorModuleFactory;
}

const workerGlobal = globalThis as typeof globalThis & WorkerFactoryGlobal;
const core = new InspectorWorkerCore(
  {
    loadFactory(loaderUrl): Promise<InspectorModuleFactory> {
      importScripts(loaderUrl);
      const factory = workerGlobal.createPixelsInspector;
      if (factory === undefined) {
        throw new Error("Core loader did not publish createPixelsInspector");
      }
      return Promise.resolve(factory);
    },
    async loadBytes(wasmUrl): Promise<Uint8Array> {
      const response = await fetch(wasmUrl);
      if (!response.ok) {
        throw new Error(
          `unable to fetch Core WASM: ${String(response.status)}`,
        );
      }
      return new Uint8Array(await response.arrayBuffer());
    },
  },
  {
    post(message): void {
      globalThis.postMessage(message);
    },
    close(): void {
      globalThis.close();
    },
  },
);

globalThis.addEventListener("message", (event: MessageEvent<unknown>) => {
  void core.receive(event.data);
});
