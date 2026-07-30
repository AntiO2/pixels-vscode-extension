import type {
  ControllerMessage,
  WorkerMessage,
} from "@pixels-inspector/protocol-client";

export interface WorkerTransport {
  post(
    message: ControllerMessage,
    transfer?: readonly ArrayBuffer[],
  ): void;
  onMessage(listener: (message: unknown) => void): () => void;
  onError(listener: (error: Error) => void): () => void;
  terminate(): Promise<void>;
}

export interface WorkerFactory {
  create(): Promise<WorkerTransport>;
}

export type ValidatedWorkerListener = (message: WorkerMessage) => void;
