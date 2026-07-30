import type {
  ControllerMessage,
  CoreManifest,
} from "@pixels-inspector/protocol-client";
import {
  PROTOCOL_VERSION,
  decodeCoreCapabilities,
} from "@pixels-inspector/protocol-client";
import { describe, expect, it, vi } from "vitest";

import { BufferRangeSource } from "../../extension/src/sources/buffer-range-source.js";
import type {
  WorkerFactory,
  WorkerTransport,
} from "../../extension/src/worker/transport.js";
import { WorkerSupervisor } from "../../extension/src/worker/worker-supervisor.js";

type FailureMode =
  | "abiMismatch"
  | "crashOnInspect"
  | "idle"
  | "staleOnInspect";

const manifest: CoreManifest = {
  schemaVersion: 1,
  abiVersion: 2,
  coreCommit: "7".repeat(40),
  toolchain: {
    emscripten: "6.0.5",
    protobuf: "3.21.6",
  },
  capabilities: ["metadata-v1"],
  artifacts: {
    "pixels-inspector-wasm.wasm": {
      bytes: 4,
      sha256: "a".repeat(64),
    },
  },
};

const capabilities = decodeCoreCapabilities({
  abi: 2,
  page: "generic-v1",
  types: Array.from({ length: 20 }, (_value, kind) => ({
    kind,
    name: `TYPE_${String(kind)}`,
  })),
  encodings: ["NONE"],
  nested: "portable-v1",
});

class FakeTransport implements WorkerTransport {
  private readonly messageListeners =
    new Set<(message: unknown) => void>();
  private readonly errorListeners = new Set<(error: Error) => void>();
  private terminated = false;

  public constructor(private readonly mode: FailureMode) {}

  public post(message: ControllerMessage): void {
    if (this.terminated) {
      return;
    }
    if (message.kind === "initialize") {
      queueMicrotask(() => {
        this.emitMessage({
          kind: "ready",
          version: PROTOCOL_VERSION,
          generation: message.generation,
          abi: this.mode === "abiMismatch" ? 1 : 2,
          coreDigest: "a".repeat(64),
          capabilities,
        });
      });
      return;
    }
    if (message.kind === "inspectMetadata") {
      if (this.mode === "crashOnInspect") {
        queueMicrotask(() => {
          this.emitError(new Error("synthetic worker crash"));
        });
      } else if (this.mode === "staleOnInspect") {
        queueMicrotask(() => {
          this.emitMessage({
            kind: "result",
            requestId: "stale-request",
            operation: "metadata",
            json: "{}",
          });
        });
      }
    }
  }

  public onMessage(listener: (message: unknown) => void): () => void {
    this.messageListeners.add(listener);
    return () => {
      this.messageListeners.delete(listener);
    };
  }

  public onError(listener: (error: Error) => void): () => void {
    this.errorListeners.add(listener);
    return () => {
      this.errorListeners.delete(listener);
    };
  }

  public terminate(): Promise<void> {
    this.terminated = true;
    this.messageListeners.clear();
    this.errorListeners.clear();
    return Promise.resolve();
  }

  private emitMessage(message: unknown): void {
    for (const listener of this.messageListeners) {
      listener(message);
    }
  }

  private emitError(error: Error): void {
    for (const listener of this.errorListeners) {
      listener(error);
    }
  }
}

class FakeFactory implements WorkerFactory {
  public created = 0;

  public constructor(private readonly modes: readonly FailureMode[]) {}

  public create(): Promise<WorkerTransport> {
    const mode = this.modes[this.created] ?? "idle";
    this.created += 1;
    return Promise.resolve(new FakeTransport(mode));
  }
}

function createSource(): BufferRangeSource {
  return new BufferRangeSource(
    "test-provider://supervisor/failure",
    new Uint8Array(8),
  );
}

function createSupervisor(
  factory: WorkerFactory,
  timeout = 100,
): WorkerSupervisor {
  return new WorkerSupervisor(
    factory,
    manifest,
    {
      loaderUrl: "unused-loader",
      wasmUrl: "unused-wasm",
    },
    timeout,
  );
}

describe("worker supervisor failure recovery", () => {
  it("rejects an ABI mismatch during the handshake", async () => {
    const supervisor = createSupervisor(
      new FakeFactory(["abiMismatch"]),
    );
    await expect(supervisor.initialize()).rejects.toMatchObject({
      code: "ABI_MISMATCH",
    });
    await supervisor.dispose();
  });

  it("replaces a crashed worker and rejects the active request", async () => {
    const factory = new FakeFactory(["crashOnInspect", "idle"]);
    const supervisor = createSupervisor(factory);
    const source = createSource();
    try {
      await expect(
        supervisor.inspectMetadata(source),
      ).rejects.toMatchObject({ code: "WORKER_CRASH" });
      await vi.waitFor(() => {
        expect(factory.created).toBe(2);
      });
    } finally {
      await supervisor.dispose();
      await source.close();
    }
  });

  it("times out, terminates, and recreates an unresponsive worker", async () => {
    const factory = new FakeFactory(["idle", "idle"]);
    const supervisor = createSupervisor(factory, 20);
    const source = createSource();
    try {
      await expect(
        supervisor.inspectMetadata(source),
      ).rejects.toMatchObject({ code: "TIMEOUT" });
      await vi.waitFor(() => {
        expect(factory.created).toBe(2);
      });
    } finally {
      await supervisor.dispose();
      await source.close();
    }
  });

  it("rejects stale responses and post-disposal operations", async () => {
    const factory = new FakeFactory(["staleOnInspect", "idle"]);
    const supervisor = createSupervisor(factory);
    const source = createSource();
    try {
      await expect(
        supervisor.inspectMetadata(source),
      ).rejects.toMatchObject({ code: "STALE_RESPONSE" });
      await vi.waitFor(() => {
        expect(factory.created).toBe(2);
      });
      await supervisor.dispose();
      await expect(
        supervisor.inspectMetadata(source),
      ).rejects.toMatchObject({ code: "DISPOSED" });
    } finally {
      await supervisor.dispose();
      await source.close();
    }
  });
});
