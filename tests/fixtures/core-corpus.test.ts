import { describe, expect, it } from "vitest";

import { decodeCoreCorpus } from "./core-corpus.js";

function manifest() {
  const names: string[] = [];
  for (const endian of ["BE", "LE"]) {
    for (const width of ["INT16", "INT32"]) {
      for (const layout of ["PADDED", "COMPACT"]) {
        names.push(`SHORT-ALIGNED-${endian}-${width}-${layout}`);
      }
    }
    names.push(`SHORT-INT16-${endian}`, `SHORT-ALL-NULL-${endian}`);
    for (const kind of ["BINARY", "VARBINARY"]) {
      names.push(`${kind}-STARTS-${endian}`, `${kind}-STARTS-${endian}-CROSS-PIXEL`);
      names.push(`${kind}-STARTS-${endian}-ALIGNED`, `${kind}-LEGACY-ALIGNED-${endian}`);
    }
  }
  for (const kind of ["BYTE", "SHORT", "INT", "LONG", "TIME"]) {
    names.push(`RLE-ALIGNED-${kind}`);
  }
  // Manifest-only doubles: PXL fixture bytes are exclusively native-generated.
  const makeCase = (name: string) => ({
    name, file: `${name}.pxl`, column: 0, offset: 0, count: 1,
    expected: { rowGroup: 0, column: 0, offset: 0, count: 1, values: [null] },
  });
  return {
    abi: 4,
    cases: Array.from({ length: 20 }, (_, index) => makeCase(`TYPE-${String(index)}`)),
    compatibility: names.map(makeCase),
  };
}

describe("native Worker corpus boundary", () => {
  it("decodes all cases and preserves exact native values", () => {
    const input = manifest();
    expect(decodeCoreCorpus(input)).toEqual([...input.cases, ...input.compatibility]);
  });

  it("rejects ABI, inventory, duplicate names and unsafe paths", () => {
    const input = manifest();
    expect(() => decodeCoreCorpus({ ...input, abi: 3 })).toThrow();
    expect(() => decodeCoreCorpus({ ...input, cases: [] })).toThrow();
    expect(() => decodeCoreCorpus({ ...input, compatibility: [input.cases[0]] })).toThrow();
    expect(() => decodeCoreCorpus({ ...input, cases: input.cases.map((test) =>
      ({ ...test, file: "../escape.pxl" })),
    })).toThrow();
  });

  it("requires both upstream byte orders and every null/width layout", () => {
    const input = manifest();
    for (const removed of input.compatibility) {
      expect(() => decodeCoreCorpus({ ...input, compatibility:
        input.compatibility.filter((test) => test !== removed),
      })).toThrow(/missing required layout/u);
    }
  });

  it("rejects unsafe offsets, oversized pages and inconsistent goldens", () => {
    const input = manifest();
    for (const update of [{ offset: Number.MAX_SAFE_INTEGER + 1 }, { count: 501 },
      { column: 1 }, { expected: { rowGroup: 0, column: 0, offset: 0, count: 2, values: [null] } }]) {
      expect(() => decodeCoreCorpus({ ...input, cases: input.cases.map((test) =>
        ({ ...test, ...update })),
      })).toThrow();
    }
  });
});
