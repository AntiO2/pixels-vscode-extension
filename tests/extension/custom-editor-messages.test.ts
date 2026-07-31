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
  decodeScanSelection,
} from "../../extension/src/custom-editor.js";
import {
  EXPECTED_METADATA,
} from "../fixtures/expected.js";

const metadata = decodeMetadataResultJson(
  EXPECTED_METADATA.replace(/"abi":\d+/u, '"abi":4'),
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

  it("validates bounded composite scan plans against root schema columns", () => {
    expect(
      decodeScanSelection(
        {
          plan: {
            projection: { kind: "columns", columns: [1, 0] },
            predicate: {
              kind: "and",
              children: [
                {
                  kind: "predicate",
                  column: 0,
                  operator: "ge",
                  literal: "3",
                },
                {
                  kind: "predicate",
                  column: 1,
                  operator: "contains",
                  literal: "li",
                },
              ],
            },
            orderBy: [
              { column: 1, direction: "asc", nulls: "last" },
              { column: 0, direction: "desc", nulls: "first" },
            ],
            offset: "0",
            limit: 20,
          },
        },
        metadata,
      ),
    ).toMatchObject({
      plan: {
        projection: { kind: "columns", columns: [1, 0] },
        limit: 20,
      },
    });
    expect(() =>
      decodeScanSelection(
        {
          plan: {
            projection: { kind: "all" },
            predicate: {
              kind: "predicate",
              column: 99,
              operator: "eq",
              literal: "nested",
            },
            orderBy: [],
            offset: "0",
            limit: 20,
          },
        },
        metadata,
      ),
    ).toThrow(/root scalar schema/u);

    const childColumns = new Set(metadata.schema.flatMap((type) => type.subtypes));
    const reversedRoots = metadata.schema
      .filter((type) => !childColumns.has(type.id))
      .map((type) => type.id)
      .reverse();
    expect(
      decodeScanSelection(
        {
          plan: {
            projection: { kind: "columns", columns: reversedRoots },
            orderBy: [],
            offset: "0",
            limit: 20,
          },
        },
        metadata,
      ).plan.projection,
    ).toEqual({ kind: "columns", columns: reversedRoots });
  });
});
