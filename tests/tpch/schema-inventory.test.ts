import fs from "node:fs/promises";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  LINEITEM_KINDS,
  TPCH_COLUMNS,
} from "../fixtures/tpch-schema.js";

const canonicalPath = path.resolve(
  "third_party",
  "pixels",
  "cpp",
  "pixels-amphi",
  "benchmark",
  "schema",
  "tpch.json",
);

describe("TPC-H V1 schema inventory", () => {
  it("tracks all 8 canonical tables and 61 columns from the submodule", async () => {
    const canonical = JSON.parse(
      await fs.readFile(canonicalPath, "utf8"),
    ) as unknown;
    expect(canonical).toEqual(TPCH_COLUMNS);
    expect(Object.keys(TPCH_COLUMNS)).toHaveLength(8);
    expect(
      Object.values(TPCH_COLUMNS).reduce(
        (total, columns) => total + columns.length,
        0,
      ),
    ).toBe(61);
  });

  it("covers the representative 16-column lineitem shape", () => {
    expect(TPCH_COLUMNS.lineitem).toHaveLength(16);
    expect(LINEITEM_KINDS).toHaveLength(16);
    expect(new Set(LINEITEM_KINDS)).toEqual(
      new Set(["LONG", "INT", "DECIMAL", "CHAR", "DATE", "VARCHAR"]),
    );
    expect(TPCH_COLUMNS.lineitem[0]).toBe("l_orderkey");
    expect(TPCH_COLUMNS.lineitem.at(-1)).toBe("l_comment");
  });
});
