import type {
  RowGroupSummary,
} from "@pixels-inspector/protocol-client";
import {
  describe,
  expect,
  it,
} from "vitest";

import {
  deriveRowGroupBands,
  pixelLabelStride,
  pixelTickPosition,
} from "../../webview/src/visualization/geometry.js";

function group(
  index: number,
  rows: number,
  dataLength: number,
): RowGroupSummary {
  return {
    index,
    rows,
    dataLength,
    footerOffset: String(100 + index),
    footerLength: 10,
  };
}

describe("source-backed storage geometry", () => {
  it("sizes row groups by exact data bytes when present", () => {
    const bands = deriveRowGroupBands([
      group(0, 100, 25),
      group(1, 100, 75),
    ]);
    expect(bands).toEqual([
      { index: 0, start: 0, size: 0.25, basis: "bytes" },
      { index: 1, start: 0.25, size: 0.75, basis: "bytes" },
    ]);
  });

  it("falls back to rows and then equal bands without inventing bytes", () => {
    expect(
      deriveRowGroupBands([group(0, 1, 0), group(1, 3, 0)]),
    ).toEqual([
      { index: 0, start: 0, size: 0.25, basis: "rows" },
      { index: 1, start: 0.25, size: 0.75, basis: "rows" },
    ]);
    expect(
      deriveRowGroupBands([group(0, 0, 0), group(1, 0, 0)]).map(
        ({ basis, size }) => ({ basis, size }),
      ),
    ).toEqual([
      { basis: "equal", size: 0.5 },
      { basis: "equal", size: 0.5 },
    ]);
  });

  it("treats pixel starts as chunk-byte ticks and clamps malformed geometry", () => {
    expect(pixelTickPosition(25, 100)).toBe(0.25);
    expect(pixelTickPosition(-1, 100)).toBe(0);
    expect(pixelTickPosition(101, 100)).toBe(1);
    expect(pixelTickPosition(10, 0)).toBe(0);
  });

  it("keeps all ticks while deterministically thinning labels at narrow widths", () => {
    expect(pixelLabelStride(3, 220)).toBe(1);
    expect(pixelLabelStride(12, 220)).toBe(2);
    expect(pixelLabelStride(12, 108)).toBe(4);
  });
});
