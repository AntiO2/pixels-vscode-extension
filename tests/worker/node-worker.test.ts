import fs from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { decodeCoreManifest } from "@pixels-inspector/protocol-client";
import { beforeAll, describe, expect, it } from "vitest";

import { NodeFileRangeSource } from "../../extension/src/sources/node-file-range-source.js";
import type { RangeSource } from "../../extension/src/sources/range-source.js";
import { NodeWorkerFactory } from "../../extension/src/worker/node-worker-transport.js";
import { WorkerSupervisor } from "../../extension/src/worker/worker-supervisor.js";
import {
  EXPECTED_METADATA,
  EXPECTED_PAGE,
  EXPECTED_ROW_GROUP,
} from "../fixtures/expected.js";
import { decodeCoreCorpus, runCoreCorpus } from "../fixtures/core-corpus.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const manifestPath = path.join(
  root,
  "resources",
  "core",
  "core-manifest.json",
);
const coreOverrideDirectory = process.env["PIXELS_SCAN_WASM_DIR"];
const workerUrl = pathToFileURL(path.join(root, "dist", "worker", "node.mjs"));
const fixturePath = path.join(
  root,
  "third_party",
  "pixels",
  "cpp",
  "tests",
  "data",
  "example.pxl",
);
const tpchLineitemPath = path.join(
  root,
  "third_party",
  "pixels",
  "cpp",
  "tests",
  "data",
  "tpch-lineitem.pxl",
);
const multiPixelLongPath = path.join(
  root,
  "third_party",
  "pixels",
  "cpp",
  "tests",
  "data",
  "multi-pixel-long.pxl",
);
const customerPath = path.join(root, "examples", "customer.pxl");

beforeAll(async () => {
  await fs.access(workerUrl);
});

async function createSupervisor(
  timeout = 5_000,
): Promise<WorkerSupervisor> {
  const coreDirectory =
    coreOverrideDirectory ?? path.dirname(manifestPath);
  const wasmPath = path.join(
    coreDirectory,
    "pixels-inspector-wasm.wasm",
  );
  const manifest =
    coreOverrideDirectory === undefined
      ? decodeCoreManifest(
          JSON.parse(await fs.readFile(manifestPath, "utf8")),
        )
      : decodeCoreManifest({
          schemaVersion: 1,
          abiVersion: 4,
          coreCommit: "0".repeat(40),
          toolchain: {
            emscripten: "6.0.5",
            protobuf: "3.21.6",
          },
          capabilities: ["scan-v2"],
          artifacts: {
            "pixels-inspector-wasm.wasm": {
              bytes: (await fs.stat(wasmPath)).size,
              sha256: createHash("sha256")
                .update(await fs.readFile(wasmPath))
                .digest("hex"),
            },
          },
        });
  return new WorkerSupervisor(
    new NodeWorkerFactory(workerUrl),
    manifest,
    {
      loaderUrl: path.join(coreDirectory, "pixels-inspector-wasm.cjs"),
      wasmUrl: wasmPath,
    },
    timeout,
  );
}

describe("Node parser worker integration", () => {
  it.runIf(process.env["PIXELS_WORKER_CORPUS_DIR"] !== undefined)(
    "matches every native-generated compatibility golden through a real Worker",
    async () => {
      const directory = process.env["PIXELS_WORKER_CORPUS_DIR"];
      if (directory === undefined) {
        throw new Error("native Worker corpus directory is required");
      }
      const cases = decodeCoreCorpus(JSON.parse(
        await fs.readFile(path.join(directory, "manifest.json"), "utf8"),
      ));
      const supervisor = await createSupervisor();
      try {
        const completed = await runCoreCorpus(cases, supervisor, (file) =>
          NodeFileRangeSource.open(path.join(directory, file)),
        );
        expect(completed).toEqual(cases.map((test) => test.name));
      } finally {
        await supervisor.dispose();
      }
    },
    120_000,
  );

  it("round-trips the release customer example", async () => {
    const source = await NodeFileRangeSource.open(customerPath);
    const supervisor = await createSupervisor();
    try {
      const metadata = await supervisor.inspectMetadata(source);
      expect(metadata).toMatchObject({
        rows: 75,
        pixelStride: 5,
        schemaCount: 8,
        rowGroupCount: 3,
      });
      expect(metadata.schema.map((column) => [column.name, column.kind])).toEqual([
        ["c_custkey", 4],
        ["c_name", 16],
        ["c_address", 16],
        ["c_nationkey", 4],
        ["c_phone", 17],
        ["c_acctbal", 14],
        ["c_mktsegment", 17],
        ["c_comment", 16],
      ]);
      for (let rowGroup = 0; rowGroup < 3; rowGroup += 1) {
        const layout = await supervisor.inspectRowGroup(source, rowGroup);
        expect(layout.columns).toHaveLength(8);
        expect(layout.columns.every(
          (column) => column.chunk.pixels.length >= 5,
        )).toBe(true);
      }
      const rows = await supervisor.inspectRows(source, {
        rowGroup: 0,
        columns: [0, 1, 3, 5, 6],
        rowOffset: 0n,
        rowCount: 25,
      });
      expect(rows.count).toBe(25);
      expect(rows.rows[0]?.values).toEqual([
        "1001", "Customer#1001", "3", "-2470.50", "AUTOMOBILE",
      ]);
    } finally {
      await supervisor.dispose();
      await source.close();
    }
  });

  it("round-trips the generated three-Pixel LONG fixture", async () => {
    const source = await NodeFileRangeSource.open(multiPixelLongPath);
    const supervisor = await createSupervisor();
    try {
      const metadata = await supervisor.inspectMetadata(source);
      expect(metadata).toMatchObject({
        rows: 10,
        pixelStride: 4,
        rowGroupCount: 1,
      });
      expect(metadata.schema).toHaveLength(1);
      expect(metadata.schema[0]).toMatchObject({ name: "id", kind: 4 });
      const layout = await supervisor.inspectRowGroup(source, 0);
      expect(layout.columns).toHaveLength(1);
      expect(layout.columns[0]?.chunk.pixels.map((pixel) => ({
        position: pixel.position,
        numberOfValues: pixel.statistics?.numberOfValues,
      }))).toEqual([
        { position: 0, numberOfValues: "4" },
        { position: 32, numberOfValues: "4" },
        { position: 64, numberOfValues: "2" },
      ]);
      await expect(
        supervisor.inspectPage(source, {
          rowGroup: 0,
          column: 0,
          rowOffset: 0n,
          rowCount: 10,
        }),
      ).resolves.toMatchObject({
        count: 10,
        values: ["0", "1", "2", "3", "4", "5", "6", "7", "8", "9"],
      });
    } finally {
      await supervisor.dispose();
      await source.close();
    }
  });

  it("reads the representative 16-column TPC-H lineitem path", async () => {
    const source = await NodeFileRangeSource.open(tpchLineitemPath);
    const supervisor = await createSupervisor();
    try {
      const metadata = await supervisor.inspectMetadata(source);
      expect(metadata.schema).toHaveLength(16);
      expect(metadata.schema.map((type) => type.name)).toEqual([
        "l_orderkey", "l_partkey", "l_suppkey", "l_linenumber",
        "l_quantity", "l_extendedprice", "l_discount", "l_tax",
        "l_returnflag", "l_linestatus", "l_shipdate", "l_commitdate",
        "l_receiptdate", "l_shipinstruct", "l_shipmode", "l_comment",
      ]);
      expect(metadata.rowGroups).toHaveLength(2);
      const layout = await supervisor.inspectRowGroup(source, 1);
      expect(layout.rowGroup).toBe(1);
      expect(layout.columns).toHaveLength(16);
      await expect(
        supervisor.inspectPage(source, {
          rowGroup: 1,
          column: 0,
          rowOffset: 0n,
          rowCount: 2,
        }),
      ).resolves.toMatchObject({ values: ["13", "14"] });
      await expect(
        supervisor.inspectPage(source, {
          rowGroup: 1,
          column: 15,
          rowOffset: 0n,
          rowCount: 2,
        }),
      ).resolves.toMatchObject({
        values: ["third line", "fourth line"],
      });
    } finally {
      await supervisor.dispose();
      await source.close();
    }
  });

  it("drives exact ranges and survives worker recreation", async () => {
    const source = await NodeFileRangeSource.open(fixturePath);
    const supervisor = await createSupervisor();
    try {
      await expect(supervisor.inspectMetadata(source)).resolves.toEqual(
        JSON.parse(EXPECTED_METADATA),
      );
      await expect(
        supervisor.inspectRowGroup(source, 0),
      ).resolves.toEqual(
        JSON.parse(EXPECTED_ROW_GROUP),
      );
      await expect(
        supervisor.inspectPage(source, {
          rowGroup: 0,
          column: 0,
          rowOffset: 0n,
          rowCount: 10,
        }),
      ).resolves.toEqual(JSON.parse(EXPECTED_PAGE));
      expect(supervisor.metrics).toMatchObject({
        generations: 1,
        rangeRequests: 5,
        transferredBytes: 672n,
      });
      await expect(
        supervisor.inspectRows(source, {
          rowGroup: 0,
          columns: [0, 1],
          rowOffset: 2n,
          rowCount: 3,
        }),
      ).resolves.toMatchObject({
        operation: "rows-v1",
        rowGroup: 0,
        offset: "2",
        count: 3,
        columns: [{ id: 0 }, { id: 1 }],
        rows: [
          { localRow: "2", absoluteRow: "2" },
          { localRow: "3", absoluteRow: "3" },
          { localRow: "4", absoluteRow: "4" },
        ],
      });
      await expect(
        supervisor.inspectFilter(source, {
          predicate: {
            column: 0,
            operator: "ge",
            literal: "8",
          },
          columns: [0, 1],
          limit: 100,
        }),
      ).resolves.toMatchObject({
        operation: "filter-v1",
        matched: 2,
        completed: true,
        truncated: false,
        cursor: null,
        rows: [
          { localRow: "8", absoluteRow: "8" },
          { localRow: "9", absoluteRow: "9" },
        ],
      });

      await supervisor.restart();
      await expect(supervisor.inspectMetadata(source)).resolves.toEqual(
        JSON.parse(EXPECTED_METADATA),
      );
      expect(supervisor.metrics.generations).toBe(2);
    } finally {
      await supervisor.dispose();
      await source.close();
    }
  });

  it("terminates and recreates a worker after host cancellation", async () => {
    const base = await NodeFileRangeSource.open(fixturePath);
    let readStarted: (() => void) | undefined;
    const started = new Promise<void>((resolve) => {
      readStarted = resolve;
    });
    const slowSource: RangeSource = {
      identity: base.identity,
      size: base.size,
      async read(_offset, _length, signal): Promise<Uint8Array> {
        readStarted?.();
        return await new Promise<Uint8Array>((_resolve, reject) => {
          signal.addEventListener(
            "abort",
            () => {
              reject(
                signal.reason instanceof Error
                  ? signal.reason
                  : new Error("source read aborted"),
              );
            },
            { once: true },
          );
        });
      },
      async close(): Promise<void> {
        await base.close();
      },
    };
    const supervisor = await createSupervisor();
    try {
      const pending = supervisor.inspectMetadata(slowSource);
      const cancelled = expect(pending).rejects.toMatchObject({
        code: "CANCELLED",
      });
      await started;
      await supervisor.cancelActive();
      await cancelled;
      expect(supervisor.metrics.generations).toBe(2);
      await expect(supervisor.inspectMetadata(base)).resolves.toEqual(
        JSON.parse(EXPECTED_METADATA),
      );
    } finally {
      await supervisor.dispose();
      await slowSource.close();
    }
  });

  it("rejects a manifest digest mismatch before parsing", async () => {
    const original = decodeCoreManifest(
      JSON.parse(await fs.readFile(manifestPath, "utf8")),
    );
    const wasmArtifact =
      original.artifacts["pixels-inspector-wasm.wasm"];
    if (wasmArtifact === undefined) {
      throw new Error("test manifest is missing WASM");
    }
    const manifest = decodeCoreManifest({
      ...original,
      artifacts: {
        ...original.artifacts,
        "pixels-inspector-wasm.wasm": {
          ...wasmArtifact,
          sha256: "0".repeat(64),
        },
      },
    });
    const coreDirectory = path.dirname(manifestPath);
    const supervisor = new WorkerSupervisor(
      new NodeWorkerFactory(workerUrl),
      manifest,
      {
        loaderUrl: path.join(coreDirectory, "pixels-inspector-wasm.cjs"),
        wasmUrl: path.join(coreDirectory, "pixels-inspector-wasm.wasm"),
      },
      2_000,
    );
    await expect(supervisor.initialize()).rejects.toMatchObject({
      code: "CORE_ERROR",
    });
    await supervisor.dispose();
  });
});
