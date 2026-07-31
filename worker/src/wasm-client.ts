import {
  CORE_ABI_VERSION,
  InspectorError,
  SCAN_PROGRESS_BYTES,
  decodeCoreCapabilities,
  encodeScanPlanV2,
  toSafeLength,
} from "@pixels-inspector/protocol-client";
import type {
  CoreCapabilities,
  FilterOperator,
  ScanPlanV2,
  ScanProgressV2,
} from "@pixels-inspector/protocol-client";

import type { EmscriptenInspectorModule } from "./wasm-types.js";

const STATUS_OK = 0;
const STATUS_RANGE_READY = 1;
const STATUS_RESULT_READY = 2;
const STATUS_CANCELLED = 108;

const FILTER_OPERATORS: Readonly<Record<FilterOperator, number>> =
  Object.freeze({
    eq: 0,
    ne: 1,
    lt: 2,
    le: 3,
    gt: 4,
    ge: 5,
    isNull: 6,
    isNotNull: 7,
    contains: 8,
  });

const STATUS_NAMES: Readonly<Record<number, string>> = Object.freeze({
  100: "INVALID_ARGUMENT",
  101: "OUT_OF_BOUNDS",
  102: "MALFORMED_PROTOBUF",
  103: "UNSUPPORTED_VERSION",
  104: "INVALID_MAGIC",
  105: "INVALID_STATE",
  106: "UNSUPPORTED_ENCODING",
  107: "UNSUPPORTED_TYPE",
  108: "CANCELLED",
  109: "BUFFER_TOO_SMALL",
  110: "INVALID_HANDLE",
  111: "INTERNAL_ERROR",
});

export interface WasmRangeStep {
  readonly kind: "range";
  readonly offset: bigint;
  readonly length: bigint;
}

export interface WasmResultStep {
  readonly kind: "result";
  readonly json: string;
}

export type WasmStep = WasmRangeStep | WasmResultStep;

export class WasmInspectorClient {
  private readonly scratchPointer: number;
  public readonly capabilities: CoreCapabilities;
  private handle = 0;

  public constructor(private readonly module: EmscriptenInspectorModule) {
    if (module._pixels_inspector_abi_version() !== CORE_ABI_VERSION) {
      throw new InspectorError(
        "ABI_MISMATCH",
        `Core ABI ${String(module._pixels_inspector_abi_version())} does not match ${String(CORE_ABI_VERSION)}`,
      );
    }
    this.scratchPointer = module._malloc(SCAN_PROGRESS_BYTES);
    if (this.scratchPointer === 0) {
      throw new InspectorError("CORE_ERROR", "unable to allocate ABI scratch memory");
    }
    try {
      this.capabilities = this.readCapabilities();
    } catch (error) {
      module._free(this.scratchPointer);
      throw error;
    }
  }

  public get abiVersion(): number {
    return this.module._pixels_inspector_abi_version();
  }

  public beginMetadata(fileSize: bigint): WasmStep {
    this.destroySession();
    const status = this.module._pixels_inspector_create(
      fileSize,
      this.scratchPointer,
    );
    this.requireStatus(status, STATUS_OK, "create session");
    this.handle = this.dataView(4).getUint32(0, true);
    if (this.handle === 0) {
      throw new InspectorError("CORE_ERROR", "Core returned an invalid handle");
    }
    return this.step(
      this.module._pixels_inspector_begin_metadata(this.handle),
    );
  }

  public beginPage(
    rowGroup: number,
    column: number,
    rowOffset: bigint,
    rowCount: number,
  ): WasmStep {
    this.requireSession();
    return this.step(
      this.module._pixels_inspector_begin_page(
        this.handle,
        rowGroup,
        column,
        rowOffset,
        rowCount,
      ),
    );
  }

  public beginRowGroup(rowGroup: number): WasmStep {
    this.requireSession();
    return this.step(
      this.module._pixels_inspector_begin_row_group(this.handle, rowGroup),
    );
  }

  public beginRows(
    rowGroup: number,
    columns: readonly number[],
    rowOffset: bigint,
    rowCount: number,
  ): WasmStep {
    this.requireSession();
    return this.withColumns(columns, (columnsPointer) =>
      this.step(
        this.module._pixels_inspector_begin_rows(
          this.handle,
          rowGroup,
          columnsPointer,
          columns.length,
          rowOffset,
          rowCount,
        ),
      ),
    );
  }

  public beginFilter(options: {
    readonly predicateColumn: number;
    readonly operator: FilterOperator;
    readonly literal: string;
    readonly columns: readonly number[];
    readonly cursor?: string;
    readonly limit: number;
  }): WasmStep {
    this.requireSession();
    const literal = new TextEncoder().encode(options.literal);
    const cursor = new TextEncoder().encode(options.cursor ?? "");
    return this.withBytes(literal, (literalPointer) =>
      this.withColumns(options.columns, (columnsPointer) =>
        this.withBytes(cursor, (cursorPointer) =>
          this.step(
            this.module._pixels_inspector_begin_filter(
              this.handle,
              options.predicateColumn,
              FILTER_OPERATORS[options.operator],
              literalPointer,
              literal.byteLength,
              columnsPointer,
              options.columns.length,
              cursorPointer,
              cursor.byteLength,
              options.limit,
            ),
          ),
        ),
      ),
    );
  }

  public beginScan(plan: ScanPlanV2): WasmStep {
    this.requireSession();
    const packet = encodeScanPlanV2(plan);
    return this.withBytes(packet, (planPointer) =>
      this.step(
        this.module._pixels_inspector_begin_scan(
          this.handle,
          planPointer,
          packet.byteLength,
        ),
      ),
    );
  }

  public readScanProgress(): ScanProgressV2 {
    this.requireSession();
    this.requireStatus(
      this.module._pixels_inspector_copy_scan_progress(
        this.handle,
        this.scratchPointer,
        SCAN_PROGRESS_BYTES,
      ),
      STATUS_OK,
      "copy scan progress",
    );
    const view = this.dataView(SCAN_PROGRESS_BYTES);
    const version = view.getUint32(0, true);
    const phaseCode = view.getUint32(4, true);
    const phases = [
      "validating",
      "scanning",
      "projecting",
      "complete",
    ] as const;
    const phase = phases[phaseCode];
    if (version !== 1 || phase === undefined) {
      throw new InspectorError(
        "CORE_ERROR",
        "Core returned an unsupported scan progress snapshot",
      );
    }
    const current = view.getUint32(24, true);
    return {
      phase,
      rowGroupsTotal: view.getUint32(8, true),
      rowGroupsConsidered: view.getUint32(12, true),
      scannedRowGroups: view.getUint32(16, true),
      prunedRowGroups: view.getUint32(20, true),
      currentRowGroup: current === 0xffff_ffff ? null : current,
      retainedCandidates: view.getUint32(28, true),
      rowsTotal: view.getBigUint64(32, true).toString(),
      scannedRows: view.getBigUint64(40, true).toString(),
      prunedRows: view.getBigUint64(48, true).toString(),
      matchedRows: view.getBigUint64(56, true).toString(),
    };
  }

  public supplyRange(offset: bigint, bytes: Uint8Array): WasmStep {
    this.requireSession();
    const pointer = this.module._malloc(bytes.byteLength);
    if (bytes.byteLength > 0 && pointer === 0) {
      throw new InspectorError(
        "CORE_ERROR",
        "unable to allocate supplied range in WASM memory",
      );
    }
    try {
      this.module.HEAPU8.set(bytes, pointer);
      return this.step(
        this.module._pixels_inspector_supply_range(
          this.handle,
          offset,
          BigInt(bytes.byteLength),
          pointer,
        ),
      );
    } finally {
      this.module._free(pointer);
    }
  }

  public cancel(): void {
    this.requireSession();
    this.requireStatus(
      this.module._pixels_inspector_cancel(this.handle),
      STATUS_CANCELLED,
      "cancel session",
    );
  }

  public destroySession(): void {
    if (this.handle === 0) {
      return;
    }
    const handle = this.handle;
    this.handle = 0;
    this.requireStatus(
      this.module._pixels_inspector_destroy(handle),
      STATUS_OK,
      "destroy session",
    );
  }

  public dispose(): void {
    this.destroySession();
    this.module._free(this.scratchPointer);
  }

  private withColumns<T>(
    columns: readonly number[],
    operation: (pointer: number) => T,
  ): T {
    const bytes = new Uint8Array(columns.length * Uint32Array.BYTES_PER_ELEMENT);
    const view = new DataView(bytes.buffer);
    columns.forEach((column, index) => {
      view.setUint32(index * Uint32Array.BYTES_PER_ELEMENT, column, true);
    });
    return this.withBytes(bytes, operation);
  }

  private withBytes<T>(
    bytes: Uint8Array,
    operation: (pointer: number) => T,
  ): T {
    if (bytes.byteLength === 0) {
      return operation(0);
    }
    const pointer = this.module._malloc(bytes.byteLength);
    if (pointer === 0) {
      throw new InspectorError(
        "CORE_ERROR",
        "unable to allocate ABI input memory",
      );
    }
    try {
      this.module.HEAPU8.set(bytes, pointer);
      return operation(pointer);
    } finally {
      this.module._free(pointer);
    }
  }

  private step(status: number): WasmStep {
    if (status === STATUS_RANGE_READY) {
      this.requireStatus(
        this.module._pixels_inspector_next_range(
          this.handle,
          this.scratchPointer,
          this.scratchPointer + 8,
        ),
        STATUS_RANGE_READY,
        "read pending range",
      );
      const view = this.dataView(16);
      return {
        kind: "range",
        offset: view.getBigUint64(0, true),
        length: view.getBigUint64(8, true),
      };
    }
    if (status === STATUS_RESULT_READY) {
      return {
        kind: "result",
        json: this.readResult(),
      };
    }
    throw this.coreError(status);
  }

  private readResult(): string {
    this.requireStatus(
      this.module._pixels_inspector_result_size(
        this.handle,
        this.scratchPointer,
      ),
      STATUS_OK,
      "read result size",
    );
    const length = this.dataView(8).getBigUint64(0, true);
    const safeLength = toSafeLength(length, "Core result length");
    const pointer = this.module._malloc(safeLength);
    if (safeLength > 0 && pointer === 0) {
      throw new InspectorError(
        "CORE_ERROR",
        "unable to allocate Core result buffer",
      );
    }
    try {
      this.requireStatus(
        this.module._pixels_inspector_copy_result(
          this.handle,
          pointer,
          length,
        ),
        STATUS_OK,
        "copy result",
      );
      return new TextDecoder("utf-8", { fatal: true }).decode(
        this.module.HEAPU8.slice(pointer, pointer + safeLength),
      );
    } finally {
      this.module._free(pointer);
    }
  }

  private readCapabilities(): CoreCapabilities {
    this.requireStatus(
      this.module._pixels_inspector_capabilities_size(
        this.scratchPointer,
      ),
      STATUS_OK,
      "read capability size",
    );
    const length = this.dataView(8).getBigUint64(0, true);
    const safeLength = toSafeLength(length, "Core capability length");
    const pointer = this.module._malloc(safeLength);
    if (safeLength > 0 && pointer === 0) {
      throw new InspectorError(
        "CORE_ERROR",
        "unable to allocate Core capability buffer",
      );
    }
    try {
      this.requireStatus(
        this.module._pixels_inspector_copy_capabilities(
          pointer,
          length,
        ),
        STATUS_OK,
        "copy capabilities",
      );
      const json = new TextDecoder("utf-8", { fatal: true }).decode(
        this.module.HEAPU8.slice(pointer, pointer + safeLength),
      );
      try {
        return decodeCoreCapabilities(JSON.parse(json));
      } catch (error) {
        throw new InspectorError(
          "CORE_ERROR",
          "Core returned invalid capabilities",
          false,
          { cause: error },
        );
      }
    } finally {
      this.module._free(pointer);
    }
  }

  private readError(): string | undefined {
    if (this.handle === 0) {
      return undefined;
    }
    const sizeStatus = this.module._pixels_inspector_error_size(
      this.handle,
      this.scratchPointer,
    );
    if (sizeStatus !== STATUS_OK) {
      return undefined;
    }
    const length = this.dataView(8).getBigUint64(0, true);
    const safeLength = toSafeLength(length, "Core error length");
    const pointer = this.module._malloc(safeLength);
    if (safeLength > 0 && pointer === 0) {
      return undefined;
    }
    try {
      if (
        this.module._pixels_inspector_copy_error(
          this.handle,
          pointer,
          length,
        ) !== STATUS_OK
      ) {
        return undefined;
      }
      return new TextDecoder().decode(
        this.module.HEAPU8.slice(pointer, pointer + safeLength),
      );
    } finally {
      this.module._free(pointer);
    }
  }

  private coreError(status: number): InspectorError {
    const statusName = STATUS_NAMES[status] ?? `STATUS_${String(status)}`;
    const detail = this.readError();
    const invalidCursor =
      status === 100 &&
      detail?.toLowerCase().includes("scan cursor") === true;
    return new InspectorError(
      status === STATUS_CANCELLED
        ? "CANCELLED"
        : invalidCursor
          ? "INVALID_CURSOR"
          : "CORE_ERROR",
      detail === undefined ? statusName : `${statusName}: ${detail}`,
      status === STATUS_CANCELLED || invalidCursor,
    );
  }

  private requireStatus(
    actual: number,
    expected: number,
    operation: string,
  ): void {
    if (actual !== expected) {
      throw new InspectorError(
        "CORE_ERROR",
        `${operation} returned ${STATUS_NAMES[actual] ?? String(actual)}`,
      );
    }
  }

  private requireSession(): void {
    if (this.handle === 0) {
      throw new InspectorError("CORE_ERROR", "no Core session is active");
    }
  }

  private dataView(length: number): DataView {
    return new DataView(
      this.module.HEAPU8.buffer,
      this.scratchPointer,
      length,
    );
  }
}
