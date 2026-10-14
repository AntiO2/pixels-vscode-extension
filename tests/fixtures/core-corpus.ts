import { decodePageResult, type PageResult } from "@pixels-inspector/protocol-client";

import type { RangeSource } from "../../extension/src/sources/range-source.js";
import type { WorkerSupervisor } from "../../extension/src/worker/worker-supervisor.js";

export interface CoreCorpusCase {
  readonly name: string;
  readonly file: string;
  readonly column: number;
  readonly offset: number;
  readonly count: number;
  readonly expected: PageResult;
}

function record(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("invalid native corpus record");
  }
  return value as Record<string, unknown>;
}

function integer(value: unknown): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    throw new Error("invalid native corpus integer");
  }
  return value;
}

function array(value: unknown): readonly unknown[] {
  if (!Array.isArray(value)) {
    throw new Error("invalid native corpus array");
  }
  return value;
}

export function decodeCoreCorpus(value: unknown): readonly CoreCorpusCase[] {
  const manifest = record(value);
  if (manifest["abi"] !== 4 || !Array.isArray(manifest["cases"]) ||
      !Array.isArray(manifest["compatibility"]) || manifest["cases"].length !== 20) {
    throw new Error("incomplete native corpus inventory");
  }
  const names = new Set<string>();
  const cases = [...array(manifest["cases"]), ...array(manifest["compatibility"])].map((value) => {
    const source = record(value);
    const name = source["name"];
    const file = source["file"];
    if (typeof name !== "string" || name.length === 0 || names.has(name) ||
        typeof file !== "string" || !/^[A-Za-z0-9_-]+\.pxl$/u.test(file)) {
      throw new Error("invalid or duplicate native corpus case");
    }
    names.add(name);
    const column = integer(source["column"]);
    const offset = integer(source["offset"]);
    const count = integer(source["count"]);
    const expected = decodePageResult(source["expected"]);
    if (count < 1 || count > 500 || expected.rowGroup !== 0 ||
        expected.column !== column || expected.offset !== offset || expected.count !== count) {
      throw new Error(`native corpus request/golden mismatch: ${name}`);
    }
    return { name, file, column, offset, count, expected };
  });
  // Lock the upstream layout inventory: dropping fixtures must not silently pass.
  for (const endian of ["BE", "LE"]) {
    for (const width of ["INT16", "INT32"]) {
      for (const nullLayout of ["PADDED", "COMPACT"]) {
        requireName(`SHORT-ALIGNED-${endian}-${width}-${nullLayout}`);
      }
    }
    requireName(`SHORT-INT16-${endian}`);
    requireName(`SHORT-ALL-NULL-${endian}`);
    for (const kind of ["BINARY", "VARBINARY"]) {
      requireName(`${kind}-STARTS-${endian}`);
      requireName(`${kind}-STARTS-${endian}-CROSS-PIXEL`);
      requireName(`${kind}-STARTS-${endian}-ALIGNED`);
      requireName(`${kind}-LEGACY-ALIGNED-${endian}`);
    }
  }
  for (const kind of ["BYTE", "SHORT", "INT", "LONG", "TIME"]) {
    requireName(`RLE-ALIGNED-${kind}`);
  }
  return cases;

  function requireName(name: string): void {
    if (!names.has(name)) {
      throw new Error(`native corpus missing required layout: ${name}`);
    }
  }
}

export async function runCoreCorpus(
  cases: readonly CoreCorpusCase[],
  supervisor: WorkerSupervisor,
  openSource: (file: string) => Promise<RangeSource>,
): Promise<readonly string[]> {
  await supervisor.initialize();
  const typeNames = supervisor.capabilities?.types.map((type) => type.name).sort();
  if (JSON.stringify(cases.slice(0, 20).map((test) => test.name).sort()) !==
      JSON.stringify(typeNames)) {
    throw new Error("native corpus kinds differ from initialized Core capabilities");
  }
  const completed: string[] = [];
  for (const test of cases) {
    const source = await openSource(test.file);
    try {
      // Never let one fixture's metadata/session mask another's layout.
      await supervisor.restart();
      await supervisor.inspectMetadata(source);
      const actual = await supervisor.inspectPage(source, {
        rowGroup: 0,
        column: test.column,
        rowOffset: BigInt(test.offset),
        rowCount: test.count,
      });
      if (JSON.stringify(actual) !== JSON.stringify(test.expected)) {
        throw new Error(`native/Worker corpus mismatch: ${test.name}\nexpected: ${JSON.stringify(test.expected)}\nactual: ${JSON.stringify(actual)}`);
      }
      completed.push(test.name);
    } catch (error) {
      throw new Error(`native Worker corpus failed: ${test.name}`, { cause: error });
    } finally {
      await source.close();
    }
  }
  return completed;
}
