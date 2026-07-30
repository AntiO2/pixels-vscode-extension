import {
  decodeMetadataResultJson,
} from "@pixels-inspector/protocol-client";
import {
  describe,
  expect,
  it,
  vi,
} from "vitest";

vi.mock("vscode", () => ({}));

import {
  decodeFilterSelection,
  decodeRowsSelection,
} from "../../extension/src/custom-editor.js";
import {
  EXPECTED_METADATA,
} from "../fixtures/expected.js";

const metadata = decodeMetadataResultJson(
  EXPECTED_METADATA.replace('"abi":2', '"abi":3'),
);

describe("custom editor row and filter request boundary", () => {
  it("preserves ordered projections and canonical row bounds", () => {
    expect(
      decodeRowsSelection(
        {
          rowGroup: 0,
          columns: [3, 0, 1],
          rowOffset: "2",
          rowCount: 5,
        },
        metadata,
      ),
    ).toEqual({
      rowGroup: 0,
      columns: [3, 0, 1],
      rowOffset: 2n,
      rowCount: 5,
    });
  });

  it("rejects duplicate projections and requests above the safety bound", () => {
    expect(() =>
      decodeRowsSelection(
        {
          rowGroup: 0,
          columns: [0, 0],
          rowOffset: "0",
          rowCount: 1,
        },
        metadata,
      ),
    ).toThrow(/unique/u);
    expect(() =>
      decodeRowsSelection(
        {
          rowGroup: 0,
          columns: [0],
          rowOffset: "0",
          rowCount: 501,
        },
        metadata,
      ),
    ).toThrow(/bounds/u);
  });

  it("gates typed filter operators before the Core call", () => {
    expect(
      decodeFilterSelection(
        {
          predicate: {
            column: 1,
            operator: "contains",
            literal: "li",
          },
          columns: [0, 1],
          limit: 100,
        },
        metadata,
      ),
    ).toEqual({
      predicate: {
        column: 1,
        operator: "contains",
        literal: "li",
      },
      columns: [0, 1],
      limit: 100,
    });
    expect(() =>
      decodeFilterSelection(
        {
          predicate: {
            column: 0,
            operator: "contains",
            literal: "1",
          },
          columns: [0],
          limit: 100,
        },
        metadata,
      ),
    ).toThrow(/incompatible/u);
    expect(() =>
      decodeFilterSelection(
        {
          predicate: {
            column: 0,
            operator: "isNull",
            literal: "unexpected",
          },
          columns: [0],
          limit: 100,
        },
        metadata,
      ),
    ).toThrow(/incompatible/u);
  });
});
