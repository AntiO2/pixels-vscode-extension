import type {
  RowGroupSummary,
} from "@pixels-inspector/protocol-client";

export interface ProportionalBand {
  readonly index: number;
  readonly start: number;
  readonly size: number;
  readonly basis: "bytes" | "rows" | "equal";
}

function positiveTotal(
  groups: readonly RowGroupSummary[],
  value: (group: RowGroupSummary) => number,
): number {
  return groups.reduce((total, group) => total + Math.max(0, value(group)), 0);
}

export function deriveRowGroupBands(
  groups: readonly RowGroupSummary[],
): readonly ProportionalBand[] {
  const byteTotal = positiveTotal(groups, (group) => group.dataLength);
  const rowTotal = positiveTotal(groups, (group) => group.rows);
  const basis =
    byteTotal > 0 ? "bytes" : rowTotal > 0 ? "rows" : "equal";
  const total =
    basis === "bytes"
      ? byteTotal
      : basis === "rows"
        ? rowTotal
        : Math.max(1, groups.length);
  let start = 0;
  return groups.map((group) => {
    const value =
      basis === "bytes"
        ? group.dataLength
        : basis === "rows"
          ? group.rows
          : 1;
    const size = Math.max(0, value) / total;
    const band = { index: group.index, start, size, basis } as const;
    start += size;
    return band;
  });
}

export function pixelTickPosition(
  position: number,
  rowCount: number,
): number {
  if (rowCount <= 0) {
    return 0;
  }
  return Math.min(1, Math.max(0, position / rowCount));
}
