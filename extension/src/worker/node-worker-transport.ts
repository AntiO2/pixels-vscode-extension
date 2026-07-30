import { Worker } from "node:worker_threads";

import type {
  ControllerMessage,
} from "@pixels-inspector/protocol-client";

import type { WorkerFactory, WorkerTransport } from "./transport.js";

class NodeWorkerTransport implements WorkerTransport {
  public constructor(private readonly worker: Worker) {}

  public post(
    message: ControllerMessage,
    transfer: readonly ArrayBuffer[] = [],
  ): void {
    this.worker.postMessage(message, [...transfer]);
  }

  public onMessage(listener: (message: unknown) => void): () => void {
    this.worker.on("message", listener);
    return () => {
      this.worker.off("message", listener);
    };
  }

  public onError(listener: (error: Error) => void): () => void {
    this.worker.on("error", listener);
    return () => {
      this.worker.off("error", listener);
    };
  }

  public async terminate(): Promise<void> {
    await this.worker.terminate();
  }
}

export class NodeWorkerFactory implements WorkerFactory {
  public constructor(private readonly workerScript: URL) {}

  public create(): Promise<WorkerTransport> {
    return Promise.resolve(
      new NodeWorkerTransport(new Worker(this.workerScript)),
    );
  }
}
