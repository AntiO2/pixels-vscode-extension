import type {
  PageValue,
} from "@pixels-inspector/protocol-client";
import { describe, expect, it } from "vitest";

import {
  compressionName,
  copyPageValues,
  formatBytes,
  formatTimestamp,
  formatPageValue,
} from "../../webview/src/value-format.js";

const cases: readonly {
  readonly kind: string;
  readonly value: PageValue;
  readonly rendered: string;
}[] = [
  { kind: "BOOLEAN", value: true, rendered: "true" },
  { kind: "BYTE", value: "-128", rendered: "-128" },
  { kind: "SHORT", value: "-32768", rendered: "-32768" },
  { kind: "INT", value: "-2147483648", rendered: "-2147483648" },
  {
    kind: "LONG",
    value: "-9223372036854775808",
    rendered: "-9223372036854775808",
  },
  { kind: "FLOAT", value: 1.5, rendered: "1.5" },
  { kind: "DOUBLE", value: "NaN", rendered: "NaN" },
  { kind: "STRING", value: "pixels", rendered: "pixels" },
  { kind: "BINARY", value: "AP8=", rendered: "AP8=" },
  {
    kind: "TIMESTAMP",
    value: "9223372036854775807",
    rendered: "9223372036854775807",
  },
  { kind: "ARRAY", value: ["10", "11"], rendered: '["10","11"]' },
  {
    kind: "MAP",
    value: [["1", "a"]],
    rendered: '[["1","a"]]',
  },
  {
    kind: "STRUCT",
    value: { label: "x", tags: ["10"] },
    rendered: '{"label":"x","tags":["10"]}',
  },
  { kind: "VARBINARY", value: "AQ==", rendered: "AQ==" },
  { kind: "DECIMAL", value: "12.3456", rendered: "12.3456" },
  { kind: "DATE", value: "-25202", rendered: "-25202" },
  { kind: "VARCHAR", value: "Alice", rendered: "Alice" },
  { kind: "CHAR", value: "x", rendered: "x" },
  { kind: "TIME", value: "86399999", rendered: "86399999" },
  {
    kind: "VECTOR",
    value: [3, 4, "Infinity"],
    rendered: '[3,4,"Infinity"]',
  },
];

describe("20-kind exact value rendering", () => {
  it("preserves every Core kind without numeric coercion", () => {
    expect(cases).toHaveLength(20);
    for (const entry of cases) {
      expect(formatPageValue(entry.value), entry.kind).toBe(entry.rendered);
    }
  });

  it("uses the same exact representation for clipboard output", () => {
    expect(copyPageValues([null, "-9223372036854775808", ["1", "2"]]))
      .toBe("NULL\n-9223372036854775808\n[\"1\",\"2\"]");
  });

  it("formats exact timestamp precision without changing raw copy truth", () => {
    expect(formatTimestamp("0", 0, "utc"))
      .toBe("1970-01-01T00:00:00Z");
    expect(formatTimestamp("1234567", 6, "utc"))
      .toBe("1970-01-01T00:00:01.234567Z");
    expect(formatTimestamp("-1", 6, "utc"))
      .toBe("1969-12-31T23:59:59.999999Z");
    expect(formatTimestamp("1234567", 3, "raw")).toBe("1234567");
    expect(copyPageValues(["1234567"])).toBe("1234567");
  });

  it("labels every declared compression enum without claiming decoding", () => {
    expect([0, 1, 2, 3, 4, 5].map(compressionName)).toEqual([
      "NONE",
      "ZLIB",
      "SNAPPY",
      "LZO",
      "LZ4",
      "ZSTD",
    ]);
  });

  it("formats byte counts without losing the exact byte string", () => {
    expect(formatBytes("1024")).toBe("1.00 KiB");
    expect(formatBytes("9223372036854775807")).toMatch(/TiB$/u);
  });
});
