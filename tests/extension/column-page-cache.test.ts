import { describe, expect, it } from "vitest";

import { ColumnPageCache } from "../../extension/src/data/column-page-cache.js";
import type { RowsResult } from "@pixels-inspector/protocol-client";

const baseKey = {
  sourceRevision: "source-a",
  rowGroup: 0,
  offset: "0",
  count: 2,
} as const;

function fragment(
  columns: readonly number[],
  absoluteRows: readonly string[] = ["10", "11"],
  valuePrefix = "",
): RowsResult {
  return {
    operation: "rows-v1",
    rowGroup: 0,
    offset: "0",
    count: 2,
    columns: columns.map((id) => ({
      id,
      name: `c${String(id)}`,
      kind: 4,
    })),
    rows: absoluteRows.map((absoluteRow, row) => ({
      rowGroup: 0,
      localRow: String(row),
      absoluteRow,
      values: columns.map((column) => `${valuePrefix}${String(column)}:${String(row)}`),
    })),
  };
}

describe("ColumnPageCache", () => {
  it("requests only missing columns and assembles the requested order", () => {
    const cache = new ColumnPageCache();
    expect(cache.missingColumns(baseKey, [2, 0])).toEqual([2, 0]);
    expect(
      cache.mergeAndAssemble(baseKey, fragment([2]), [2]),
    ).toMatchObject({ columns: [{ id: 2 }] });
    expect(cache.missingColumns(baseKey, [2, 0])).toEqual([0]);

    const assembled = cache.mergeAndAssemble(
      baseKey,
      fragment([0]),
      [0, 2],
    );
    expect(assembled.columns.map((column) => column.id)).toEqual([0, 2]);
    expect(assembled.rows.map((row) => row.values)).toEqual([
      ["0:0", "2:0"],
      ["0:1", "2:1"],
    ]);
    expect(cache.missingColumns(baseKey, [2, 0])).toEqual([]);
  });

  it("rejects fragments whose exact row identities drift", () => {
    const cache = new ColumnPageCache();
    cache.mergeAndAssemble(baseKey, fragment([0]), [0]);
    expect(() =>
      cache.mergeAndAssemble(
        baseKey,
        fragment([1], ["10", "12"]),
        [0, 1],
      ),
    ).toThrow("identities");
  });

  it("evicts least-recently-used windows by count", () => {
    const cache = new ColumnPageCache(2, 1024 * 1024);
    const second = { ...baseKey, offset: "2" };
    const third = { ...baseKey, offset: "4" };
    cache.mergeAndAssemble(baseKey, fragment([0]), [0]);
    cache.mergeAndAssemble(second, {
      ...fragment([0], ["12", "13"]),
      offset: "2",
    }, [0]);
    expect(cache.assemble(baseKey, [0])).toBeDefined();
    cache.mergeAndAssemble(third, {
      ...fragment([0], ["14", "15"]),
      offset: "4",
    }, [0]);

    expect(cache.windowCount).toBe(2);
    expect(cache.assemble(baseKey, [0])).toBeDefined();
    expect(cache.assemble(second, [0])).toBeUndefined();
    expect(cache.assemble(third, [0])).toBeDefined();
  });

  it("does not retain a window beyond the deterministic byte budget", () => {
    const cache = new ColumnPageCache(3, 64);
    const result = cache.mergeAndAssemble(
      baseKey,
      fragment([0], ["10", "11"], "large-value-"),
      [0],
    );
    expect(result.rows).toHaveLength(2);
    expect(cache.estimatedBytes).toBeLessThanOrEqual(64);
    expect(cache.assemble(baseKey, [0])).toBeUndefined();
  });

  it("evicts unselected current-window vectors before dropping its selection", () => {
    const sizing = new ColumnPageCache(3, 1024 * 1024);
    sizing.mergeAndAssemble(baseKey, fragment([0]), [0]);
    const oneColumnBytes = sizing.estimatedBytes;
    sizing.mergeAndAssemble(baseKey, fragment([1]), [0, 1]);
    const twoColumnBytes = sizing.estimatedBytes;
    const cache = new ColumnPageCache(
      3,
      Math.floor((oneColumnBytes + twoColumnBytes) / 2),
    );

    cache.mergeAndAssemble(baseKey, fragment([0]), [0]);
    const selected = cache.mergeAndAssemble(
      baseKey,
      fragment([1]),
      [1],
    );
    expect(selected.columns.map((column) => column.id)).toEqual([1]);
    expect(cache.assemble(baseKey, [1])).toBeDefined();
    expect(cache.missingColumns(baseKey, [0, 1])).toEqual([0]);
    expect(cache.estimatedBytes).toBeLessThanOrEqual(
      Math.floor((oneColumnBytes + twoColumnBytes) / 2),
    );
  });

  it("serializes tuple keys without delimiter collisions", () => {
    const cache = new ColumnPageCache();
    const firstKey = { ...baseKey, sourceRevision: "a", rowGroup: 1 };
    const secondKey = { ...baseKey, sourceRevision: "a\u00001", rowGroup: 0 };
    const firstFragment = {
      ...fragment([0]),
      rowGroup: 1,
      rows: fragment([0]).rows.map((row) => ({ ...row, rowGroup: 1 })),
    };

    cache.mergeAndAssemble(firstKey, firstFragment, [0]);
    cache.mergeAndAssemble(secondKey, fragment([1]), [1]);

    expect(cache.windowCount).toBe(2);
    expect(cache.assemble(firstKey, [0])).toBeDefined();
    expect(cache.assemble(secondKey, [1])).toBeDefined();
  });

  it("clears all source-revision windows explicitly", () => {
    const cache = new ColumnPageCache();
    cache.mergeAndAssemble(baseKey, fragment([0]), [0]);
    cache.clear();
    expect(cache.windowCount).toBe(0);
    expect(cache.estimatedBytes).toBe(0);
  });
});
