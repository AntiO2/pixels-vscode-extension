export {
  BufferRangeSource,
} from "./sources/buffer-range-source.js";
export {
  BrowserWorkerFactory,
} from "./worker/browser-worker-transport.js";
export {
  WorkerSupervisor,
} from "./worker/worker-supervisor.js";

export function activate(): void {
  // Browser custom-editor wiring follows the validated worker boundary.
}

export function deactivate(): void {
  // No global resources are allocated by the validation entry point.
}
