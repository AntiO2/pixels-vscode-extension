import { describe, expect, it } from "vitest";

import { WasmInspectorClient } from "../../worker/src/wasm-client.js";
import type { EmscriptenInspectorModule } from "../../worker/src/wasm-types.js";

const capabilities = JSON.stringify({
  abi: 4,
  page: "generic-v1",
  rowGroup: "layout-v1",
  rows: "rows-v1",
  filter: "filter-v1",
  scan: "scan-v2",
  maxRows: 500,
  defaultRows: 100,
  defaultScanRows: 20,
  maxScanRows: 500,
  maxProjectionColumns: 128,
  maxExpressionNodes: 64,
  maxOrderKeys: 8,
  maxOrderedWindowRows: 4096,
  types: [
    "BOOLEAN", "BYTE", "SHORT", "INT", "LONG", "FLOAT", "DOUBLE",
    "STRING", "BINARY", "TIMESTAMP", "ARRAY", "MAP", "STRUCT",
    "VARBINARY", "DECIMAL", "DATE", "VARCHAR", "CHAR", "TIME", "VECTOR",
  ].map((name, kind) => ({ kind, name })),
  encodings: ["NONE", "RUNLENGTH", "DICTIONARY"],
  compression: {
    metadata: ["NONE", "ZLIB", "SNAPPY", "LZO", "LZ4", "ZSTD"],
    payload: "inactive",
    reason: "postscript-v1-unused",
  },
  nested: "portable-v1",
});

interface FilterCall {
  readonly operator: number;
  readonly literal: Uint8Array;
  readonly columns: readonly number[];
  readonly cursor: Uint8Array;
}

interface ScanCall {
  readonly packet: Uint8Array;
}

function createModule(
  filterStatus = 1,
  scanStatus = 1,
  errorMessage = "",
): {
  readonly module: EmscriptenInspectorModule;
  readonly freed: number[];
  readonly filterCalls: FilterCall[];
  readonly scanCalls: ScanCall[];
} {
  const heap = new Uint8Array(65_536);
  const freed: number[] = [];
  const filterCalls: FilterCall[] = [];
  const scanCalls: ScanCall[] = [];
  const capabilityBytes = new TextEncoder().encode(capabilities);
  const errorBytes = new TextEncoder().encode(errorMessage);
  let nextPointer = 32;

  const module: EmscriptenInspectorModule = {
    HEAPU8: heap,
    _malloc(size) {
      if (size === 0) {
        return 0;
      }
      const pointer = nextPointer;
      nextPointer += size;
      return pointer;
    },
    _free(pointer) {
      if (pointer !== 0) {
        freed.push(pointer);
      }
    },
    _pixels_inspector_abi_version: () => 4,
    _pixels_inspector_capabilities_size(sizePointer) {
      new DataView(heap.buffer).setBigUint64(
        sizePointer,
        BigInt(capabilityBytes.byteLength),
        true,
      );
      return 0;
    },
    _pixels_inspector_copy_capabilities(destination) {
      heap.set(capabilityBytes, destination);
      return 0;
    },
    _pixels_inspector_create(_fileSize, handlePointer) {
      new DataView(heap.buffer).setUint32(handlePointer, 17, true);
      return 0;
    },
    _pixels_inspector_destroy: () => 0,
    _pixels_inspector_begin_metadata: () => 1,
    _pixels_inspector_begin_row_group: () => 1,
    _pixels_inspector_begin_page: () => 1,
    _pixels_inspector_begin_rows: () => 1,
    _pixels_inspector_begin_filter(
      _handle,
      _predicateColumn,
      operator,
      literalPointer,
      literalSize,
      columnsPointer,
      columnCount,
      cursorPointer,
      cursorSize,
    ) {
      const view = new DataView(heap.buffer);
      filterCalls.push({
        operator,
        literal: heap.slice(literalPointer, literalPointer + literalSize),
        columns: Array.from({ length: columnCount }, (_value, index) =>
          view.getUint32(columnsPointer + index * 4, true),
        ),
        cursor: heap.slice(cursorPointer, cursorPointer + cursorSize),
      });
      return filterStatus;
    },
    _pixels_inspector_begin_scan(_handle, planPointer, planSize) {
      scanCalls.push({
        packet: heap.slice(planPointer, planPointer + planSize),
      });
      return scanStatus;
    },
    _pixels_inspector_copy_scan_progress(
      _handle,
      destination,
      destinationSize,
    ) {
      expect(destinationSize).toBe(64);
      const view = new DataView(heap.buffer, destination, 64);
      view.setUint32(0, 1, true);
      view.setUint32(4, 1, true);
      view.setUint32(8, 3, true);
      view.setUint32(12, 2, true);
      view.setUint32(16, 1, true);
      view.setUint32(20, 1, true);
      view.setUint32(24, 2, true);
      view.setUint32(28, 20, true);
      view.setBigUint64(32, 100n, true);
      view.setBigUint64(40, 40n, true);
      view.setBigUint64(48, 20n, true);
      view.setBigUint64(56, 12n, true);
      return 0;
    },
    _pixels_inspector_next_range(_handle, offsetPointer, lengthPointer) {
      const view = new DataView(heap.buffer);
      view.setBigUint64(offsetPointer, 8n, true);
      view.setBigUint64(lengthPointer, 4n, true);
      return 1;
    },
    _pixels_inspector_supply_range: () => 1,
    _pixels_inspector_result_size: () => 0,
    _pixels_inspector_copy_result: () => 0,
    _pixels_inspector_error_size(_handle, sizePointer) {
      new DataView(heap.buffer).setBigUint64(
        sizePointer,
        BigInt(errorBytes.byteLength),
        true,
      );
      return 0;
    },
    _pixels_inspector_copy_error(_handle, destination) {
      heap.set(errorBytes, destination);
      return 0;
    },
    _pixels_inspector_cancel: () => 108,
  };
  return { module, freed, filterCalls, scanCalls };
}

describe("WASM ABI 4 client", () => {
  it("maps filter operators and frees every temporary ABI allocation", () => {
    const fixture = createModule();
    const client = new WasmInspectorClient(fixture.module);
    client.beginMetadata(128n);
    const freedBeforeFilter = fixture.freed.length;

    expect(
      client.beginFilter({
        predicateColumn: 4,
        operator: "contains",
        literal: "界",
        columns: [4, 2],
        cursor: "v1:0:3",
        limit: 100,
      }),
    ).toEqual({ kind: "range", offset: 8n, length: 4n });
    expect(fixture.filterCalls).toEqual([
      {
        operator: 8,
        literal: new TextEncoder().encode("界"),
        columns: [4, 2],
        cursor: new TextEncoder().encode("v1:0:3"),
      },
    ]);
    expect(fixture.freed).toHaveLength(freedBeforeFilter + 3);
    client.dispose();
  });

  it("copies a canonical scan packet and decodes the 64-byte progress ABI", () => {
    const fixture = createModule();
    const client = new WasmInspectorClient(fixture.module);
    client.beginMetadata(128n);
    const freedBeforeScan = fixture.freed.length;

    expect(
      client.beginScan({
        projection: { kind: "columns", columns: [4, 2] },
        predicate: {
          kind: "predicate",
          column: 4,
          operator: "ge",
          literal: "7",
        },
        orderBy: [
          { column: 4, direction: "desc", nulls: "last" },
        ],
        offset: "3",
        limit: 20,
      }),
    ).toEqual({ kind: "range", offset: 8n, length: 4n });
    expect(fixture.scanCalls[0]?.packet.slice(0, 4)).toEqual(
      new Uint8Array([0x50, 0x58, 0x53, 0x56]),
    );
    expect(fixture.freed).toHaveLength(freedBeforeScan + 1);
    expect(client.readScanProgress()).toEqual({
      phase: "scanning",
      rowGroupsTotal: 3,
      rowGroupsConsidered: 2,
      scannedRowGroups: 1,
      prunedRowGroups: 1,
      currentRowGroup: 2,
      retainedCandidates: 20,
      rowsTotal: "100",
      scannedRows: "40",
      prunedRows: "20",
      matchedRows: "12",
    });
    client.dispose();
  });

  it("frees the scan packet allocation when Core rejects the plan", () => {
    const fixture = createModule(1, 100);
    const client = new WasmInspectorClient(fixture.module);
    client.beginMetadata(128n);
    const freedBeforeScan = fixture.freed.length;
    expect(() =>
      client.beginScan({
        projection: { kind: "all" },
        orderBy: [],
        offset: "0",
        limit: 20,
      }),
    ).toThrow("INVALID_ARGUMENT");
    expect(fixture.freed).toHaveLength(freedBeforeScan + 1);
    client.dispose();
  });

  it("promotes Core scan cursor failures to the stable protocol error", () => {
    const fixture = createModule(
      1,
      100,
      "scan cursor does not match the plan or source",
    );
    const client = new WasmInspectorClient(fixture.module);
    client.beginMetadata(128n);
    expect(() =>
      client.beginScan({
        projection: { kind: "all" },
        orderBy: [],
        offset: "0",
        limit: 20,
      }),
    ).toThrow(
      expect.objectContaining({
        code: "INVALID_CURSOR",
        recoverable: true,
      }),
    );
    client.dispose();
  });

  it("frees nested inputs when Core rejects a filter", () => {
    const fixture = createModule(100);
    const client = new WasmInspectorClient(fixture.module);
    client.beginMetadata(128n);
    const freedBeforeFilter = fixture.freed.length;

    expect(() =>
      client.beginFilter({
        predicateColumn: 4,
        operator: "eq",
        literal: "7",
        columns: [4],
        cursor: "v1:0:0",
        limit: 100,
      }),
    ).toThrow("INVALID_ARGUMENT");
    expect(fixture.freed).toHaveLength(freedBeforeFilter + 3);
    client.dispose();
  });
});
