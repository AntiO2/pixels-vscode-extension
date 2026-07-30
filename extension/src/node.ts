export {
  NodeFileRangeSource,
} from "./sources/node-file-range-source.js";
export {
  NodeWorkerFactory,
} from "./worker/node-worker-transport.js";
export {
  WorkerSupervisor,
} from "./worker/worker-supervisor.js";

export function activate(): void {
  // The custom editor is added after the worker/source feasibility gate.
}

export function deactivate(): void {
  // No global resources are allocated by the validation entry point.
}
