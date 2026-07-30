import {
  InspectorError,
  decodeControllerMessage,
  decodeCoreManifest,
  decodeMetadataResultJson,
  decodePageResultJson,
  decodeWorkerMessage,
  parseUnsignedDecimal,
} from "@pixels-inspector/protocol-client";
import { describe, expect, it } from "vitest";

const manifest = {
  schemaVersion: 1,
  abiVersion: 2,
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
});
