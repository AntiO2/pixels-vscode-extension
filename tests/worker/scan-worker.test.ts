import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import type {
  CoreManifest,
  ScanProgressV2,
} from "@pixels-inspector/protocol-client";
import { describe, expect, it } from "vitest";

import { NodeFileRangeSource } from "../../extension/src/sources/node-file-range-source.js";
import { NodeWorkerFactory } from "../../extension/src/worker/node-worker-transport.js";
import { WorkerSupervisor } from "../../extension/src/worker/worker-supervisor.js";

const wasmDirectory = process.env["PIXELS_SCAN_WASM_DIR"];
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

async function createSupervisor(): Promise<WorkerSupervisor> {
  if (wasmDirectory === undefined) {
    throw new Error("PIXELS_SCAN_WASM_DIR is required");
  }
  const wasmPath = path.join(
    wasmDirectory,
    "pixels-inspector-wasm.wasm",
  );
  const wasm = await fs.readFile(wasmPath);
  const manifest: CoreManifest = {
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
        bytes: wasm.byteLength,
        sha256: createHash("sha256").update(wasm).digest("hex"),
      },
    },
  };
  return new WorkerSupervisor(
    new NodeWorkerFactory(
      pathToFileURL(path.join(root, "dist", "worker", "node.mjs")),
    ),
    manifest,
    {
      loaderUrl: path.join(
        wasmDirectory,
        "pixels-inspector-wasm.cjs",
      ),
      wasmUrl: wasmPath,
    },
    5_000,
    120_000,
  );
}

describe.skipIf(wasmDirectory === undefined)(
  "scan-v2 real Node Worker integration",
  () => {
    it("runs natural continuation, composite ordering, and exact progress", async () => {
      const source = await NodeFileRangeSource.open(
        path.join(
          root,
          "third_party",
          "pixels",
          "cpp",
          "tests",
          "data",
          "example.pxl",
        ),
      );
      const supervisor = await createSupervisor();
      try {
        const metadata = await supervisor.inspectMetadata(source);
        expect(metadata.abi).toBe(4);
        expect(supervisor.capabilities?.scan).toBe("scan-v2");

        const naturalProgress: ScanProgressV2[] = [];
        const first = await supervisor.inspectScan(
          source,
          {
            projection: { kind: "all" },
            orderBy: [],
            offset: "0",
            limit: 3,
          },
          (progress) => naturalProgress.push(progress),
        );
        expect(first.rows.map((row) => row.absoluteRow)).toEqual([
          "0",
          "1",
          "2",
        ]);
        expect(first.page.cursor).toMatch(/^UFhDMg[A-Za-z0-9_-]{48}$/u);

        const second = await supervisor.inspectScan(source, {
          projection: { kind: "all" },
          orderBy: [],
          offset: "0",
          limit: 3,
          ...(first.page.cursor === null
            ? {}
            : { cursor: first.page.cursor }),
        });
        expect(second.rows.map((row) => row.absoluteRow)).toEqual([
          "3",
          "4",
          "5",
        ]);

        const orderedProgress: ScanProgressV2[] = [];
        const ordered = await supervisor.inspectScan(
          source,
          {
            projection: { kind: "columns", columns: [0, 1, 3] },
            predicate: {
              kind: "and",
              children: [
                {
                  kind: "predicate",
                  column: 0,
                  operator: "ge",
                  literal: "2",
                },
                {
                  kind: "not",
                  child: {
                    kind: "predicate",
                    column: 1,
                    operator: "contains",
                    literal: "Alice",
                  },
                },
              ],
            },
            orderBy: [
              { column: 3, direction: "desc", nulls: "last" },
              { column: 0, direction: "asc", nulls: "first" },
            ],
            offset: "0",
            limit: 3,
          },
          (progress) => orderedProgress.push(progress),
        );
        expect(ordered.rows).toEqual([
          {
            absoluteRow: "8",
            localRow: "8",
            rowGroup: 0,
            values: ["8", "Liangyong", "100.00"],
          },
          {
            absoluteRow: "9",
            localRow: "9",
            rowGroup: 0,
            values: ["9", "Eric", "99.76"],
          },
          {
            absoluteRow: "5",
            localRow: "5",
            rowGroup: 0,
            values: ["5", "Cat", "90.10"],
          },
        ]);
        expect(ordered.scan).toEqual({
          ordered: true,
          completion: "complete",
        });
        expect(naturalProgress.at(-1)?.phase).toBe("complete");
        expect(orderedProgress.at(-1)).toMatchObject({
          phase: "complete",
          rowGroupsConsidered: 1,
          scannedRowGroups: 1,
        });
      } finally {
        await supervisor.dispose();
        await source.close();
      }
    });
  },
);
