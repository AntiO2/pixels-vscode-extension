import {
  InspectorError,
  decodeControllerMessage,
  decodeCoreManifest,
  decodeMetadataResultJson,
  decodeFilterResultJson,
  decodePageResultJson,
  decodeRowsResultJson,
  decodeWorkerMessage,
  parseUnsignedDecimal,
} from "@pixels-inspector/protocol-client";
import { describe, expect, it } from "vitest";

const manifest = {
  schemaVersion: 1,
  abiVersion: 3,
  coreCommit: "8".repeat(40),
  toolchain: {
    emscripten: "6.0.5",
    protobuf: "3.21.6",
  },
  capabilities: ["metadata-v1"],
  artifacts: {
    "pixels-inspector-wasm.wasm": {
      bytes: 10,
      sha256: "a".repeat(64),
    },
  },
};

describe("worker protocol boundary", () => {
  it("decodes a complete initialization envelope", () => {
    expect(
      decodeControllerMessage({
        kind: "initialize",
        version: { major: 1, minor: 4 },
        generation: 7,
        manifest,
        loaderUrl: "file:///loader.cjs",
        wasmUrl: "file:///core.wasm",
      }),
    ).toMatchObject({
      kind: "initialize",
      generation: 7,
    });
  });

  it("rejects protocol major drift and unsafe decimal syntax", () => {
    expect(() =>
      decodeControllerMessage({
        kind: "initialize",
        version: { major: 2, minor: 0 },
        generation: 1,
        manifest,
        loaderUrl: "loader",
        wasmUrl: "wasm",
      }),
    ).toThrow(InspectorError);
    expect(() => parseUnsignedDecimal("01", "offset")).toThrow(
      "unsigned decimal",
    );
    expect(() => parseUnsignedDecimal("-1", "offset")).toThrow(
      "unsigned decimal",
    );
  });

  it("requires transferred ranges to be real ArrayBuffers", () => {
    expect(() =>
      decodeControllerMessage({
        kind: "supplyRange",
        requestId: "r1",
        offset: "0",
        bytes: new Uint8Array([1, 2]),
      }),
    ).toThrow("ArrayBuffer");
  });

  it("decodes row-group requests and validates Core result models", () => {
    expect(
      decodeControllerMessage({
        kind: "inspectRowGroup",
        requestId: "r2",
        rowGroup: 3,
      }),
    ).toEqual({
      kind: "inspectRowGroup",
      requestId: "r2",
      rowGroup: 3,
    });
    expect(() =>
      decodeMetadataResultJson(
        '{"abi":2,"schema":[],"rowGroups":[]}',
      ),
    ).toThrow(InspectorError);
    expect(() =>
      decodePageResultJson(
        '{"rowGroup":0,"column":0,"offset":0,"count":2,"values":[true]}',
      ),
    ).toThrow("count");
  });

  it("rejects malformed manifests and worker result operations", () => {
    expect(() =>
      decodeCoreManifest({
        ...manifest,
        coreCommit: "local-path",
      }),
    ).toThrow("manifest");
    expect(() =>
      decodeWorkerMessage({
        kind: "result",
        requestId: "r1",
        operation: "invented",
        json: "{}",
      }),
    ).toThrow("operation");
  });

  it("validates row projection and filter contracts", () => {
    expect(
      decodeControllerMessage({
        kind: "inspectRows",
        requestId: "rows-1",
        rowGroup: 2,
        columns: [3, 1],
        rowOffset: "10",
        rowCount: 100,
      }),
    ).toMatchObject({ kind: "inspectRows", columns: [3, 1] });
    expect(() =>
      decodeControllerMessage({
        kind: "inspectRows",
        requestId: "rows-2",
        rowGroup: 0,
        columns: [1, 1],
        rowOffset: "0",
        rowCount: 100,
      }),
    ).toThrow("unique");

    expect(
      decodeControllerMessage({
        kind: "inspectFilter",
        requestId: "filter-1",
        predicate: {
          column: 3,
          operator: "ge",
          literal: "12.34",
        },
        columns: [0, 3],
        limit: 0,
      }),
    ).toMatchObject({ kind: "inspectFilter", limit: 0 });
    expect(() =>
      decodeControllerMessage({
        kind: "inspectFilter",
        requestId: "filter-2",
        predicate: {
          column: 3,
          operator: "isNull",
          literal: "unexpected",
        },
        columns: [3],
        limit: 100,
      }),
    ).toThrow("empty literal");
    expect(() =>
      decodeControllerMessage({
        kind: "inspectFilter",
        requestId: "filter-3",
        predicate: {
          column: 3,
          operator: "contains",
          literal: "界".repeat(1_366),
        },
        columns: [3],
        cursor: "x".repeat(65),
        limit: 100,
      }),
    ).toThrow("UTF-8 bytes");
    expect(() =>
      decodeControllerMessage({
        kind: "inspectRows",
        requestId: "rows-3",
        rowGroup: 0x1_0000_0000,
        columns: [1],
        rowOffset: "0",
        rowCount: 100,
      }),
    ).toThrow("unsigned 32-bit");

    expect(
      decodeRowsResultJson(
        '{"operation":"rows-v1","rowGroup":0,"offset":"0","count":1,' +
        '"columns":[{"id":0,"name":"id","kind":4}],"rows":[' +
        '{"rowGroup":0,"localRow":"0","absoluteRow":"0","values":["7"]}]}',
      ),
    ).toMatchObject({ operation: "rows-v1", count: 1 });
    expect(
      decodeFilterResultJson(
        '{"operation":"filter-v1","columns":[{"id":0,"name":"id","kind":4}],' +
        '"rows":[],"progress":{"scannedRowGroups":1,"prunedRowGroups":0,' +
        '"scannedRows":"10","prunedRows":"0"},"matched":0,' +
        '"completed":false,"truncated":true,"cursor":"v1:1:0"}',
      ),
    ).toMatchObject({ operation: "filter-v1", matched: 0 });
    expect(() =>
      decodeRowsResultJson(
        '{"operation":"rows-v1","rowGroup":0,"offset":"3","count":2,' +
        '"columns":[{"id":0,"name":"id","kind":4}],"rows":[' +
        '{"rowGroup":0,"localRow":"3","absoluteRow":"10","values":["7"]},' +
        '{"rowGroup":0,"localRow":"5","absoluteRow":"11","values":["8"]}]}',
      ),
    ).toThrow("identities");
    expect(() =>
      decodeFilterResultJson(
        '{"operation":"filter-v1","columns":[{"id":0,"name":"id","kind":4}],' +
        '"rows":[],"progress":{"scannedRowGroups":1,"prunedRowGroups":0,' +
        '"scannedRows":"10","prunedRows":"0"},"matched":0,' +
        '"completed":false,"truncated":false,"cursor":"v1:1:0"}',
      ),
    ).toThrow("inconsistent");
  });
});
