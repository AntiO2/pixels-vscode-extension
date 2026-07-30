import {
  decodeCoreCapabilities,
  decodeMetadataResultJson,
} from "@pixels-inspector/protocol-client";
import {
  describe,
  expect,
  it,
} from "vitest";

import {
  decodeHostMessage,
} from "../../webview/src/app/bridge.js";
import {
  appReducer,
  initialState,
  selectChunk,
  selectPixel,
} from "../../webview/src/app/model.js";
import {
  EXPECTED_METADATA,
} from "../fixtures/expected.js";

const capabilities = decodeCoreCapabilities({
  abi: 3,
  page: "generic-v1",
  rows: "rows-v1",
  filter: "filter-v1",
  rowGroup: "layout-v1",
  maxRows: 500,
  defaultRows: 100,
  types: [
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
  ].map((name, kind) => ({ kind, name })),
  encodings: ["NONE", "RUNLENGTH", "DICTIONARY"],
  compression: {
    metadata: ["NONE", "ZLIB", "SNAPPY", "LZO", "LZ4", "ZSTD"],
    payload: "inactive",
    reason: "postscript-v1-unused",
  },
  nested: "portable-v1",
});

const metadata = decodeMetadataResultJson(
  EXPECTED_METADATA.replace('"abi":2', '"abi":3'),
);

describe("workspace reducer", () => {
  it("initializes the bounded presentation defaults and projection", () => {
    const state = appReducer(initialState, {
      type: "host",
      message: {
        kind: "metadata",
        revision: 2,
        source: {
          uri: "test://fixture.pxl",
          size: "476",
          revision: "476:1",
        },
        capabilities,
        metadata,
      },
    });
    expect(state.pageSize).toBe(100);
    expect(state.orientation).toBe("rows");
    expect(state.timestampDisplay).toBe("utc");
    expect(state.projection).toEqual([0, 1, 2, 3]);
    expect(state.selected).toEqual({ kind: "file", key: "file" });
  });

  it("suppresses stale host results", () => {
    const current = { ...initialState, revision: 4 };
    const stale = appReducer(current, {
      type: "host",
      message: { kind: "empty", revision: 3 },
    });
    expect(stale).toBe(current);
  });

  it("keeps physical selection keys stable across semantic zoom", () => {
    const chunk = appReducer(initialState, {
      type: "select",
      entity: selectChunk(3, 7),
    });
    const pixel = appReducer(chunk, {
      type: "select",
      entity: selectPixel(3, 7, 2),
    });
    expect(chunk.focusedColumn).toBe(7);
    expect(pixel.selected.key).toBe("pixel:3:7:2");
    expect(pixel.focusedColumn).toBe(7);
  });

  it("does not allow projection controls to remove the final column", () => {
    const state = { ...initialState, projection: [4] };
    expect(
      appReducer(state, {
        type: "toggle-projection",
        column: 4,
      }),
    ).toBe(state);
  });

  it("applies runtime preferences without replacing editor overrides", () => {
    const decoded = decodeHostMessage({
      kind: "preferences",
      preferences: {
        pageSize: 200,
        orientation: "column",
        timestampDisplay: "local",
      },
    });
    expect(decoded).toBeDefined();
    if (decoded === undefined) {
      return;
    }
    const configured = appReducer(initialState, {
      type: "host",
      message: decoded,
    });
    expect(configured.pageSize).toBe(200);
    expect(configured.orientation).toBe("column");
    expect(configured.timestampDisplay).toBe("local");

    const overridden = appReducer(configured, {
      type: "page-size",
      pageSize: 25,
    });
    const updated = appReducer(overridden, {
      type: "host",
      message: {
        kind: "preferences",
        preferences: {
          pageSize: 500,
          orientation: "rows",
          timestampDisplay: "raw",
        },
      },
    });
    expect(updated.pageSize).toBe(25);
    expect(updated.orientation).toBe("rows");
    expect(updated.timestampDisplay).toBe("raw");
  });
});
