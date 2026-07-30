import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { decodeCoreManifest } from "@pixels-inspector/protocol-client";
import { beforeAll, describe, expect, it } from "vitest";

import { NodeFileRangeSource } from "../../extension/src/sources/node-file-range-source.js";
import type { RangeSource } from "../../extension/src/sources/range-source.js";
import { NodeWorkerFactory } from "../../extension/src/worker/node-worker-transport.js";
import { WorkerSupervisor } from "../../extension/src/worker/worker-supervisor.js";
import { EXPECTED_METADATA, EXPECTED_PAGE } from "../fixtures/expected.js";

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
  it("drives exact ranges and survives worker recreation", async () => {
    const source = await NodeFileRangeSource.open(fixturePath);
    const supervisor = await createSupervisor();
    try {
      await expect(supervisor.inspectMetadata(source)).resolves.toBe(
        EXPECTED_METADATA,
      );
      await expect(
        supervisor.inspectPage(source, {
          rowGroup: 0,
          column: 0,
          rowOffset: 0n,
          rowCount: 10,
        }),
      ).resolves.toBe(EXPECTED_PAGE);
      expect(supervisor.metrics).toMatchObject({
        generations: 1,
        rangeRequests: 4,
        transferredBytes: 518n,
      });

      await supervisor.restart();
      await expect(supervisor.inspectMetadata(source)).resolves.toBe(
        EXPECTED_METADATA,
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
      await expect(supervisor.inspectMetadata(base)).resolves.toBe(
        EXPECTED_METADATA,
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
