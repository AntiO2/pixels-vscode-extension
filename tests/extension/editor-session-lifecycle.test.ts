import type * as vscode from "vscode";
import {
  decodeMetadataResultJson,
  decodeRowsResult,
} from "@pixels-inspector/protocol-client";
import type {
  CoreManifest,
  MetadataResult,
  RowsResult,
} from "@pixels-inspector/protocol-client";
import {
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import type { RangeSource } from "../../extension/src/sources/range-source.js";
import type { WorkerFactory } from "../../extension/src/worker/transport.js";
import { EXPECTED_METADATA } from "../fixtures/expected.js";

const mocks = vi.hoisted(() => {
  const supervisor = {
    cancelActive: vi.fn<() => Promise<void>>(),
    restart: vi.fn<() => Promise<void>>(),
    inspectMetadata: vi.fn<() => Promise<MetadataResult>>(),
    inspectRows: vi.fn(),
    inspectScan: vi.fn(),
    dispose: vi.fn<() => Promise<void>>(),
    metrics: { generations: 0 },
    capabilities: { scan: "scan-v2" },
  };
  return {
    supervisor,
    configurationListener: undefined as
      | ((event: vscode.ConfigurationChangeEvent) => void)
      | undefined,
  };
});

vi.mock("vscode", () => ({
  workspace: {
    getConfiguration: vi.fn(() => ({
      get: vi.fn(() => undefined),
    })),
    onDidChangeConfiguration: vi.fn(
      (listener: (event: vscode.ConfigurationChangeEvent) => void) => {
        mocks.configurationListener = listener;
        return { dispose: vi.fn() };
      },
    ),
  },
}));

vi.mock("../../extension/src/worker/worker-supervisor.js", () => ({
  WorkerSupervisor: function WorkerSupervisor() {
    return mocks.supervisor;
  },
}));

import {
  EditorSession,
  PixelsDocument,
} from "../../extension/src/custom-editor.js";
import type { InspectorRuntime } from "../../extension/src/custom-editor.js";

const metadata = decodeMetadataResultJson(EXPECTED_METADATA);

const manifest: CoreManifest = {
  schemaVersion: 1,
  abiVersion: 4,
  coreCommit: "7".repeat(40),
  toolchain: {
    emscripten: "6.0.5",
    protobuf: "3.21.6",
  },
  capabilities: ["metadata-v2"],
  artifacts: {
    "pixels-inspector-wasm.wasm": {
      bytes: 4,
      sha256: "a".repeat(64),
    },
  },
};

interface Deferred<T> {
  readonly promise: Promise<T>;
  resolve(value: T): void;
}

function deferred<T>(): Deferred<T> {
  let resolvePromise: ((value: T) => void) | undefined;
  const promise = new Promise<T>((resolve) => {
    resolvePromise = resolve;
  });
  return {
    promise,
    resolve(value: T): void {
      resolvePromise?.(value);
    },
  };
}

class FakeSource implements RangeSource {
  public readonly size = 64n;
  public readonly identity;
  public readonly close = vi.fn(() => Promise.resolve());

  public constructor(uri: string, revision: string) {
    this.identity = {
      uri,
      size: this.size,
      modifiedAt: undefined,
      revision,
    };
  }

  public read(): Promise<Uint8Array> {
    return Promise.resolve(new Uint8Array());
  }
}

interface PanelHarness {
  readonly panel: vscode.WebviewPanel;
  readonly posted: unknown[];
  receive(message: unknown): void;
  dispose(): void;
}

function createPanel(): PanelHarness {
  const posted: unknown[] = [];
  let receiveListener: ((message: unknown) => void) | undefined;
  let disposeListener: (() => void) | undefined;
  const panel = Object.assign(Object.create(null), {
    webview: {
      onDidReceiveMessage(listener: (message: unknown) => void) {
        receiveListener = listener;
        return { dispose: vi.fn() };
      },
      postMessage(message: unknown) {
        posted.push(message);
        return Promise.resolve(true);
      },
    },
    onDidDispose(listener: () => void) {
      disposeListener = listener;
      return { dispose: vi.fn() };
    },
  }) as vscode.WebviewPanel;
  return {
    panel,
    posted,
    receive(message: unknown): void {
      receiveListener?.(message);
    },
    dispose(): void {
      disposeListener?.();
    },
  };
}

function createUri(): vscode.Uri {
  return Object.assign(Object.create(null), {
    scheme: "file",
    authority: "",
    path: "/workspace/customer.pxl",
    fsPath: "/workspace/customer.pxl",
    query: "",
    fragment: "",
    toString: () => "file:///workspace/customer.pxl",
  }) as vscode.Uri;
}

function createRuntime(
  openSource: InspectorRuntime["openSource"],
): InspectorRuntime {
  const workerFactory = Object.assign(Object.create(null), {
    create: vi.fn(),
  }) as WorkerFactory;
  return {
    manifest,
    workerFactory,
    locations: {
      loaderUrl: "file:///core.cjs",
      wasmUrl: "file:///core.wasm",
    },
    openSource,
  };
}

function metadataPosts(posted: readonly unknown[]): Record<string, unknown>[] {
  return posted.filter(
    (message): message is Record<string, unknown> =>
      typeof message === "object" &&
      message !== null &&
      "kind" in message &&
      message.kind === "metadata",
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function rowsFragment(columns: readonly number[]): RowsResult {
  return {
    operation: "rows-v1",
    rowGroup: 0,
    offset: "0",
    count: 2,
    columns: columns.map((id) => ({
      id,
      name: metadata.schema[id]?.name ?? `column-${String(id)}`,
      kind: metadata.schema[id]?.kind ?? 4,
    })),
    rows: [0, 1].map((row) => ({
      rowGroup: 0,
      localRow: String(row),
      absoluteRow: String(row),
      values: columns.map((column) => `${String(column)}:${String(row)}`),
    })),
  };
}

function findRowsPost(
  posted: readonly unknown[],
  revision: number,
): RowsResult | undefined {
  const message = posted.find(
    (candidate): candidate is Record<string, unknown> =>
      isRecord(candidate) &&
      candidate["kind"] === "rows" &&
      candidate["revision"] === revision,
  );
  return message === undefined ? undefined : decodeRowsResult(message["rows"]);
}

describe("EditorSession source lifecycle", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.supervisor.metrics.generations = 0;
    mocks.supervisor.cancelActive.mockResolvedValue();
    mocks.supervisor.restart.mockImplementation(() => {
      mocks.supervisor.metrics.generations += 1;
      return Promise.resolve();
    });
    mocks.supervisor.inspectMetadata.mockResolvedValue(metadata);
    mocks.supervisor.inspectRows.mockImplementation(
      (_source: RangeSource, selection: { readonly columns: readonly number[] }) =>
        Promise.resolve(rowsFragment(selection.columns)),
    );
    mocks.supervisor.inspectScan.mockResolvedValue({});
    mocks.supervisor.dispose.mockResolvedValue();
  });

  it("closes a source that resolves after the panel is disposed", async () => {
    const opened = deferred<RangeSource>();
    const source = new FakeSource("file:///late.pxl", "late");
    const openSource = vi.fn(() => opened.promise);
    const panel = createPanel();
    const session = new EditorSession(
      new PixelsDocument(createUri()),
      panel.panel,
      createRuntime(openSource),
    );

    session.start();
    panel.receive({ kind: "ready" });
    await vi.waitFor(() => expect(openSource).toHaveBeenCalledOnce());
    panel.dispose();
    opened.resolve(source);

    await vi.waitFor(() => expect(source.close).toHaveBeenCalledOnce());
    expect(mocks.supervisor.restart).not.toHaveBeenCalled();
    expect(metadataPosts(panel.posted)).toHaveLength(0);
  });

  it("rejects a superseded open before accepting and publishing its replacement", async () => {
    const firstOpen = deferred<RangeSource>();
    const secondOpen = deferred<RangeSource>();
    const first = new FakeSource("file:///first.pxl", "first");
    const second = new FakeSource("file:///second.pxl", "second");
    const openSource = vi
      .fn<InspectorRuntime["openSource"]>()
      .mockImplementationOnce(() => firstOpen.promise)
      .mockImplementationOnce(() => secondOpen.promise);
    const panel = createPanel();
    const session = new EditorSession(
      new PixelsDocument(createUri()),
      panel.panel,
      createRuntime(openSource),
    );

    session.start();
    panel.receive({ kind: "ready" });
    await vi.waitFor(() => expect(openSource).toHaveBeenCalledOnce());
    panel.receive({ kind: "refresh" });
    firstOpen.resolve(first);
    await vi.waitFor(() => expect(openSource).toHaveBeenCalledTimes(2));
    secondOpen.resolve(second);

    await vi.waitFor(() => expect(metadataPosts(panel.posted)).toHaveLength(1));
    expect(first.close).toHaveBeenCalledOnce();
    expect(second.close).not.toHaveBeenCalled();
    expect(metadataPosts(panel.posted)[0]).toMatchObject({
      revision: 2,
      source: {
        uri: "file:///second.pxl",
        revision: "second",
      },
    });

    panel.dispose();
    await vi.waitFor(() => expect(second.close).toHaveBeenCalledOnce());
  });

  it("keeps the accepted source when refresh metadata fails", async () => {
    const first = new FakeSource("file:///accepted.pxl", "accepted");
    const replacement = new FakeSource("file:///replacement.pxl", "replacement");
    const openSource = vi
      .fn<InspectorRuntime["openSource"]>()
      .mockResolvedValueOnce(first)
      .mockResolvedValueOnce(replacement);
    mocks.supervisor.inspectMetadata
      .mockResolvedValueOnce(metadata)
      .mockRejectedValueOnce(new Error("replacement metadata failed"));
    const panel = createPanel();
    const session = new EditorSession(
      new PixelsDocument(createUri()),
      panel.panel,
      createRuntime(openSource),
    );

    session.start();
    panel.receive({ kind: "ready" });
    await vi.waitFor(() => expect(metadataPosts(panel.posted)).toHaveLength(1));
    panel.receive({ kind: "refresh" });
    await vi.waitFor(() => expect(replacement.close).toHaveBeenCalledOnce());

    expect(first.close).not.toHaveBeenCalled();
    expect(panel.posted).toContainEqual(expect.objectContaining({
      kind: "error",
      revision: 2,
    }));

    panel.dispose();
    await vi.waitFor(() => expect(first.close).toHaveBeenCalledOnce());
  });

  it("cancels a queued scan without entering Core and reports the newest revision", async () => {
    const source = new FakeSource("file:///accepted.pxl", "accepted");
    const openSource = vi.fn<InspectorRuntime["openSource"]>(() =>
      Promise.resolve(source),
    );
    const panel = createPanel();
    const session = new EditorSession(
      new PixelsDocument(createUri()),
      panel.panel,
      createRuntime(openSource),
    );

    session.start();
    panel.receive({ kind: "ready" });
    await vi.waitFor(() => expect(metadataPosts(panel.posted)).toHaveLength(1));

    const scanCancellation = deferred<undefined>();
    mocks.supervisor.cancelActive.mockReset();
    mocks.supervisor.cancelActive
      .mockImplementationOnce(() => scanCancellation.promise)
      .mockResolvedValue();
    panel.receive({
      kind: "runScan",
      plan: {
        projection: { kind: "all" },
        orderBy: [],
        offset: "0",
        limit: 20,
      },
    });
    panel.receive({ kind: "cancel" });
    scanCancellation.resolve(undefined);

    await vi.waitFor(() => {
      expect(panel.posted).toContainEqual({
        kind: "scanCancelled",
        revision: 3,
      });
    });
    expect(mocks.supervisor.inspectScan).not.toHaveBeenCalled();
    expect(
      panel.posted.filter(
        (message) =>
          typeof message === "object" &&
          message !== null &&
          "kind" in message &&
          message.kind === "scanCancelled",
      ),
    ).toHaveLength(1);

    panel.dispose();
    await vi.waitFor(() => expect(source.close).toHaveBeenCalledOnce());
  });

  it("posts preferences only for a relevant resource-scoped configuration change", () => {
    const source = new FakeSource("file:///accepted.pxl", "accepted");
    const panel = createPanel();
    const session = new EditorSession(
      new PixelsDocument(createUri()),
      panel.panel,
      createRuntime(() => Promise.resolve(source)),
    );

    session.start();
    expect(mocks.configurationListener).toBeTypeOf("function");
    mocks.configurationListener?.({
      affectsConfiguration: vi.fn(() => false),
    });
    expect(panel.posted).toHaveLength(0);

    const affectsConfiguration = vi.fn(() => true);
    mocks.configurationListener?.({ affectsConfiguration });
    expect(affectsConfiguration).toHaveBeenCalledWith(
      "pixels.inspector",
      expect.objectContaining({ fsPath: "/workspace/customer.pxl" }),
    );
    expect(panel.posted).toEqual([
      {
        kind: "preferences",
        preferences: {
          pageSize: 100,
          orientation: "rows",
          timestampDisplay: "utc",
        },
      },
    ]);

    panel.dispose();
  });

  it("serves Data reorder and removal from cache and requests only new columns", async () => {
    const source = new FakeSource("file:///accepted.pxl", "accepted");
    const panel = createPanel();
    const session = new EditorSession(
      new PixelsDocument(createUri()),
      panel.panel,
      createRuntime(() => Promise.resolve(source)),
    );

    session.start();
    panel.receive({ kind: "ready" });
    await vi.waitFor(() => expect(metadataPosts(panel.posted)).toHaveLength(1));
    const selectRows = (columns: readonly number[]): void => {
      panel.receive({
        kind: "selectRows",
        rowGroup: 0,
        columns,
        rowOffset: "0",
        rowCount: 2,
      });
    };

    selectRows([0, 1]);
    await vi.waitFor(() => expect(mocks.supervisor.inspectRows).toHaveBeenCalledOnce());
    expect(mocks.supervisor.inspectRows.mock.calls[0]?.[1]).toMatchObject({
      columns: [0, 1],
      rowGroup: 0,
      rowOffset: 0n,
      rowCount: 2,
    });

    selectRows([1, 0]);
    await vi.waitFor(() => {
      expect(findRowsPost(panel.posted, 3)?.columns.map(({ id }) => id)).toEqual([
        1,
        0,
      ]);
    });
    selectRows([1]);
    await vi.waitFor(() => {
      expect(findRowsPost(panel.posted, 4)?.columns.map(({ id }) => id)).toEqual([
        1,
      ]);
    });
    expect(mocks.supervisor.inspectRows).toHaveBeenCalledOnce();

    selectRows([1, 2]);
    await vi.waitFor(() => expect(mocks.supervisor.inspectRows).toHaveBeenCalledTimes(2));
    expect(mocks.supervisor.inspectRows.mock.calls[1]?.[1]).toMatchObject({
      columns: [2],
    });
    await vi.waitFor(() => {
      expect(findRowsPost(panel.posted, 5)?.columns.map(({ id }) => id)).toEqual([
        1,
        2,
      ]);
    });

    panel.dispose();
    await vi.waitFor(() => expect(source.close).toHaveBeenCalledOnce());
  });

  it("never merges a superseded Data fragment into the current cache window", async () => {
    const source = new FakeSource("file:///accepted.pxl", "accepted");
    const panel = createPanel();
    const session = new EditorSession(
      new PixelsDocument(createUri()),
      panel.panel,
      createRuntime(() => Promise.resolve(source)),
    );

    session.start();
    panel.receive({ kind: "ready" });
    await vi.waitFor(() => expect(metadataPosts(panel.posted)).toHaveLength(1));

    const staleFragment = deferred<RowsResult>();
    mocks.supervisor.inspectRows.mockReset();
    mocks.supervisor.inspectRows
      .mockImplementationOnce(() => staleFragment.promise)
      .mockImplementation(
        (_source: RangeSource, selection: { readonly columns: readonly number[] }) =>
          Promise.resolve(rowsFragment(selection.columns)),
      );
    const selectRows = (columns: readonly number[]): void => {
      panel.receive({
        kind: "selectRows",
        rowGroup: 0,
        columns,
        rowOffset: "0",
        rowCount: 2,
      });
    };

    selectRows([0]);
    await vi.waitFor(() => expect(mocks.supervisor.inspectRows).toHaveBeenCalledOnce());
    selectRows([1]);
    staleFragment.resolve(rowsFragment([0]));
    await vi.waitFor(() => expect(mocks.supervisor.inspectRows).toHaveBeenCalledTimes(2));
    await vi.waitFor(() => {
      expect(findRowsPost(panel.posted, 3)?.columns.map(({ id }) => id)).toEqual([
        1,
      ]);
    });

    selectRows([0, 1]);
    await vi.waitFor(() => expect(mocks.supervisor.inspectRows).toHaveBeenCalledTimes(3));
    expect(mocks.supervisor.inspectRows.mock.calls[2]?.[1]).toMatchObject({
      columns: [0],
    });
    await vi.waitFor(() => {
      expect(findRowsPost(panel.posted, 4)?.columns.map(({ id }) => id)).toEqual([
        0,
        1,
      ]);
    });

    panel.dispose();
    await vi.waitFor(() => expect(source.close).toHaveBeenCalledOnce());
  });
});
