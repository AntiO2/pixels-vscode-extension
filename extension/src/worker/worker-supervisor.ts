import {
  CORE_ABI_VERSION,
  MAX_RANGE_BYTES,
  PROTOCOL_VERSION,
  InspectorError,
  decodeFilterResultJson,
  decodeMetadataResultJson,
  decodePageResultJson,
  decodeRowGroupResultJson,
  decodeRowsResultJson,
  decodeScanResultV2Json,
  decodeWorkerMessage,
  parseUnsignedDecimal,
  toInspectorError,
} from "@pixels-inspector/protocol-client";
import type {
  CoreCapabilities,
  CoreManifest,
  FilterOperator,
  FilterResult,
  MetadataResult,
  PageResult,
  RowGroupResult,
  RowsResult,
  ScanPlanV2,
  ScanProgressV2,
  ScanResultV2,
  ControllerMessage,
  ErrorMessage,
  RangeNeededMessage,
  ResultMessage,
  WorkerMessage,
} from "@pixels-inspector/protocol-client";

import type { RangeSource } from "../sources/range-source.js";
import { validateRange } from "../sources/source-errors.js";
import type { WorkerFactory, WorkerTransport } from "./transport.js";

interface CoreLocations {
  readonly loaderUrl: string;
  readonly wasmUrl: string;
}

interface ActiveOperation {
  readonly requestId: string;
  readonly operation: ResultMessage["operation"];
  readonly source: RangeSource;
  readonly abortController: AbortController;
  readonly resolve: (json: string) => void;
  readonly reject: (error: InspectorError) => void;
  readonly timer: ReturnType<typeof setTimeout>;
  readonly onProgress?: (progress: ScanProgressV2) => void;
  lastProgress?: ScanProgressV2;
}

export interface SupervisorMetrics {
  readonly generations: number;
  readonly rangeRequests: number;
  readonly transferredBytes: bigint;
}

export class WorkerSupervisor {
  private worker: WorkerTransport | undefined;
  private detachMessage: (() => void) | undefined;
  private detachError: (() => void) | undefined;
  private generation = 0;
  private active: ActiveOperation | undefined;
  private disposed = false;
  private initialized = false;
  private rangeRequests = 0;
  private transferredBytes = 0n;
  private coreCapabilities: CoreCapabilities | undefined;

  public constructor(
    private readonly factory: WorkerFactory,
    private readonly manifest: CoreManifest,
    private readonly locations: CoreLocations,
    private readonly operationTimeoutMs = 10_000,
    private readonly scanTimeoutMs = 120_000,
  ) {}

  public get metrics(): SupervisorMetrics {
    return Object.freeze({
      generations: this.generation,
      rangeRequests: this.rangeRequests,
      transferredBytes: this.transferredBytes,
    });
  }

  public get capabilities(): CoreCapabilities | undefined {
    return this.coreCapabilities;
  }

  public async initialize(): Promise<void> {
    this.requireNotDisposed();
    if (this.initialized) {
      return;
    }
    await this.spawn();
  }

  public async inspectMetadata(source: RangeSource): Promise<MetadataResult> {
    await this.initialize();
    return decodeMetadataResultJson(
      await this.startOperation(
        source,
        "metadata",
        (requestId) => ({
          kind: "inspectMetadata",
          requestId,
          sourceSize: source.size.toString(),
        }),
      ),
    );
  }

  public async inspectPage(
    source: RangeSource,
    options: {
      readonly rowGroup: number;
      readonly column: number;
      readonly rowOffset: bigint;
      readonly rowCount: number;
    },
  ): Promise<PageResult> {
    await this.initialize();
    return decodePageResultJson(
      await this.startOperation(
        source,
        "page",
        (requestId) => ({
          kind: "inspectPage",
          requestId,
          rowGroup: options.rowGroup,
          column: options.column,
          rowOffset: options.rowOffset.toString(),
          rowCount: options.rowCount,
        }),
      ),
    );
  }

  public async inspectRowGroup(
    source: RangeSource,
    rowGroup: number,
  ): Promise<RowGroupResult> {
    await this.initialize();
    return decodeRowGroupResultJson(
      await this.startOperation(
        source,
        "rowGroup",
        (requestId) => ({
          kind: "inspectRowGroup",
          requestId,
          rowGroup,
        }),
      ),
    );
  }

  public async inspectRows(
    source: RangeSource,
    options: {
      readonly rowGroup: number;
      readonly columns: readonly number[];
      readonly rowOffset: bigint;
      readonly rowCount: number;
    },
  ): Promise<RowsResult> {
    await this.initialize();
    const result = decodeRowsResultJson(
      await this.startOperation(
        source,
        "rows",
        (requestId) => ({
          kind: "inspectRows",
          requestId,
          rowGroup: options.rowGroup,
          columns: options.columns,
          rowOffset: options.rowOffset.toString(),
          rowCount: options.rowCount,
        }),
      ),
    );
    if (
      result.rowGroup !== options.rowGroup ||
      result.offset !== options.rowOffset.toString() ||
      result.count !== options.rowCount ||
      result.columns.length !== options.columns.length ||
      result.columns.some(
        (column, index) => column.id !== options.columns[index],
      )
    ) {
      throw new InspectorError(
        "INVALID_MESSAGE",
        "Core rows result does not match the requested window/projection",
      );
    }
    return result;
  }

  public async inspectFilter(
    source: RangeSource,
    options: {
      readonly predicate: {
        readonly column: number;
        readonly operator: FilterOperator;
        readonly literal: string;
      };
      readonly columns: readonly number[];
      readonly cursor?: string;
      readonly limit: number;
    },
  ): Promise<FilterResult> {
    await this.initialize();
    return decodeFilterResultJson(
      await this.startOperation(
        source,
        "filter",
        (requestId) => ({
          kind: "inspectFilter",
          requestId,
          predicate: options.predicate,
          columns: options.columns,
          ...(options.cursor === undefined ? {} : { cursor: options.cursor }),
          limit: options.limit,
        }),
      ),
    );
  }

  public async inspectScan(
    source: RangeSource,
    plan: ScanPlanV2,
    onProgress?: (progress: ScanProgressV2) => void,
  ): Promise<ScanResultV2> {
    await this.initialize();
    if (this.coreCapabilities?.scan !== "scan-v2") {
      throw new InspectorError(
        "INVALID_MESSAGE",
        "Core does not advertise scan-v2",
        true,
      );
    }
    const result = decodeScanResultV2Json(
      await this.startOperation(
        source,
        "scan",
        (requestId) => ({
          kind: "inspectScan",
          requestId,
          plan,
        }),
        {
          timeoutMs: this.scanTimeoutMs,
          ...(onProgress === undefined ? {} : { onProgress }),
        },
      ),
    );
    const requestedColumns =
      plan.projection.kind === "columns"
        ? plan.projection.columns
        : undefined;
    if (
      result.page.offsetApplied !== plan.offset ||
      result.page.limit !== plan.limit ||
      result.scan.ordered !== (plan.orderBy.length > 0) ||
      (requestedColumns !== undefined &&
        (result.columns.length !== requestedColumns.length ||
          result.columns.some(
            (column, index) =>
              column.id !== requestedColumns[index],
          )))
    ) {
      throw new InspectorError(
        "INVALID_MESSAGE",
        "Core scan result does not match the submitted plan",
      );
    }
    return result;
  }

  public async cancelActive(): Promise<void> {
    const active = this.active;
    if (active === undefined) {
      return;
    }
    active.abortController.abort(
      new InspectorError("CANCELLED", "inspection cancelled by host", true),
    );
    this.worker?.post({
      kind: "cancel",
      requestId: active.requestId,
    });
    this.rejectActive(
      new InspectorError("CANCELLED", "inspection cancelled by host", true),
    );
    await this.replaceWorker();
  }

  public async restart(): Promise<void> {
    this.requireNotDisposed();
    this.rejectActive(
      new InspectorError("WORKER_CRASH", "worker was restarted", true),
    );
    await this.replaceWorker();
  }

  public async dispose(): Promise<void> {
    if (this.disposed) {
      return;
    }
    this.disposed = true;
    this.rejectActive(new InspectorError("DISPOSED", "supervisor is disposed"));
    const worker = this.detachWorker();
    if (worker !== undefined) {
      worker.post({ kind: "dispose" });
      await worker.terminate();
    }
    this.initialized = false;
  }

  private async spawn(): Promise<void> {
    const generation = ++this.generation;
    const worker = await this.factory.create();
    this.worker = worker;

    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        detachMessage();
        detachError();
        reject(new InspectorError("TIMEOUT", "worker initialization timed out"));
      }, this.operationTimeoutMs);
      const detachMessage = worker.onMessage((raw) => {
        try {
          const message = decodeWorkerMessage(raw);
          if (message.kind !== "ready") {
            if (message.kind === "error") {
              throw this.workerError(message);
            }
            return;
          }
          if (
            message.generation !== generation ||
            message.abi !== CORE_ABI_VERSION ||
            message.coreDigest !==
              this.manifest.artifacts["pixels-inspector-wasm.wasm"]?.sha256
          ) {
            throw new InspectorError(
              "ABI_MISMATCH",
              "worker handshake does not match manifest/generation",
            );
          }
          clearTimeout(timeout);
          detachMessage();
          detachError();
          this.initialized = true;
          this.coreCapabilities = message.capabilities;
          resolve();
        } catch (error) {
          clearTimeout(timeout);
          detachMessage();
          detachError();
          reject(toInspectorError(error));
        }
      });
      const detachError = worker.onError((error) => {
        clearTimeout(timeout);
        detachMessage();
        detachError();
        reject(
          new InspectorError(
            "WORKER_CRASH",
            "worker crashed during initialization",
            true,
            { cause: error },
          ),
        );
      });
      worker.post({
        kind: "initialize",
        version: PROTOCOL_VERSION,
        generation,
        manifest: this.manifest,
        loaderUrl: this.locations.loaderUrl,
        wasmUrl: this.locations.wasmUrl,
      });
    }).catch(async (error: unknown) => {
      const failed = this.detachWorker();
      await failed?.terminate();
      throw error;
    });
    this.detachMessage = worker.onMessage((message) => {
      if (generation === this.generation) {
        void this.handleMessage(message, generation);
      }
    });
    this.detachError = worker.onError((error) => {
      if (generation === this.generation) {
        void this.handleCrash(error);
      }
    });
  }

  private async startOperation(
    source: RangeSource,
    operation: ResultMessage["operation"],
    createMessage: (requestId: string) => ControllerMessage,
    options: {
      readonly timeoutMs?: number;
      readonly onProgress?: (progress: ScanProgressV2) => void;
    } = {},
  ): Promise<string> {
    this.requireNotDisposed();
    if (this.active !== undefined) {
      throw new InspectorError(
        "INVALID_MESSAGE",
        "only one worker operation may be active",
      );
    }
    const requestId = `${String(this.generation)}:${crypto.randomUUID()}`;
    const timeoutMs = options.timeoutMs ?? this.operationTimeoutMs;
    return await new Promise<string>((resolve, reject) => {
      const timer = setTimeout(() => {
        void this.failAndReplace(
          new InspectorError(
            "TIMEOUT",
            `${operation} exceeded ${String(timeoutMs)} ms`,
            true,
          ),
        );
      }, timeoutMs);
      this.active = {
        requestId,
        operation,
        source,
        abortController: new AbortController(),
        resolve,
        reject,
        timer,
        ...(options.onProgress === undefined
          ? {}
          : { onProgress: options.onProgress }),
      };
      this.worker?.post(createMessage(requestId));
    });
  }

  private async handleMessage(
    raw: unknown,
    generation: number,
  ): Promise<void> {
    let message: WorkerMessage;
    try {
      message = decodeWorkerMessage(raw);
    } catch (error) {
      await this.failAndReplace(toInspectorError(error));
      return;
    }
    if (message.kind === "ready") {
      return;
    }
    if (generation !== this.generation) {
      return;
    }
    if (message.kind === "error") {
      if (
        this.active === undefined ||
        message.requestId !== this.active.requestId
      ) {
        await this.failAndReplace(
          new InspectorError(
            "STALE_RESPONSE",
            "worker error does not match the active request",
          ),
        );
        return;
      }
      const error = this.workerError(message);
      this.rejectActive(error);
      if (!message.recoverable) {
        await this.replaceWorker();
      }
      return;
    }
    const active = this.active;
    if (message.requestId !== active?.requestId) {
      await this.failAndReplace(
        new InspectorError(
          "STALE_RESPONSE",
          "worker response does not match the active request",
        ),
      );
      return;
    }
    if (message.kind === "rangeNeeded") {
      await this.fulfillRange(active, message);
      return;
    }
    if (message.kind === "progress") {
      if (active.operation !== "scan") {
        await this.failAndReplace(
          new InspectorError(
            "INVALID_MESSAGE",
            "scan progress belongs to a non-scan operation",
          ),
        );
        return;
      }
      try {
        this.requireMonotonicProgress(active.lastProgress, message.progress);
        active.lastProgress = message.progress;
        active.onProgress?.(message.progress);
      } catch (error) {
        await this.failAndReplace(toInspectorError(error));
      }
      return;
    }
    if (message.operation !== active.operation) {
      await this.failAndReplace(
        new InspectorError(
          "INVALID_MESSAGE",
          "worker result operation does not match the request",
        ),
      );
      return;
    }
    clearTimeout(active.timer);
    this.active = undefined;
    active.resolve(message.json);
  }

  private requireMonotonicProgress(
    previous: ScanProgressV2 | undefined,
    current: ScanProgressV2,
  ): void {
    if (previous === undefined) {
      return;
    }
    const phases = ["validating", "scanning", "projecting", "complete"];
    if (
      phases.indexOf(current.phase) < phases.indexOf(previous.phase) ||
      current.rowGroupsTotal !== previous.rowGroupsTotal ||
      BigInt(current.rowsTotal) !== BigInt(previous.rowsTotal) ||
      current.rowGroupsConsidered < previous.rowGroupsConsidered ||
      current.scannedRowGroups < previous.scannedRowGroups ||
      current.prunedRowGroups < previous.prunedRowGroups ||
      BigInt(current.scannedRows) < BigInt(previous.scannedRows) ||
      BigInt(current.prunedRows) < BigInt(previous.prunedRows) ||
      BigInt(current.matchedRows) < BigInt(previous.matchedRows)
    ) {
      throw new InspectorError(
        "INVALID_MESSAGE",
        "scan progress regressed",
      );
    }
  }

  private async fulfillRange(
    active: ActiveOperation,
    message: RangeNeededMessage,
  ): Promise<void> {
    try {
      const offset = parseUnsignedDecimal(message.offset, "offset");
      const length = parseUnsignedDecimal(message.length, "length");
      if (length <= 0n || length > MAX_RANGE_BYTES) {
        throw new InspectorError(
          "INVALID_RANGE",
          `worker range length ${length.toString()} is outside host bounds`,
        );
      }
      validateRange(active.source.size, offset, length);
      const bytes = await active.source.read(
        offset,
        length,
        active.abortController.signal,
      );
      if (this.active !== active) {
        return;
      }
      if (BigInt(bytes.byteLength) !== length) {
        throw new InspectorError(
          "SHORT_READ",
          "source returned a partial range",
          true,
        );
      }
      this.rangeRequests += 1;
      this.transferredBytes += length;
      const transferableBytes = new Uint8Array(bytes.byteLength);
      transferableBytes.set(bytes);
      const transferable = transferableBytes.buffer;
      this.worker?.post(
        {
          kind: "supplyRange",
          requestId: active.requestId,
          offset: offset.toString(),
          bytes: transferable,
        },
        [transferable],
      );
    } catch (error) {
      if (this.active !== active) {
        return;
      }
      await this.failAndReplace(toInspectorError(error));
    }
  }

  private async handleCrash(error: Error): Promise<void> {
    await this.failAndReplace(
      new InspectorError("WORKER_CRASH", "parser worker crashed", true, {
        cause: error,
      }),
    );
  }

  private async failAndReplace(error: InspectorError): Promise<void> {
    this.rejectActive(error);
    await this.replaceWorker();
  }

  private rejectActive(error: InspectorError): void {
    const active = this.active;
    if (active === undefined) {
      return;
    }
    this.active = undefined;
    clearTimeout(active.timer);
    active.abortController.abort(error);
    active.reject(error);
  }

  private async replaceWorker(): Promise<void> {
    if (this.disposed) {
      return;
    }
    const previous = this.detachWorker();
    await previous?.terminate();
    this.initialized = false;
    await this.spawn();
  }

  private detachWorker(): WorkerTransport | undefined {
    this.detachMessage?.();
    this.detachError?.();
    this.detachMessage = undefined;
    this.detachError = undefined;
    const worker = this.worker;
    this.worker = undefined;
    return worker;
  }

  private workerError(message: ErrorMessage): InspectorError {
    return new InspectorError(
      message.code === "CANCELLED"
        ? "CANCELLED"
        : message.code === "INVALID_CURSOR"
          ? "INVALID_CURSOR"
          : "CORE_ERROR",
      message.message,
      message.recoverable,
    );
  }

  private requireNotDisposed(): void {
    if (this.disposed) {
      throw new InspectorError("DISPOSED", "supervisor is disposed");
    }
  }
}
