import {
  CORE_ABI_VERSION,
  MAX_RANGE_BYTES,
  PROTOCOL_VERSION,
  InspectorError,
  decodeControllerMessage,
  parseUnsignedDecimal,
  toInspectorError,
} from "@pixels-inspector/protocol-client";
import type {
  ControllerMessage,
  ErrorMessage,
  InitializeMessage,
  WorkerMessage,
} from "@pixels-inspector/protocol-client";

import { WasmInspectorClient } from "./wasm-client.js";
import type {
  EmscriptenInspectorModule,
  InspectorModuleFactory,
} from "./wasm-types.js";

export interface WorkerEnvironment {
  loadFactory(loaderUrl: string): Promise<InspectorModuleFactory>;
  loadBytes(wasmUrl: string): Promise<Uint8Array>;
}

export interface WorkerPort {
  post(message: WorkerMessage): void;
  close(): void;
}

type WorkerState =
  | "uninitialized"
  | "ready"
  | "awaitingRange"
  | "metadataReady"
  | "pageReady"
  | "disposed";

interface ActiveOperation {
  readonly requestId: string;
  readonly operation: "metadata" | "plainLongPage";
}

async function sha256(bytes: Uint8Array): Promise<string> {
  const digestInput = new Uint8Array(bytes.byteLength);
  digestInput.set(bytes);
  const digest = await globalThis.crypto.subtle.digest(
    "SHA-256",
    digestInput.buffer,
  );
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

export class InspectorWorkerCore {
  private state: WorkerState = "uninitialized";
  private client: WasmInspectorClient | undefined;
  private active: ActiveOperation | undefined;

  public constructor(
    private readonly environment: WorkerEnvironment,
    private readonly port: WorkerPort,
  ) {}

  public async receive(raw: unknown): Promise<void> {
    try {
      const message = decodeControllerMessage(raw);
      await this.dispatch(message);
    } catch (error) {
      const inspectorError = toInspectorError(error);
      const requestId = this.active?.requestId;
      this.port.post(this.errorMessage(inspectorError, requestId));
      if (
        inspectorError.code === "INVALID_MESSAGE" ||
        inspectorError.code === "PROTOCOL_MISMATCH" ||
        inspectorError.code === "ABI_MISMATCH" ||
        inspectorError.code === "DIGEST_MISMATCH"
      ) {
        this.dispose();
      }
    }
  }

  private async dispatch(message: ControllerMessage): Promise<void> {
    if (this.state === "disposed") {
      throw new InspectorError("DISPOSED", "worker is disposed");
    }
    switch (message.kind) {
      case "initialize":
        await this.initialize(message);
        return;
      case "inspectMetadata":
        this.inspectMetadata(message.requestId, message.sourceSize);
        return;
      case "inspectPlainLongPage":
        this.inspectPlainLongPage(message);
        return;
      case "supplyRange":
        this.supplyRange(message.requestId, message.offset, message.bytes);
        return;
      case "cancel":
        this.cancel(message.requestId);
        return;
      case "dispose":
        this.dispose();
        return;
    }
  }

  private async initialize(message: InitializeMessage): Promise<void> {
    if (this.state !== "uninitialized") {
      throw new InspectorError(
        "INVALID_MESSAGE",
        "worker can only be initialized once",
      );
    }
    if (message.manifest.abiVersion !== CORE_ABI_VERSION) {
      throw new InspectorError(
        "ABI_MISMATCH",
        `manifest ABI ${String(message.manifest.abiVersion)} is unsupported`,
      );
    }
    const artifact = message.manifest.artifacts["pixels-inspector-wasm.wasm"];
    if (artifact === undefined) {
      throw new InspectorError(
        "INVALID_MESSAGE",
        "manifest does not declare the WASM artifact",
      );
    }
    const [factory, wasmBytes] = await Promise.all([
      this.environment.loadFactory(message.loaderUrl),
      this.environment.loadBytes(message.wasmUrl),
    ]);
    if (
      wasmBytes.byteLength !== artifact.bytes ||
      (await sha256(wasmBytes)) !== artifact.sha256
    ) {
      throw new InspectorError(
        "DIGEST_MISMATCH",
        "loaded WASM does not match the Core manifest",
      );
    }
    const module: EmscriptenInspectorModule = await factory({
      wasmBinary: wasmBytes,
      noInitialRun: true,
      print: () => undefined,
      printErr: () => undefined,
    });
    this.client = new WasmInspectorClient(module);
    this.state = "ready";
    this.port.post({
      kind: "ready",
      version: PROTOCOL_VERSION,
      generation: message.generation,
      abi: this.client.abiVersion,
      coreDigest: artifact.sha256,
    });
  }

  private inspectMetadata(requestId: string, sourceSize: string): void {
    this.requireState("ready");
    this.active = {
      requestId,
      operation: "metadata",
    };
    this.emitStep(
      this.requireClient().beginMetadata(
        parseUnsignedDecimal(sourceSize, "sourceSize"),
      ),
    );
  }

  private inspectPlainLongPage(
    message: Extract<ControllerMessage, { kind: "inspectPlainLongPage" }>,
  ): void {
    this.requireState("metadataReady");
    this.active = {
      requestId: message.requestId,
      operation: "plainLongPage",
    };
    this.emitStep(
      this.requireClient().beginPlainLongPage(
        message.rowGroup,
        message.column,
        parseUnsignedDecimal(message.rowOffset, "rowOffset"),
        message.rowCount,
      ),
    );
  }

  private supplyRange(
    requestId: string,
    offset: string,
    bytes: ArrayBuffer,
  ): void {
    this.requireState("awaitingRange");
    if (this.active?.requestId !== requestId) {
      throw new InspectorError(
        "INVALID_MESSAGE",
        "supplied range belongs to a different request",
      );
    }
    this.emitStep(
      this.requireClient().supplyRange(
        parseUnsignedDecimal(offset, "offset"),
        new Uint8Array(bytes),
      ),
    );
  }

  private cancel(requestId: string): void {
    if (this.active?.requestId !== requestId) {
      throw new InspectorError(
        "INVALID_MESSAGE",
        "cancel belongs to a different request",
      );
    }
    this.requireClient().cancel();
    this.requireClient().destroySession();
    this.active = undefined;
    this.state = "ready";
    this.port.post(
      this.errorMessage(
        new InspectorError("CANCELLED", "inspection was cancelled", true),
        requestId,
      ),
    );
  }

  private emitStep(
    step: ReturnType<WasmInspectorClient["beginMetadata"]>,
  ): void {
    const active = this.active;
    if (active === undefined) {
      throw new InspectorError("INTERNAL", "worker operation is missing");
    }
    if (step.kind === "range") {
      if (step.length <= 0n || step.length > MAX_RANGE_BYTES) {
        throw new InspectorError(
          "INVALID_RANGE",
          `Core requested unsupported range length ${step.length.toString()}`,
        );
      }
      this.state = "awaitingRange";
      this.port.post({
        kind: "rangeNeeded",
        requestId: active.requestId,
        offset: step.offset.toString(),
        length: step.length.toString(),
      });
      return;
    }
    this.state =
      active.operation === "metadata" ? "metadataReady" : "pageReady";
    this.port.post({
      kind: "result",
      requestId: active.requestId,
      operation: active.operation,
      json: step.json,
    });
    this.active = undefined;
  }

  private dispose(): void {
    if (this.state === "disposed") {
      return;
    }
    try {
      this.client?.dispose();
    } finally {
      this.client = undefined;
      this.active = undefined;
      this.state = "disposed";
      this.port.close();
    }
  }

  private requireState(expected: WorkerState): void {
    if (this.state !== expected) {
      throw new InspectorError(
        "INVALID_MESSAGE",
        `worker state ${this.state} does not allow this operation`,
      );
    }
  }

  private requireClient(): WasmInspectorClient {
    if (this.client === undefined) {
      throw new InspectorError("INTERNAL", "WASM client is not initialized");
    }
    return this.client;
  }

  private errorMessage(
    error: InspectorError,
    requestId: string | undefined,
  ): ErrorMessage {
    return {
      kind: "error",
      ...(requestId === undefined ? {} : { requestId }),
      code: error.code,
      message: error.message,
      recoverable: error.recoverable,
    };
  }
}
