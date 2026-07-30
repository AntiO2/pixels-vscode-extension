import type { ControllerMessage } from "@pixels-inspector/protocol-client";

import type { WorkerFactory, WorkerTransport } from "./transport.js";

class BrowserWorkerTransport implements WorkerTransport {
  public constructor(private readonly worker: Worker) {}

  public post(
    message: ControllerMessage,
    transfer: readonly ArrayBuffer[] = [],
  ): void {
    this.worker.postMessage(message, [...transfer]);
  }

  public onMessage(listener: (message: unknown) => void): () => void {
    const handler = (event: MessageEvent<unknown>): void => {
      listener(event.data);
    };
    this.worker.addEventListener("message", handler);
    return () => {
      this.worker.removeEventListener("message", handler);
    };
  }

  public onError(listener: (error: Error) => void): () => void {
    const handler = (event: ErrorEvent): void => {
      listener(
        event.error instanceof Error
          ? event.error
          : new Error(event.message || "browser worker crashed"),
      );
    };
    this.worker.addEventListener("error", handler);
    return () => {
      this.worker.removeEventListener("error", handler);
    };
  }

  public terminate(): Promise<void> {
    this.worker.terminate();
    return Promise.resolve();
  }
}

export class BrowserWorkerFactory implements WorkerFactory {
  public constructor(private readonly workerUrl: string | URL) {}

  public create(): Promise<WorkerTransport> {
    return Promise.resolve(
      new BrowserWorkerTransport(new Worker(this.workerUrl)),
    );
  }
}
