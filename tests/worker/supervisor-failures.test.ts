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
  | "scanProgress"
  | "scanProgressRegression"
  | "staleErrorOnInspect"
  | "staleOnInspect";

const manifest: CoreManifest = {
  schemaVersion: 1,
  abiVersion: 4,
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

const typeNames = [
  "BOOLEAN",
  "BYTE",
  "SHORT",
  "INT",
  "LONG",
  "FLOAT",
  "DOUBLE",
  "STRING",
  "BINARY",
  "TIMESTAMP",
  "ARRAY",
  "MAP",
  "STRUCT",
  "VARBINARY",
  "DECIMAL",
  "DATE",
  "VARCHAR",
  "CHAR",
  "TIME",
  "VECTOR",
] as const;

const capabilities = decodeCoreCapabilities({
  abi: 4,
  page: "generic-v1",
  rows: "rows-v1",
  filter: "filter-v1",
  scan: "scan-v2",
  rowGroup: "layout-v1",
  maxRows: 500,
  defaultRows: 100,
  defaultScanRows: 20,
  maxScanRows: 500,
  maxProjectionColumns: 128,
  maxExpressionNodes: 64,
  maxOrderKeys: 8,
  maxOrderedWindowRows: 4096,
  types: typeNames.map((name, kind) => ({
    kind,
    name,
  })),
  encodings: ["NONE", "RUNLENGTH", "DICTIONARY"],
  compression: {
    metadata: ["NONE", "ZLIB", "SNAPPY", "LZO", "LZ4", "ZSTD"],
    payload: "inactive",
    reason: "postscript-v1-unused",
  },
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
          abi: this.mode === "abiMismatch" ? 1 : 4,
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
      } else if (this.mode === "staleErrorOnInspect") {
        queueMicrotask(() => {
          this.emitMessage({
            kind: "error",
            requestId: "stale-request",
            code: "CANCELLED",
            message: "stale cancellation",
            recoverable: true,
          });
        });
      }
      return;
    }
    if (message.kind === "inspectScan") {
      const progress = {
        phase: "scanning",
        rowGroupsTotal: 2,
        rowGroupsConsidered: 1,
        scannedRowGroups: 1,
        prunedRowGroups: 0,
        currentRowGroup: 1,
        retainedCandidates: 1,
        rowsTotal: "10",
        scannedRows: "5",
        prunedRows: "0",
        matchedRows: "1",
      } as const;
      queueMicrotask(() => {
        this.emitMessage({
          kind: "progress",
          requestId: message.requestId,
          operation: "scan",
          progress,
        });
        if (this.mode === "scanProgressRegression") {
          this.emitMessage({
            kind: "progress",
            requestId: message.requestId,
            operation: "scan",
            progress: {
              ...progress,
              scannedRows: "4",
            },
          });
          return;
        }
        this.emitMessage({
          kind: "result",
          requestId: message.requestId,
          operation: "scan",
          json: JSON.stringify({
            operation: "scan-v2",
            columns: [{ id: 0, name: "id", kind: 4 }],
            rows: [{
              rowGroup: 0,
              localRow: "0",
              absoluteRow: "0",
              values: ["0"],
            }],
            page: {
              offsetApplied: "0",
              limit: 20,
              returned: 1,
              continuationAvailable: false,
              hasMoreExact: true,
              cursor: null,
            },
            scan: { ordered: false, completion: "complete" },
            progress: {
              rowGroupsTotal: 2,
              rowGroupsConsidered: 2,
              scannedRowGroups: 2,
              prunedRowGroups: 0,
              rowsTotal: "10",
              scannedRows: "10",
              prunedRows: "0",
              matchedRows: "1",
            },
          }),
        });
      });
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
  it("accepts the bounded filter-only rollback capability", () => {
    const legacy = decodeCoreCapabilities({
      abi: 4,
      page: "generic-v1",
      rows: "rows-v1",
      filter: "filter-v1",
      rowGroup: "layout-v1",
      maxRows: 500,
      defaultRows: 100,
      types: typeNames.map((name, kind) => ({ kind, name })),
      encodings: ["NONE", "RUNLENGTH", "DICTIONARY"],
      compression: {
        metadata: ["NONE", "ZLIB", "SNAPPY", "LZO", "LZ4", "ZSTD"],
        payload: "inactive",
        reason: "postscript-v1-unused",
      },
      nested: "portable-v1",
    });
    expect(legacy.filter).toBe("filter-v1");
    expect(legacy.scan).toBeUndefined();
  });

  it("rejects codecs that ABI 4 does not claim to decode", () => {
    expect(() =>
      decodeCoreCapabilities({
        abi: 4,
        page: "generic-v1",
        rows: "rows-v1",
        filter: "filter-v1",
        scan: "scan-v2",
        rowGroup: "layout-v1",
        maxRows: 500,
        defaultRows: 100,
        defaultScanRows: 20,
        maxScanRows: 500,
        maxProjectionColumns: 128,
        maxExpressionNodes: 64,
        maxOrderKeys: 8,
        maxOrderedWindowRows: 4096,
        types: typeNames.map((name, kind) => ({ kind, name })),
        encodings: ["NONE", "RUNLENGTH", "DICTIONARY", "ZSTD"],
        compression: {
          metadata: ["NONE", "ZLIB", "SNAPPY", "LZO", "LZ4", "ZSTD"],
          payload: "inactive",
          reason: "postscript-v1-unused",
        },
        nested: "portable-v1",
      }),
    ).toThrow("capabilities");
  });

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

  it("rejects stale worker errors without cancelling the current request", async () => {
    const factory = new FakeFactory(["staleErrorOnInspect", "idle"]);
    const supervisor = createSupervisor(factory);
    const source = createSource();
    try {
      await expect(
        supervisor.inspectMetadata(source),
      ).rejects.toMatchObject({ code: "STALE_RESPONSE" });
      await vi.waitFor(() => {
        expect(factory.created).toBe(2);
      });
    } finally {
      await supervisor.dispose();
      await source.close();
    }
  });

  it("forwards current scan progress and resolves the validated result", async () => {
    const supervisor = createSupervisor(new FakeFactory(["scanProgress"]));
    const source = createSource();
    const progress = vi.fn();
    try {
      const result = await supervisor.inspectScan(
        source,
        {
          projection: { kind: "all" },
          orderBy: [],
          offset: "0",
          limit: 20,
        },
        progress,
      );
      expect(progress).toHaveBeenCalledOnce();
      expect(progress).toHaveBeenCalledWith(
        expect.objectContaining({ scannedRows: "5" }),
      );
      expect(result).toMatchObject({ operation: "scan-v2" });
    } finally {
      await supervisor.dispose();
      await source.close();
    }
  });

  it("rejects regressing progress and replaces the worker generation", async () => {
    const factory = new FakeFactory(["scanProgressRegression", "idle"]);
    const supervisor = createSupervisor(factory);
    const source = createSource();
    try {
      await expect(
        supervisor.inspectScan(source, {
          projection: { kind: "all" },
          orderBy: [],
          offset: "0",
          limit: 20,
        }),
      ).rejects.toMatchObject({ code: "INVALID_MESSAGE" });
      await vi.waitFor(() => {
        expect(factory.created).toBe(2);
      });
    } finally {
      await supervisor.dispose();
      await source.close();
    }
  });
});
