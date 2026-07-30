import fs from "node:fs/promises";
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

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const manifestPath = path.join(
  root,
  "resources",
  "core",
  "core-manifest.json",
);
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

beforeAll(async () => {
  await fs.access(workerUrl);
});

async function createSupervisor(
  timeout = 5_000,
): Promise<WorkerSupervisor> {
  const manifest = decodeCoreManifest(
    JSON.parse(await fs.readFile(manifestPath, "utf8")),
  );
  const coreDirectory = path.dirname(manifestPath);
  return new WorkerSupervisor(
    new NodeWorkerFactory(workerUrl),
    manifest,
    {
      loaderUrl: path.join(coreDirectory, "pixels-inspector-wasm.cjs"),
      wasmUrl: path.join(coreDirectory, "pixels-inspector-wasm.wasm"),
    },
    timeout,
  );
}

describe("Node parser worker integration", () => {
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
