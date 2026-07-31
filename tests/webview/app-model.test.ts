import {
  decodeCoreCapabilities,
  decodeMetadataResultJson,
  decodeRowGroupResultJson,
} from "@pixels-inspector/protocol-client";
import {
  describe,
  expect,
  it,
} from "vitest";

import {
  decodeHostMessage,
} from "../../webview/src/app/bridge.js";
import {
  appReducer,
  automaticDataLoad,
  automaticQueryPlan,
  initialState,
  selectChunk,
  selectPixel,
  selectRowGroup,
  selectRow,
} from "../../webview/src/app/model.js";
import type {
  AppState,
} from "../../webview/src/app/model.js";
import {
  EXPECTED_METADATA,
  EXPECTED_ROW_GROUP,
} from "../fixtures/expected.js";

const capabilities = decodeCoreCapabilities({
  abi: 4,
  page: "generic-v1",
  rows: "rows-v1",
  filter: "filter-v1",
  scan: "scan-v2",
  rowGroup: "layout-v1",
  maxRows: 500,
  defaultRows: 100,
  defaultScanRows: 20,
  maxScanRows: 500,
  maxProjectionColumns: 128,
  maxExpressionNodes: 64,
  maxOrderKeys: 8,
  maxOrderedWindowRows: 4096,
  types: [
    "BOOLEAN",
    "BYTE",
    "SHORT",
    "INT",
    "LONG",
    "FLOAT",
    "DOUBLE",
    "STRING",
    "BINARY",
    "TIMESTAMP",
    "ARRAY",
    "MAP",
    "STRUCT",
    "VARBINARY",
    "DECIMAL",
    "DATE",
    "VARCHAR",
    "CHAR",
    "TIME",
    "VECTOR",
  ].map((name, kind) => ({ kind, name })),
  encodings: ["NONE", "RUNLENGTH", "DICTIONARY"],
  compression: {
    metadata: ["NONE", "ZLIB", "SNAPPY", "LZO", "LZ4", "ZSTD"],
    payload: "inactive",
    reason: "postscript-v1-unused",
  },
  nested: "portable-v1",
});

const metadata = decodeMetadataResultJson(
  EXPECTED_METADATA.replace('"abi":3', '"abi":4'),
);
const rowGroup = decodeRowGroupResultJson(EXPECTED_ROW_GROUP);

describe("workspace reducer", () => {
  it("initializes the bounded presentation defaults and projection", () => {
    const state = appReducer(initialState, {
      type: "host",
      message: {
        kind: "metadata",
        revision: 2,
        source: {
          uri: "test://fixture.pxl",
          size: "476",
          revision: "476:1",
        },
        capabilities,
        metadata,
      },
    });
    expect(state.pageSize).toBe(100);
    expect(state.orientation).toBe("rows");
    expect(state.timestampDisplay).toBe("utc");
    expect(state.dataProjection).toEqual([0, 1, 2, 3]);
    expect(state.query.draft).toEqual({
      projection: { kind: "all" },
      orderBy: [],
      offset: "0",
      limit: 20,
    });
    expect(state.selected).toEqual({ kind: "file", key: "file" });
  });

  it("suppresses stale host results", () => {
    const current = { ...initialState, revision: 4 };
    const stale = appReducer(current, {
      type: "host",
      message: { kind: "empty", revision: 3 },
    });
    expect(stale).toBe(current);
  });

  it("decodes revisioned Scan v2 progress at the Webview boundary", () => {
    expect(
      decodeHostMessage({
        kind: "scanProgress",
        revision: 5,
        elapsedMs: 1250,
        progress: {
          phase: "scanning",
          rowGroupsTotal: 2,
          rowGroupsConsidered: 1,
          scannedRowGroups: 1,
          prunedRowGroups: 0,
          currentRowGroup: 0,
          retainedCandidates: 1,
          rowsTotal: "4",
          scannedRows: "2",
          prunedRows: "0",
          matchedRows: "1",
        },
      }),
    ).toMatchObject({
      kind: "scanProgress",
      revision: 5,
      elapsedMs: 1250,
    });
    expect(() =>
      decodeHostMessage({
        kind: "scanProgress",
        revision: 5,
        elapsedMs: -1,
        progress: {},
      }),
    ).toThrow();
  });

  it("keeps physical selection keys stable across semantic zoom", () => {
    const chunk = appReducer(initialState, {
      type: "select",
      entity: selectChunk(3, 7),
    });
    const pixel = appReducer(chunk, {
      type: "select",
      entity: selectPixel(3, 7, 2),
    });
    expect(chunk.focusedColumn).toBe(7);
    expect(pixel.selected.key).toBe("pixel:3:7:2");
    expect(pixel.focusedColumn).toBe(7);
  });

  it("keeps the newest Analyze selection across delayed metadata and layout replay", () => {
    const source = {
      uri: "test://fixture.pxl",
      size: "476",
      revision: "476:sticky-selection",
    };
    const metadataMessage = (revision: number) => ({
      kind: "metadata" as const,
      revision,
      source,
      capabilities,
      metadata,
    });
    let state = appReducer(initialState, {
      type: "host",
      message: metadataMessage(1),
    });

    state = appReducer(state, {
      type: "select",
      entity: selectRowGroup(0),
    });
    state = appReducer(state, {
      type: "host",
      message: { kind: "loading", revision: 2, stage: "metadata" },
    });
    state = appReducer(state, {
      type: "host",
      message: metadataMessage(2),
    });
    expect(state.selected).toEqual(selectRowGroup(0));
    state = appReducer(state, {
      type: "host",
      message: { kind: "rowGroup", revision: 2, rowGroup },
    });
    expect(state.selected).toEqual(selectRowGroup(0));

    state = appReducer(state, { type: "select", entity: selectChunk(0, 0) });
    state = appReducer(state, {
      type: "host",
      message: metadataMessage(3),
    });
    expect(state.selected).toEqual(selectChunk(0, 0));
    state = appReducer(state, { type: "select", entity: selectPixel(0, 0, 0) });
    state = appReducer(state, {
      type: "host",
      message: { kind: "rowGroup", revision: 3, rowGroup },
    });
    expect(state.selected).toEqual(selectPixel(0, 0, 0));

    const rapidRowGroup = appReducer(state, {
      type: "select",
      entity: selectRowGroup(1),
    });
    const newerLoading = appReducer(rapidRowGroup, {
      type: "host",
      message: { kind: "loading", revision: 4, stage: "rowGroup" },
    });
    expect(
      appReducer(newerLoading, {
        type: "host",
        message: { kind: "rowGroup", revision: 3, rowGroup },
      }),
    ).toBe(newerLoading);
    const currentRowGroup = {
      ...rowGroup,
      rowGroup: 1,
    };
    state = appReducer(newerLoading, {
      type: "host",
      message: { kind: "rowGroup", revision: 4, rowGroup: currentRowGroup },
    });
    expect(state.selected).toEqual(selectRowGroup(1));
    expect(state.rowGroup?.rowGroup).toBe(1);

    const revisited = appReducer(
      appReducer(state, { type: "mode", mode: "data" }),
      { type: "mode", mode: "analyze" },
    );
    expect(revisited.selected).toEqual(selectRowGroup(1));

    const refreshing = appReducer(revisited, {
      type: "host",
      message: { kind: "loading", revision: 5, stage: "source" },
    });
    const refreshed = appReducer(refreshing, {
      type: "host",
      message: metadataMessage(5),
    });
    expect(refreshed.selected).toEqual({ kind: "file", key: "file" });
  });

  it("resets Analyze selection for a true source replacement even if its revision token collides", () => {
    const selected = appReducer(
      {
        ...initialState,
        source: { uri: "test://old", size: "476", revision: "same" },
        metadata,
        selected: selectChunk(0, 0),
      },
      {
        type: "host",
        message: {
          kind: "metadata",
          revision: 2,
          source: { uri: "test://new", size: "476", revision: "same" },
          capabilities,
          metadata,
        },
      },
    );
    expect(selected.selected).toEqual({ kind: "file", key: "file" });
  });

  it("preserves Analyze selection when a refresh fails", () => {
    const selected = {
      ...initialState,
      revision: 1,
      source: {
        uri: "test://fixture.pxl",
        size: "476",
        revision: "stable",
      },
      metadata,
      selected: selectPixel(0, 0, 0),
    };
    const loading = appReducer(selected, {
      type: "host",
      message: { kind: "loading", revision: 2, stage: "source" },
    });
    const failed = appReducer(loading, {
      type: "host",
      message: {
        kind: "error",
        revision: 2,
        error: { code: "SOURCE_CHANGED", message: "changed", recoverable: true },
      },
    });
    expect(failed.selected).toEqual(selectPixel(0, 0, 0));
    expect(failed.sourceReloading).toBe(false);
  });

  it("falls back to the nearest valid Analyze ancestor when replay shape changes", () => {
    const source = {
      uri: "test://fixture.pxl",
      size: "476",
      revision: "stable",
    };
    const replay = (selected: ReturnType<typeof selectPixel>, nextMetadata = metadata) =>
      appReducer(
        { ...initialState, source, metadata, selected },
        {
          type: "host",
          message: {
            kind: "metadata",
            revision: 2,
            source,
            capabilities,
            metadata: nextMetadata,
          },
        },
      );

    const withoutColumn = {
      ...metadata,
      schema: metadata.schema.slice(1),
      schemaCount: metadata.schemaCount - 1,
      fileStatistics: metadata.fileStatistics.slice(1),
      rowGroupStatistics: metadata.rowGroupStatistics.map((statistics) =>
        statistics.slice(1)),
    };
    expect(replay(selectPixel(0, 0, 0), withoutColumn).selected).toEqual(
      selectRowGroup(0),
    );

    const withoutRowGroups = {
      ...metadata,
      rowGroups: [],
      rowGroupCount: 0,
      rowGroupStatistics: [],
    };
    expect(replay(selectPixel(0, 0, 0), withoutRowGroups).selected).toEqual({
      kind: "file",
      key: "file",
    });
  });

  it("rejects a layout for a different selected ancestor and validates chunk and pixel linkage", () => {
    const selected = {
      ...initialState,
      revision: 4,
      metadata,
      selected: selectPixel(0, 0, 99),
      hoveredKey: "pixel:0:0:99" as const,
    };
    const wrongAncestor = appReducer(selected, {
      type: "host",
      message: {
        kind: "rowGroup",
        revision: 4,
        rowGroup: { ...rowGroup, rowGroup: 1 },
      },
    });
    expect(wrongAncestor).toBe(selected);

    const missingPixel = appReducer(selected, {
      type: "host",
      message: { kind: "rowGroup", revision: 4, rowGroup },
    });
    expect(missingPixel.selected).toEqual(selectChunk(0, 0));
    expect(missingPixel.hoveredKey).toBeUndefined();

    const missingChunk = appReducer(
      { ...selected, selected: selectChunk(0, 3) },
      {
        type: "host",
        message: {
          kind: "rowGroup",
          revision: 4,
          rowGroup: {
            ...rowGroup,
            columns: rowGroup.columns.filter((column) => column.column !== 3),
          },
        },
      },
    );
    expect(missingChunk.selected).toEqual(selectRowGroup(0));
  });

  it("allows an empty projection so the UI can avoid invalid row requests", () => {
    const state = { ...initialState, dataProjection: [4] };
    expect(
      appReducer(state, {
        type: "toggle-projection",
        column: 4,
      }),
    ).toMatchObject({ dataProjection: [] });
  });

  it("keeps Data and Query projections independent", () => {
    const state = {
      ...initialState,
      dataProjection: [0, 1],
      query: {
        ...initialState.query,
        draft: {
          ...initialState.query.draft,
          projection: { kind: "columns" as const, columns: [2, 3] },
        },
      },
    };
    const next = appReducer(state, {
      type: "data-projection",
      projection: [1, 4],
    });
    expect(next.dataProjection).toEqual([1, 4]);
    expect(next.query.draft.projection).toEqual({
      kind: "columns",
      columns: [2, 3],
    });
  });

  it("plans one bounded default Data load on first entry and gates revisits", () => {
    const ready = appReducer(
      appReducer(initialState, {
        type: "host",
        message: {
          kind: "metadata",
          revision: 1,
          source: { uri: "test://one", size: "476", revision: "one" },
          capabilities,
          metadata,
        },
      }),
      { type: "mode", mode: "data" },
    );
    expect(automaticDataLoad(ready)).toEqual({
      kind: "rows",
      rowGroup: 0,
      columns: [0, 1, 2, 3],
      rowOffset: 0,
      rowCount: 10,
    });
    const started = appReducer(ready, { type: "data-auto-start" });
    expect(started.dataAutoLoadAttempted).toBe(true);
    expect(automaticDataLoad(started)).toBeUndefined();
    const revisited = appReducer(
      appReducer(started, { type: "mode", mode: "query" }),
      { type: "mode", mode: "data" },
    );
    expect(automaticDataLoad(revisited)).toBeUndefined();
  });

  it("waits for metadata and respects configured Data defaults", () => {
    let state = appReducer(initialState, { type: "mode", mode: "data" });
    expect(automaticDataLoad(state)).toBeUndefined();
    state = appReducer(state, {
      type: "host",
      message: {
        kind: "preferences",
        preferences: {
          pageSize: 25,
          orientation: "column",
          timestampDisplay: "utc",
        },
      },
    });
    state = appReducer(state, {
      type: "host",
      message: {
        kind: "metadata",
        revision: 1,
        source: { uri: "test://one", size: "476", revision: "one" },
        capabilities,
        metadata,
      },
    });
    expect(automaticDataLoad(state)).toEqual({
      kind: "column",
      rowGroup: 0,
      column: 0,
      rowOffset: 0,
      rowCount: 10,
    });
  });

  it("marks empty Data sources attempted without planning a row request", () => {
    const emptyMetadata = {
      ...metadata,
      rowGroups: [],
      rowGroupCount: 0,
      rowGroupStatistics: [],
    };
    const ready = {
      ...initialState,
      mode: "data" as const,
      source: { uri: "test://empty", size: "0", revision: "empty" },
      metadata: emptyMetadata,
      capabilities,
    };
    expect(automaticDataLoad(ready)).toEqual({ kind: "empty" });
    expect(
      automaticDataLoad(appReducer(ready, { type: "data-auto-start" })),
    ).toBeUndefined();
  });

  it("preserves Data pages across same-source replay and re-arms accepted refresh", () => {
    const source = { uri: "test://one", size: "476", revision: "one" };
    const loadedRows = {
      operation: "rows-v1" as const,
      rowGroup: 0,
      offset: "0",
      count: 1,
      columns: [{ id: 0, name: "longs", kind: 4 }],
      rows: [{
        rowGroup: 0,
        localRow: "0",
        absoluteRow: "0",
        values: ["0"],
      }],
    };
    let state: AppState = {
      ...initialState,
      revision: 1,
      mode: "data" as const,
      source,
      metadata,
      capabilities,
      rows: loadedRows,
      pageSize: 25,
      dataProjection: [0],
      dataProjectionEdited: true,
      dataAutoLoadAttempted: true,
      dataEpoch: 1,
      dataResultEpoch: 1,
    };
    state = appReducer(state, {
      type: "host",
      message: { kind: "metadata", revision: 2, source, capabilities, metadata },
    });
    expect(state.rows).toBe(loadedRows);
    expect(state.dataAutoLoadAttempted).toBe(true);
    expect(automaticDataLoad(state)).toBeUndefined();

    state = appReducer(state, {
      type: "host",
      message: { kind: "loading", revision: 3, stage: "source" },
    });
    state = appReducer(state, {
      type: "host",
      message: {
        kind: "metadata",
        revision: 3,
        source: { ...source, revision: "two" },
        capabilities,
        metadata,
      },
    });
    expect(state.rows).toBe(loadedRows);
    expect(state.dataProjection).toEqual([0]);
    expect(state.dataProjectionEdited).toBe(true);
    expect(state.dataAutoLoadAttempted).toBe(false);
    expect(automaticDataLoad(state)).toEqual({
      kind: "rows",
      rowGroup: 0,
      columns: [0],
      rowOffset: 0,
      rowCount: 10,
    });
  });

  it("resets Data semantic inputs instead of mapping numeric IDs across schemas", () => {
    const changedMetadata = {
      ...metadata,
      schema: metadata.schema.map((type, index) =>
        index === 0 ? { ...type, name: "customer_id" } : type),
    };
    const replaced = appReducer(
      {
        ...initialState,
        revision: 2,
        mode: "data",
        source: { uri: "test://lineitem", size: "476", revision: "one" },
        metadata,
        capabilities,
        orientation: "rows",
        pageSize: 500,
        dataProjection: [0],
        dataProjectionEdited: true,
        dataAutoLoadAttempted: true,
        dataEpoch: 1,
        configuredPreferences: {
          pageSize: 25,
          orientation: "column",
          timestampDisplay: "utc",
        },
        preferenceOverrides: {
          pageSize: true,
          orientation: true,
          timestampDisplay: false,
        },
      },
      {
        type: "host",
        message: {
          kind: "metadata",
          revision: 3,
          source: { uri: "test://customer", size: "900", revision: "two" },
          capabilities,
          metadata: changedMetadata,
        },
      },
    );
    expect(replaced.orientation).toBe("column");
    expect(replaced.pageSize).toBe(25);
    expect(replaced.dataProjection).toEqual([0, 1, 2, 3]);
    expect(replaced.dataProjectionEdited).toBe(false);
    expect(replaced.preferenceOverrides).toEqual({
      pageSize: false,
      orientation: false,
      timestampDisplay: false,
    });
    expect(replaced.rows).toBeUndefined();
    expect(replaced.page).toBeUndefined();
    expect(automaticDataLoad(replaced)).toEqual({
      kind: "column",
      rowGroup: 0,
      column: 0,
      rowOffset: 0,
      rowCount: 10,
    });
  });

  it("does not repeat an automatic Data load after an error", () => {
    const attempted = {
      ...initialState,
      revision: 1,
      mode: "data" as const,
      source: { uri: "test://one", size: "476", revision: "one" },
      metadata,
      capabilities,
      dataProjection: [0],
      dataAutoLoadAttempted: true,
    };
    const failed = appReducer(attempted, {
      type: "host",
      message: {
        kind: "error",
        revision: 2,
        error: { code: "IO_ERROR", message: "read failed", recoverable: true },
      },
    });
    expect(automaticDataLoad(failed)).toBeUndefined();
  });

  it("keeps Query edits local and invalidates continuation state", () => {
    const submitted = {
      projection: { kind: "all" as const },
      orderBy: [],
      offset: "0",
      limit: 20,
    };
    const running = appReducer(
      {
        ...initialState,
        dataProjection: [0, 1],
      },
      {
        type: "query-start",
        plan: submitted,
        continuation: false,
      },
    );
    expect(running.query.operation).toBe("running");
    expect(running.query.submitted).toEqual(submitted);

    const edited = appReducer(running, {
      type: "query-draft",
      draft: {
        ...submitted,
        projection: { kind: "columns", columns: [2, 3] },
      },
    });
    expect(edited.query.dirty).toBe(true);
    expect(edited.query.operation).toBe("running");
    expect(edited.dataProjection).toEqual([0, 1]);
    expect(edited.query.submitted).toEqual(submitted);
  });

  it("preserves a full custom Query order through revisit and continuation", () => {
    const custom = {
      projection: {
        kind: "columns" as const,
        columns: [3, 2, 1, 0],
      },
      orderBy: [],
      offset: "0",
      limit: 20,
    };
    const edited = appReducer(initialState, {
      type: "query-draft",
      draft: custom,
    });
    const running = appReducer(edited, {
      type: "query-start",
      plan: custom,
      continuation: false,
    });
    const revisited = appReducer(
      appReducer(running, { type: "mode", mode: "data" }),
      { type: "mode", mode: "query" },
    );
    expect(revisited.query.draft.projection).toEqual(custom.projection);
    expect(revisited.query.submitted?.projection).toEqual(custom.projection);

    const continuation = { ...custom, cursor: "cursor-v2" };
    const continued = appReducer(revisited, {
      type: "query-start",
      plan: continuation,
      continuation: true,
    });
    expect(continued.query.submitted?.projection).toEqual(custom.projection);
    expect(continued.query.draft.projection).toEqual(custom.projection);
  });

  it("records one automatic default scan without marking the pristine draft dirty", () => {
    const plan = {
      projection: { kind: "all" as const },
      orderBy: [],
      offset: "0",
      limit: capabilities.defaultScanRows ?? 20,
    };
    const started = appReducer(initialState, {
      type: "query-auto-start",
      plan,
    });
    expect(started.query).toMatchObject({
      draft: plan,
      submitted: plan,
      dirty: false,
      autoRunAttempted: true,
      operation: "running",
    });
    const revisited = appReducer(
      appReducer(started, { type: "mode", mode: "analyze" }),
      { type: "mode", mode: "query" },
    );
    expect(revisited.query.autoRunAttempted).toBe(true);
    expect(revisited.query.submitted).toEqual(plan);
  });

  it("gates automatic Query execution on capability and a pristine first entry", () => {
    const ready = {
      ...initialState,
      mode: "query" as const,
      source: { uri: "test://one", size: "1", revision: "one" },
      capabilities,
    };
    expect(automaticQueryPlan(ready)).toEqual(initialState.query.draft);
    expect(automaticQueryPlan({
      ...ready,
      query: { ...ready.query, dirty: true },
    })).toBeUndefined();
    expect(automaticQueryPlan({
      ...ready,
      capabilities: undefined,
    })).toBeUndefined();
    expect(automaticQueryPlan({
      ...ready,
      query: { ...ready.query, operation: "error" },
    })).toBeUndefined();
  });

  it("preserves Query through refresh failure and re-arms after acceptance", () => {
    const current = appReducer(initialState, {
      type: "host",
      message: {
        kind: "metadata",
        revision: 1,
        source: { uri: "test://one", size: "1", revision: "one" },
        capabilities,
        metadata,
      },
    });
    const currentAttempt = appReducer(current, {
      type: "query-auto-start",
      plan: current.query.draft,
    });
    const refreshing = appReducer(currentAttempt, {
      type: "host",
      message: { kind: "loading", revision: 2, stage: "source" },
    });
    expect(refreshing.query.autoRunAttempted).toBe(true);
    expect(refreshing.query.submitted).toEqual(current.query.draft);
    expect(refreshing.query.operation).toBe("cancelled");

    const failed = appReducer(refreshing, {
      type: "host",
      message: {
        kind: "error",
        revision: 2,
        error: { code: "SOURCE_CHANGED", message: "changed", recoverable: true },
      },
    });
    expect(failed.query.submitted).toEqual(current.query.draft);
    expect(failed.error?.code).toBe("SOURCE_CHANGED");

    const accepted = appReducer(refreshing, {
      type: "host",
      message: {
        kind: "metadata",
        revision: 2,
        source: { uri: "test://one", size: "1", revision: "one" },
        capabilities,
        metadata,
      },
    });
    expect(accepted.query.autoRunAttempted).toBe(false);
    expect(accepted.query.submitted).toBeUndefined();
  });

  it("accepts current scan progress and preserves results across cancellation", () => {
    const running = appReducer(initialState, {
      type: "query-start",
      plan: initialState.query.draft,
      continuation: false,
    });
    const progressed = appReducer(running, {
      type: "host",
      message: {
        kind: "scanProgress",
        revision: 3,
        elapsedMs: 750,
        progress: {
          phase: "scanning",
          rowGroupsTotal: 2,
          rowGroupsConsidered: 1,
          scannedRowGroups: 1,
          prunedRowGroups: 0,
          currentRowGroup: 0,
          retainedCandidates: 4,
          rowsTotal: "10",
          scannedRows: "5",
          prunedRows: "0",
          matchedRows: "4",
        },
      },
    });
    expect(progressed.query.progress?.elapsedMs).toBe(750);

    const completed = appReducer(progressed, {
      type: "host",
      message: {
        kind: "scan",
        revision: 3,
        elapsedMs: 900,
        scan: {
          operation: "scan-v2",
          columns: [],
          rows: [],
          page: {
            offsetApplied: "0",
            limit: 20,
            returned: 0,
            continuationAvailable: false,
            hasMoreExact: true,
            cursor: null,
          },
          scan: { ordered: false, completion: "complete" },
          progress: {
            rowGroupsTotal: 2,
            rowGroupsConsidered: 2,
            scannedRowGroups: 2,
            prunedRowGroups: 0,
            rowsTotal: "10",
            scannedRows: "10",
            prunedRows: "0",
            matchedRows: "4",
          },
        },
      },
    });
    const restarted = appReducer(completed, {
      type: "query-start",
      plan: completed.query.draft,
      continuation: false,
    });
    const cancelled = appReducer(restarted, {
      type: "host",
      message: { kind: "scanCancelled", revision: 4 },
    });
    expect(cancelled.query.operation).toBe("cancelled");
    expect(cancelled.query.result).toBe(completed.query.result);
    expect(cancelled.query.progress).toBeUndefined();
    expect(
      appReducer(completed, {
        type: "host",
        message: { kind: "scanCancelled", revision: 4 },
      }),
    ).toBe(completed);

    const legacyFilter = {
      ...completed,
      loading: "filter" as const,
    };
    expect(
      appReducer(legacyFilter, {
        type: "host",
        message: { kind: "scanCancelled", revision: 4 },
      }),
    ).toMatchObject({ loading: undefined, revision: 4 });
  });

  it("keeps the narrow Data inspector opt-in during navigation and selection", () => {
    const data = appReducer(
      { ...initialState, inspectorOpen: true },
      { type: "mode", mode: "data" },
    );
    expect(data.inspectorOpen).toBe(false);
    const selected = appReducer(data, {
      type: "select",
      entity: selectRow(0, 3),
    });
    expect(selected.inspectorOpen).toBe(false);
    expect(
      appReducer(selected, { type: "inspector", open: true }).inspectorOpen,
    ).toBe(true);
  });

  it("keeps Analyze-only panels closed in canvas modes", () => {
    const query = appReducer(
      { ...initialState, railOpen: true, inspectorOpen: true },
      { type: "mode", mode: "query" },
    );
    expect(query.railOpen).toBe(false);
    expect(query.inspectorOpen).toBe(false);
  });

  it("applies runtime preferences without replacing editor overrides", () => {
    const decoded = decodeHostMessage({
      kind: "preferences",
      preferences: {
        pageSize: 200,
        orientation: "column",
        timestampDisplay: "local",
      },
    });
    expect(decoded).toBeDefined();
    if (decoded === undefined) {
      return;
    }
    const configured = appReducer(initialState, {
      type: "host",
      message: decoded,
    });
    expect(configured.pageSize).toBe(200);
    expect(configured.orientation).toBe("column");
    expect(configured.timestampDisplay).toBe("local");

    const overridden = appReducer(configured, {
      type: "page-size",
      pageSize: 25,
    });
    const updated = appReducer(overridden, {
      type: "host",
      message: {
        kind: "preferences",
        preferences: {
          pageSize: 500,
          orientation: "rows",
          timestampDisplay: "raw",
        },
      },
    });
    expect(updated.pageSize).toBe(25);
    expect(updated.orientation).toBe("rows");
    expect(updated.timestampDisplay).toBe("raw");
  });
});
