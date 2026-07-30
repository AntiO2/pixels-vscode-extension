import { describe, expect, it } from "vitest";

import { WasmInspectorClient } from "../../worker/src/wasm-client.js";
import type { EmscriptenInspectorModule } from "../../worker/src/wasm-types.js";

const capabilities = JSON.stringify({
  abi: 3,
  page: "generic-v1",
  rowGroup: "layout-v1",
  rows: "rows-v1",
  filter: "filter-v1",
  maxRows: 500,
  defaultRows: 100,
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

function createModule(filterStatus = 1): {
  readonly module: EmscriptenInspectorModule;
  readonly freed: number[];
  readonly filterCalls: FilterCall[];
} {
  const heap = new Uint8Array(65_536);
  const freed: number[] = [];
  const filterCalls: FilterCall[] = [];
  const capabilityBytes = new TextEncoder().encode(capabilities);
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
    _pixels_inspector_abi_version: () => 3,
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
      new DataView(heap.buffer).setBigUint64(sizePointer, 0n, true);
      return 0;
    },
    _pixels_inspector_copy_error: () => 0,
    _pixels_inspector_cancel: () => 108,
  };
  return { module, freed, filterCalls };
}

describe("WASM ABI 3 client", () => {
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
