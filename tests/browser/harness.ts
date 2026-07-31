import {
  decodeCoreManifest,
} from "@pixels-inspector/protocol-client";

import { BufferRangeSource } from "../../extension/src/sources/buffer-range-source.js";
import { BrowserWorkerFactory } from "../../extension/src/worker/browser-worker-transport.js";
import { WorkerSupervisor } from "../../extension/src/worker/worker-supervisor.js";
import {
  EXPECTED_METADATA,
  EXPECTED_PAGE,
  EXPECTED_ROW_GROUP,
} from "../fixtures/expected.js";

const BROWSER_SOURCE_LIMIT = 64n * 1024n * 1024n;

interface BrowserValidationResult {
  readonly metadata: string;
  readonly rowGroup: string;
  readonly page: string;
  readonly lineitemMetadata: string;
  readonly lineitemRowGroup: string;
  readonly lineitemPage: string;
  readonly lineitemSize: string;
  readonly multiPixelMetadata: string;
  readonly multiPixelRowGroup: string;
  readonly multiPixelSize: string;
  readonly customerMetadata: string;
  readonly customerRowGroup: string;
  readonly customerRows: string;
  readonly customerScan: string;
  readonly customerSize: string;
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
  const lineitemResponse = await fetch(
    "/third_party/pixels/cpp/tests/data/tpch-lineitem.pxl",
  );
  if (!lineitemResponse.ok) {
    throw new Error("unable to load TPC-H lineitem fixture");
  }
  const lineitem = new Uint8Array(await lineitemResponse.arrayBuffer());
  const lineitemSource = new BufferRangeSource(
    "test-vfs://browser/tpch-lineitem.pxl",
    lineitem,
    { limit: BROWSER_SOURCE_LIMIT },
  );
  const multiPixelResponse = await fetch(
    "/third_party/pixels/cpp/tests/data/multi-pixel-long.pxl",
  );
  if (!multiPixelResponse.ok) {
    throw new Error("unable to load generated multi-pixel fixture");
  }
  const multiPixel = new Uint8Array(await multiPixelResponse.arrayBuffer());
  const multiPixelSource = new BufferRangeSource(
    "test-vfs://browser/multi-pixel-long.pxl",
    multiPixel,
    { limit: BROWSER_SOURCE_LIMIT },
  );
  const customerResponse = await fetch("/examples/customer.pxl");
  if (!customerResponse.ok) {
    throw new Error("unable to load customer example");
  }
  const customer = new Uint8Array(await customerResponse.arrayBuffer());
  const customerSource = new BufferRangeSource(
    "test-vfs://browser/customer.pxl",
    customer,
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
    const metadata = JSON.stringify(
      await supervisor.inspectMetadata(source),
    );
    if (metadata !== EXPECTED_METADATA) {
      throw new Error("browser metadata differs from the native golden");
    }
    const rowGroup = JSON.stringify(
      await supervisor.inspectRowGroup(source, 0),
    );
    if (rowGroup !== EXPECTED_ROW_GROUP) {
      throw new Error("browser row-group layout differs from the native golden");
    }
    const pageStartedAt = performance.now();
    const page = JSON.stringify(
      await supervisor.inspectPage(source, {
        rowGroup: 0,
        column: 0,
        rowOffset: 0n,
        rowCount: 10,
      }),
    );
    const pageCompletedAt = performance.now();
    if (page !== EXPECTED_PAGE) {
      throw new Error("browser page differs from the native golden");
    }
    const scanProgress: string[] = [];
    const firstScan = await supervisor.inspectScan(
      source,
      {
        projection: { kind: "all" },
        orderBy: [],
        offset: "0",
        limit: 3,
      },
      (progress) => scanProgress.push(progress.phase),
    );
    if (
      JSON.stringify(firstScan.rows.map((row) => row.absoluteRow)) !==
        JSON.stringify(["0", "1", "2"]) ||
      firstScan.page.cursor === null ||
      !/^UFhDMg[A-Za-z0-9_-]{48}$/u.test(firstScan.page.cursor)
    ) {
      throw new Error("browser natural scan/cursor differs");
    }
    const secondScan = await supervisor.inspectScan(source, {
      projection: { kind: "all" },
      orderBy: [],
      offset: "0",
      limit: 3,
      cursor: firstScan.page.cursor,
    });
    if (
      JSON.stringify(secondScan.rows.map((row) => row.absoluteRow)) !==
      JSON.stringify(["3", "4", "5"])
    ) {
      throw new Error("browser natural scan continuation differs");
    }
    const orderedScan = await supervisor.inspectScan(
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
      (progress) => scanProgress.push(progress.phase),
    );
    if (
      orderedScan.rows.length !== 3 ||
      !orderedScan.scan.ordered ||
      scanProgress.at(-1) !== "complete"
    ) {
      throw new Error("browser ordered/composite scan differs");
    }
    await supervisor.restart();
    const recreatedMetadata = JSON.stringify(
      await supervisor.inspectMetadata(source),
    );
    if (recreatedMetadata !== EXPECTED_METADATA) {
      throw new Error("recreated browser worker returned different metadata");
    }
    await supervisor.restart();
    const decodedLineitemMetadata =
      await supervisor.inspectMetadata(lineitemSource);
    const lineitemMetadata = JSON.stringify(decodedLineitemMetadata);
    if (
      decodedLineitemMetadata.schemaCount !== 16 ||
      decodedLineitemMetadata.rowGroupCount !== 2
    ) {
      throw new Error("browser did not decode the complete lineitem shape");
    }
    const lineitemRowGroup = JSON.stringify(
      await supervisor.inspectRowGroup(lineitemSource, 1),
    );
    const decodedLineitemPage = await supervisor.inspectPage(
      lineitemSource,
      {
        rowGroup: 1,
        column: 15,
        rowOffset: 0n,
        rowCount: 2,
      },
    );
    const lineitemPage = JSON.stringify(decodedLineitemPage);
    if (
      JSON.stringify(decodedLineitemPage.values) !==
      JSON.stringify(["third line", "fourth line"])
    ) {
      throw new Error("browser decoded incorrect lineitem values");
    }
    await supervisor.restart();
    const decodedMultiPixelMetadata =
      await supervisor.inspectMetadata(multiPixelSource);
    const decodedMultiPixelRowGroup =
      await supervisor.inspectRowGroup(multiPixelSource, 0);
    const decodedMultiPixelPage = await supervisor.inspectPage(
      multiPixelSource,
      {
        rowGroup: 0,
        column: 0,
        rowOffset: 0n,
        rowCount: 10,
      },
    );
    const multiPixelColumn = decodedMultiPixelRowGroup.columns[0];
    if (
      decodedMultiPixelMetadata.rowGroupCount !== 1 ||
      decodedMultiPixelMetadata.pixelStride !== 4 ||
      decodedMultiPixelMetadata.schema.length !== 1 ||
      decodedMultiPixelRowGroup.columns.length !== 1 ||
      multiPixelColumn?.chunk.pixels.length !== 3 ||
      JSON.stringify(multiPixelColumn.chunk.pixels.map((pixel) => pixel.position)) !==
        JSON.stringify([0, 32, 64]) ||
      JSON.stringify(multiPixelColumn.chunk.pixels.map(
        (pixel) => pixel.statistics?.numberOfValues,
      )) !== JSON.stringify(["4", "4", "2"]) ||
      JSON.stringify(decodedMultiPixelPage.values) !==
        JSON.stringify(["0", "1", "2", "3", "4", "5", "6", "7", "8", "9"])
    ) {
      throw new Error(
        `generated fixture did not expose three Core-owned pixel segments: ${JSON.stringify({
          rowGroupCount: decodedMultiPixelMetadata.rowGroupCount,
          pixelStride: decodedMultiPixelMetadata.pixelStride,
          pixels: multiPixelColumn?.chunk.pixels,
        })}`,
      );
    }
    await supervisor.restart();
    const decodedCustomerMetadata =
      await supervisor.inspectMetadata(customerSource);
    const decodedCustomerRowGroup =
      await supervisor.inspectRowGroup(customerSource, 0);
    const decodedCustomerRows = await supervisor.inspectRows(customerSource, {
      rowGroup: 0,
      columns: [0, 1, 3, 5, 6],
      rowOffset: 0n,
      rowCount: 20,
    });
    const decodedCustomerScan = await supervisor.inspectScan(customerSource, {
      projection: { kind: "all" },
      orderBy: [],
      offset: "0",
      limit: 20,
    });
    if (
      decodedCustomerMetadata.schema.length !== 8 ||
      decodedCustomerMetadata.rowGroupCount !== 3 ||
      decodedCustomerMetadata.rows !== 75 ||
      decodedCustomerMetadata.pixelStride !== 5 ||
      decodedCustomerRowGroup.columns.length !== 8 ||
      decodedCustomerRowGroup.columns.some(
        (column) => column.chunk.pixels.length < 5,
      ) ||
      decodedCustomerRows.rows[0]?.values[1] !== "Customer#1001" ||
      decodedCustomerScan.rows.length === 0 ||
      decodedCustomerScan.rows[0]?.values[0] === undefined
    ) {
      throw new Error("customer example failed Chromium round-trip assertions");
    }
    const wasmArtifact =
      manifest.artifacts["pixels-inspector-wasm.wasm"];
    if (wasmArtifact === undefined) {
      throw new Error("Core manifest is missing WASM");
    }
    return {
      metadata,
      rowGroup,
      page,
      lineitemMetadata,
      lineitemRowGroup,
      lineitemPage,
      lineitemSize: String(lineitem.byteLength),
      multiPixelMetadata: JSON.stringify(decodedMultiPixelMetadata),
      multiPixelRowGroup: JSON.stringify(decodedMultiPixelRowGroup),
      multiPixelSize: String(multiPixel.byteLength),
      customerMetadata: JSON.stringify(decodedCustomerMetadata),
      customerRowGroup: JSON.stringify(decodedCustomerRowGroup),
      customerRows: JSON.stringify(decodedCustomerRows),
      customerScan: JSON.stringify(decodedCustomerScan),
      customerSize: String(customer.byteLength),
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
    await lineitemSource.close();
    await multiPixelSource.close();
    await customerSource.close();
  }
}

globalThis.pixelsBrowserValidation = run();
