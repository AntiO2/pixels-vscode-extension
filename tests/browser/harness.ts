import {
  decodeCoreManifest,
} from "@pixels-inspector/protocol-client";

import { BufferRangeSource } from "../../extension/src/sources/buffer-range-source.js";
import { BrowserWorkerFactory } from "../../extension/src/worker/browser-worker-transport.js";
import { WorkerSupervisor } from "../../extension/src/worker/worker-supervisor.js";
import { EXPECTED_METADATA, EXPECTED_PAGE } from "../fixtures/expected.js";

const BROWSER_SOURCE_LIMIT = 64n * 1024n * 1024n;

interface BrowserValidationResult {
  readonly metadata: string;
  readonly page: string;
  readonly coreDigest: string;
  readonly generations: number;
  readonly rangeRequests: number;
  readonly transferredBytes: string;
  readonly initializationMs: number;
  readonly pageMs: number;
  readonly wholeFileLimit: string;
}

declare global {
  var pixelsBrowserValidation: Promise<BrowserValidationResult>;
}

async function run(): Promise<BrowserValidationResult> {
  const startedAt = performance.now();
  const manifestResponse = await fetch("/resources/core/core-manifest.json");
  if (!manifestResponse.ok) {
    throw new Error("unable to load Core manifest");
  }
  const manifest = decodeCoreManifest(await manifestResponse.json());
  const fixtureResponse = await fetch(
    "/third_party/pixels/cpp/tests/data/example.pxl",
  );
  if (!fixtureResponse.ok) {
    throw new Error("unable to load canonical fixture");
  }
  const declaredLength = fixtureResponse.headers.get("content-length");
  if (
    declaredLength !== null &&
    BigInt(declaredLength) > BROWSER_SOURCE_LIMIT
  ) {
    throw new Error("fixture exceeds browser whole-file policy");
  }
  const fixture = new Uint8Array(await fixtureResponse.arrayBuffer());
  const source = new BufferRangeSource(
    "test-vfs://browser/canonical-fixture",
    fixture,
    { limit: BROWSER_SOURCE_LIMIT },
  );
  const supervisor = new WorkerSupervisor(
    new BrowserWorkerFactory("/dist/worker/browser.js"),
    manifest,
    {
      loaderUrl: "/resources/core/pixels-inspector-wasm.cjs",
      wasmUrl: "/resources/core/pixels-inspector-wasm.wasm",
    },
    5_000,
  );
  try {
    await supervisor.initialize();
    const initializedAt = performance.now();
    const metadata = await supervisor.inspectMetadata(source);
    if (metadata !== EXPECTED_METADATA) {
      throw new Error("browser metadata differs from the native golden");
    }
    const pageStartedAt = performance.now();
    const page = await supervisor.inspectPage(source, {
      rowGroup: 0,
      column: 0,
      rowOffset: 0n,
      rowCount: 10,
    });
    const pageCompletedAt = performance.now();
    if (page !== EXPECTED_PAGE) {
      throw new Error("browser page differs from the native golden");
    }
    await supervisor.restart();
    const recreatedMetadata = await supervisor.inspectMetadata(source);
    if (recreatedMetadata !== EXPECTED_METADATA) {
      throw new Error("recreated browser worker returned different metadata");
    }
    const wasmArtifact =
      manifest.artifacts["pixels-inspector-wasm.wasm"];
    if (wasmArtifact === undefined) {
      throw new Error("Core manifest is missing WASM");
    }
    return {
      metadata,
      page,
      coreDigest: wasmArtifact.sha256,
      generations: supervisor.metrics.generations,
      rangeRequests: supervisor.metrics.rangeRequests,
      transferredBytes: supervisor.metrics.transferredBytes.toString(),
      initializationMs: Number(
        (initializedAt - startedAt).toFixed(3),
      ),
      pageMs: Number((pageCompletedAt - pageStartedAt).toFixed(3)),
      wholeFileLimit: BROWSER_SOURCE_LIMIT.toString(),
    };
  } finally {
    await supervisor.dispose();
    await source.close();
  }
}

globalThis.pixelsBrowserValidation = run();
