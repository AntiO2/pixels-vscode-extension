import type {
  CoreCapabilities,
  FilterResult,
  MetadataResult,
  PageResult,
  RowGroupResult,
  RowsResult,
  ScanPlanV2,
  ScanProgressV2,
  ScanResultV2,
} from "@pixels-inspector/protocol-client";

export type WorkspaceMode = "analyze" | "data" | "query";
export type DataOrientation = "rows" | "column";
export type TimestampDisplay = "utc" | "raw" | "local";
export type PageSize = 25 | 50 | 100 | 200 | 500;

export interface SourceSummary {
  readonly uri: string;
  readonly size: string;
  readonly revision: string;
}

export type EntitySelection =
  | { readonly kind: "file"; readonly key: "file" }
  | {
      readonly kind: "schema";
      readonly key: `schema:${number}`;
      readonly column: number;
    }
  | {
      readonly kind: "row-group";
      readonly key: `row-group:${number}`;
      readonly rowGroup: number;
    }
  | {
      readonly kind: "chunk";
      readonly key: `chunk:${number}:${number}`;
      readonly rowGroup: number;
      readonly column: number;
    }
  | {
      readonly kind: "pixel";
      readonly key: `pixel:${number}:${number}:${number}`;
      readonly rowGroup: number;
      readonly column: number;
      readonly pixel: number;
    }
  | {
      readonly kind: "row";
      readonly key: `row:${number}:${string}`;
      readonly rowGroup: number;
      readonly localRow: string;
    };

export type QueryOperation =
  | "idle"
  | "running"
  | "cancelled"
  | "error";

export type QueryDisclosure = "projection" | "where" | "order" | "range";

export interface QueryState {
  readonly draft: ScanPlanV2;
  readonly submitted: ScanPlanV2 | undefined;
  readonly dirty: boolean;
  readonly autoRunAttempted: boolean;
  readonly operation: QueryOperation;
  readonly disclosure: QueryDisclosure | undefined;
  readonly progress:
    | {
        readonly snapshot: ScanProgressV2;
        readonly elapsedMs: number;
      }
    | undefined;
  readonly result: ScanResultV2 | undefined;
  readonly error: AppError | undefined;
}

export interface AppError {
  readonly code: string;
  readonly message: string;
  readonly recoverable: boolean;
}

export interface AppState {
  readonly revision: number;
  readonly source: SourceSummary | undefined;
  readonly capabilities: CoreCapabilities | undefined;
  readonly metadata: MetadataResult | undefined;
  readonly rowGroup: RowGroupResult | undefined;
  readonly page: PageResult | undefined;
  readonly rows: RowsResult | undefined;
  readonly filter: FilterResult | undefined;
  readonly mode: WorkspaceMode;
  readonly orientation: DataOrientation;
  readonly timestampDisplay: TimestampDisplay;
  readonly pageSize: PageSize;
  readonly dataProjection: readonly number[];
  readonly dataProjectionEdited: boolean;
  readonly dataAutoLoadAttempted: boolean;
  readonly dataEpoch: number;
  readonly dataResultEpoch: number | undefined;
  readonly focusedColumn: number;
  readonly selected: EntitySelection;
  readonly hoveredKey: EntitySelection["key"] | undefined;
  readonly loading: string | undefined;
  readonly sourceReloading: boolean;
  readonly error: AppError | undefined;
  readonly railOpen: boolean;
  readonly inspectorOpen: boolean;
  readonly query: QueryState;
  readonly preferenceOverrides: {
    readonly pageSize: boolean;
    readonly orientation: boolean;
    readonly timestampDisplay: boolean;
  };
  readonly configuredPreferences: {
    readonly pageSize: PageSize;
    readonly orientation: DataOrientation;
    readonly timestampDisplay: TimestampDisplay;
  };
}

export type HostMessage =
  | {
      readonly kind: "preferences";
      readonly preferences: {
        readonly pageSize: PageSize;
        readonly orientation: DataOrientation;
        readonly timestampDisplay: TimestampDisplay;
      };
    }
  | {
      readonly kind: "loading";
      readonly revision: number;
      readonly stage: string;
    }
  | {
      readonly kind: "metadata";
      readonly revision: number;
      readonly source: SourceSummary;
      readonly capabilities: CoreCapabilities;
      readonly metadata: MetadataResult;
    }
  | {
      readonly kind: "rowGroup";
      readonly revision: number;
      readonly rowGroup: RowGroupResult;
    }
  | {
      readonly kind: "page";
      readonly revision: number;
      readonly page: PageResult;
    }
  | {
      readonly kind: "rows";
      readonly revision: number;
      readonly rows: RowsResult;
    }
  | {
      readonly kind: "filter";
      readonly revision: number;
      readonly filter: FilterResult;
    }
  | {
      readonly kind: "scanProgress";
      readonly revision: number;
      readonly progress: ScanProgressV2;
      readonly elapsedMs: number;
    }
  | {
      readonly kind: "scan";
      readonly revision: number;
      readonly scan: ScanResultV2;
      readonly elapsedMs: number;
    }
  | { readonly kind: "scanCancelled"; readonly revision: number }
  | { readonly kind: "empty"; readonly revision: number }
  | {
      readonly kind: "error";
      readonly revision: number;
      readonly error: AppError;
    };

export type AppAction =
  | { readonly type: "host"; readonly message: HostMessage }
  | { readonly type: "mode"; readonly mode: WorkspaceMode }
  | { readonly type: "orientation"; readonly orientation: DataOrientation }
  | { readonly type: "timestamp"; readonly display: TimestampDisplay }
  | { readonly type: "page-size"; readonly pageSize: PageSize }
  | {
      readonly type: "select";
      readonly entity: EntitySelection;
      readonly revealInspector?: boolean;
    }
  | { readonly type: "hover"; readonly key?: EntitySelection["key"] }
  | { readonly type: "toggle-projection"; readonly column: number }
  | {
      readonly type: "data-projection";
      readonly projection: readonly number[];
    }
  | { readonly type: "data-auto-start" }
  | {
      readonly type: "move-projection";
      readonly column: number;
      readonly direction: -1 | 1;
    }
  | { readonly type: "rail"; readonly open: boolean }
  | { readonly type: "inspector"; readonly open: boolean }
  | { readonly type: "query-draft"; readonly draft: ScanPlanV2 }
  | { readonly type: "query-auto-start"; readonly plan: ScanPlanV2 }
  | {
      readonly type: "query-start";
      readonly plan: ScanPlanV2;
      readonly continuation: boolean;
    }
  | {
      readonly type: "query-disclosure";
      readonly disclosure: QueryDisclosure | undefined;
    };

export const PAGE_SIZES: readonly PageSize[] = [25, 50, 100, 200, 500];

export type AutomaticDataLoad =
  | {
      readonly kind: "rows";
      readonly rowGroup: number;
      readonly columns: readonly number[];
      readonly rowOffset: number;
      readonly rowCount: number;
    }
  | {
      readonly kind: "column";
      readonly rowGroup: number;
      readonly column: number;
      readonly rowOffset: number;
      readonly rowCount: number;
    }
  | { readonly kind: "empty" };

export function automaticDataLoad(
  state: AppState,
): AutomaticDataLoad | undefined {
  if (
    state.mode !== "data" ||
    state.source === undefined ||
    state.metadata === undefined ||
    state.dataAutoLoadAttempted ||
    state.loading !== undefined ||
    state.error !== undefined ||
    state.dataResultEpoch === state.dataEpoch &&
    (state.orientation === "rows"
      ? state.rows !== undefined
      : state.page !== undefined)
  ) {
    return undefined;
  }
  const retainedRowGroup = state.orientation === "rows"
    ? state.rows?.rowGroup
    : state.page?.rowGroup;
  const group = state.metadata.rowGroups.find(
    (candidate) => candidate.index === retainedRowGroup,
  ) ?? state.metadata.rowGroups[0];
  if (group === undefined || group.rows <= 0) {
    return { kind: "empty" };
  }
  const retainedOffset = state.orientation === "rows"
    ? Number(state.rows?.offset ?? 0)
    : (state.page?.offset ?? 0);
  const rowOffset = Math.min(Math.max(0, retainedOffset), group.rows - 1);
  const rowCount = Math.min(state.pageSize, group.rows - rowOffset);
  if (state.orientation === "rows") {
    return state.dataProjection.length === 0
      ? { kind: "empty" }
      : {
          kind: "rows",
          rowGroup: group.index,
          columns: state.dataProjection,
          rowOffset,
          rowCount,
        };
  }
  const column = rootSchemaTypes(state.metadata)[0]?.id;
  return column === undefined
    ? { kind: "empty" }
    : {
        kind: "column",
        rowGroup: group.index,
        column: state.page?.column ?? column,
        rowOffset,
        rowCount,
      };
}

export function automaticQueryPlan(
  state: AppState,
): ScanPlanV2 | undefined {
  if (
    state.mode !== "query" ||
    state.source === undefined ||
    state.capabilities?.scan !== "scan-v2" ||
    state.query.dirty ||
    state.query.autoRunAttempted ||
    state.query.submitted !== undefined ||
    state.query.operation !== "idle"
  ) {
    return undefined;
  }
  return {
    ...state.query.draft,
    limit: state.capabilities.defaultScanRows,
  };
}

export const initialState: AppState = {
  revision: 0,
  source: undefined,
  capabilities: undefined,
  metadata: undefined,
  rowGroup: undefined,
  page: undefined,
  rows: undefined,
  filter: undefined,
  mode: "analyze",
  orientation: "rows",
  timestampDisplay: "utc",
  pageSize: 100,
  dataProjection: [],
  dataProjectionEdited: false,
  dataAutoLoadAttempted: false,
  dataEpoch: 0,
  dataResultEpoch: undefined,
  focusedColumn: 0,
  selected: { kind: "file", key: "file" },
  hoveredKey: undefined,
  loading: undefined,
  sourceReloading: false,
  error: undefined,
  railOpen: false,
  inspectorOpen: false,
  query: {
    draft: {
      projection: { kind: "all" },
      orderBy: [],
      offset: "0",
      limit: 20,
    },
    submitted: undefined,
    dirty: false,
    autoRunAttempted: false,
    operation: "idle",
    disclosure: undefined,
    progress: undefined,
    result: undefined,
    error: undefined,
  },
  preferenceOverrides: {
    pageSize: false,
    orientation: false,
    timestampDisplay: false,
  },
  configuredPreferences: {
    pageSize: 100,
    orientation: "rows",
    timestampDisplay: "utc",
  },
};

export function rootSchemaTypes(
  metadata: MetadataResult,
): readonly MetadataResult["schema"][number][] {
  const children = new Set(
    metadata.schema.flatMap((type) => [...type.subtypes]),
  );
  return metadata.schema.filter((type) => !children.has(type.id));
}

function selectInitialColumns(metadata: MetadataResult): readonly number[] {
  return rootSchemaTypes(metadata).slice(0, 6).map((type) => type.id);
}

function metadataHasColumn(metadata: MetadataResult, column: number): boolean {
  return metadata.schema.some((type) => type.id === column);
}

function metadataRowGroup(
  metadata: MetadataResult,
  rowGroup: number,
): MetadataResult["rowGroups"][number] | undefined {
  return metadata.rowGroups.find((candidate) => candidate.index === rowGroup);
}

function selectionRowGroup(selection: EntitySelection): number | undefined {
  switch (selection.kind) {
    case "row-group":
    case "chunk":
    case "pixel":
    case "row":
      return selection.rowGroup;
    case "file":
    case "schema":
      return undefined;
  }
}

function selectionForMetadata(
  selection: EntitySelection,
  metadata: MetadataResult,
): EntitySelection {
  switch (selection.kind) {
    case "file":
      return selection;
    case "schema":
      return metadataHasColumn(metadata, selection.column)
        ? selection
        : { kind: "file", key: "file" };
    case "row-group":
      return metadataRowGroup(metadata, selection.rowGroup) === undefined
        ? { kind: "file", key: "file" }
        : selection;
    case "chunk":
    case "pixel":
      if (metadataRowGroup(metadata, selection.rowGroup) === undefined) {
        return { kind: "file", key: "file" };
      }
      return metadataHasColumn(metadata, selection.column)
        ? selection
        : selectRowGroup(selection.rowGroup);
    case "row": {
      const group = metadataRowGroup(metadata, selection.rowGroup);
      if (group === undefined) {
        return { kind: "file", key: "file" };
      }
      try {
        const localRow = BigInt(selection.localRow);
        return localRow >= 0n && localRow < BigInt(group.rows)
          ? selection
          : selectRowGroup(selection.rowGroup);
      } catch {
        return selectRowGroup(selection.rowGroup);
      }
    }
  }
}

function selectionForRowGroup(
  selection: EntitySelection,
  rowGroup: RowGroupResult,
): EntitySelection {
  if (
    (selection.kind !== "chunk" && selection.kind !== "pixel") ||
    selection.rowGroup !== rowGroup.rowGroup
  ) {
    return selection;
  }
  const column = rowGroup.columns.find(
    (candidate) => candidate.column === selection.column,
  );
  if (column === undefined) {
    return selectRowGroup(selection.rowGroup);
  }
  if (
    selection.kind === "pixel" &&
    !column.chunk.pixels.some((pixel) => pixel.index === selection.pixel)
  ) {
    return selectChunk(selection.rowGroup, selection.column);
  }
  return selection;
}

function sameSource(
  current: SourceSummary | undefined,
  incoming: SourceSummary,
): boolean {
  return current?.uri === incoming.uri &&
    current.size === incoming.size &&
    current.revision === incoming.revision;
}

function sameDataSchema(
  current: MetadataResult | undefined,
  incoming: MetadataResult,
): boolean {
  return current !== undefined &&
    JSON.stringify(current.schema) === JSON.stringify(incoming.schema);
}

export function selectSchema(column: number): EntitySelection {
  return { kind: "schema", key: `schema:${column}`, column };
}

export function selectRowGroup(rowGroup: number): EntitySelection {
  return {
    kind: "row-group",
    key: `row-group:${rowGroup}`,
    rowGroup,
  };
}

export function selectChunk(
  rowGroup: number,
  column: number,
): EntitySelection {
  return {
    kind: "chunk",
    key: `chunk:${rowGroup}:${column}`,
    rowGroup,
    column,
  };
}

export function selectPixel(
  rowGroup: number,
  column: number,
  pixel: number,
): EntitySelection {
  return {
    kind: "pixel",
    key: `pixel:${rowGroup}:${column}:${pixel}`,
    rowGroup,
    column,
    pixel,
  };
}

export function selectRow(
  rowGroup: number,
  localRow: number | string,
): EntitySelection {
  const canonicalRow = String(localRow);
  return {
    kind: "row",
    key: `row:${rowGroup}:${canonicalRow}`,
    rowGroup,
    localRow: canonicalRow,
  };
}

function reduceHost(state: AppState, message: HostMessage): AppState {
  if (message.kind === "preferences") {
    return {
      ...state,
      configuredPreferences: message.preferences,
      pageSize: state.preferenceOverrides.pageSize
        ? state.pageSize
        : message.preferences.pageSize,
      orientation: state.preferenceOverrides.orientation
        ? state.orientation
        : message.preferences.orientation,
      timestampDisplay: state.preferenceOverrides.timestampDisplay
        ? state.timestampDisplay
        : message.preferences.timestampDisplay,
    };
  }
  if (message.revision < state.revision) {
    return state;
  }
  switch (message.kind) {
    case "loading":
      return {
        ...state,
        revision: message.revision,
        loading: message.stage,
        sourceReloading:
          message.stage === "source" ? true : state.sourceReloading,
        error: undefined,
        query:
          message.stage === "source" && state.query.operation === "running"
            ? {
                ...state.query,
                operation: "cancelled",
                progress: undefined,
                error: undefined,
              }
            : state.query,
      };
    case "metadata": {
      const retainedProjection = state.dataProjection.filter(
        (column) => metadataHasColumn(message.metadata, column),
      );
      const initialColumns = selectInitialColumns(message.metadata);
      const schemaMatches = sameDataSchema(state.metadata, message.metadata);
      const acceptedReplacement =
        state.metadata !== undefined &&
        (state.sourceReloading ||
          !sameSource(state.source, message.source));
      const trueDataReplacement =
        state.metadata === undefined ||
        state.source?.uri !== message.source.uri ||
        !schemaMatches;
      const startsDataEpoch =
        state.metadata === undefined || acceptedReplacement || !schemaMatches;
      const initializeSelection =
        state.metadata === undefined || acceptedReplacement;
      const selected = initializeSelection
        ? { kind: "file", key: "file" } as const
        : selectionForMetadata(state.selected, message.metadata);
      const focusedColumn = !trueDataReplacement && metadataHasColumn(
        message.metadata,
        state.focusedColumn,
      )
        ? state.focusedColumn
        : initialColumns[0] ?? 0;
      const preserveData = state.metadata !== undefined && !trueDataReplacement;
      return {
        ...state,
        revision: message.revision,
        source: message.source,
        capabilities: message.capabilities,
        metadata: message.metadata,
        rowGroup: preserveData ? state.rowGroup : undefined,
        page: preserveData ? state.page : undefined,
        rows: preserveData ? state.rows : undefined,
        filter: undefined,
        orientation: trueDataReplacement
          ? state.configuredPreferences.orientation
          : state.orientation,
        timestampDisplay: trueDataReplacement
          ? state.configuredPreferences.timestampDisplay
          : state.timestampDisplay,
        pageSize: trueDataReplacement
          ? state.configuredPreferences.pageSize
          : state.pageSize,
        dataProjection: trueDataReplacement
          ? initialColumns
          : retainedProjection,
        dataProjectionEdited: trueDataReplacement
          ? false
          : state.dataProjectionEdited,
        dataAutoLoadAttempted: startsDataEpoch
          ? false
          : state.dataAutoLoadAttempted,
        dataEpoch: startsDataEpoch ? state.dataEpoch + 1 : state.dataEpoch,
        dataResultEpoch: state.dataResultEpoch,
        preferenceOverrides: trueDataReplacement
          ? {
              pageSize: false,
              orientation: false,
              timestampDisplay: false,
            }
          : state.preferenceOverrides,
        focusedColumn,
        query: acceptedReplacement ? initialState.query : state.query,
        // Worker recreation replays metadata for the same immutable source
        // before row-group/page work. That replay enriches the document model;
        // it is not a new Analyze selection. Only the first accepted source or
        // a real refresh/source replacement owns selection initialization.
        selected,
        hoveredKey: selected.key === state.selected.key
          ? state.hoveredKey
          : undefined,
        loading: undefined,
        sourceReloading: false,
        error: undefined,
      };
    }
    case "rowGroup": {
      const selectedRowGroup = selectionRowGroup(state.selected);
      if (
        selectedRowGroup !== undefined &&
        selectedRowGroup !== message.rowGroup.rowGroup
      ) {
        return state;
      }
      const selected = selectionForRowGroup(state.selected, message.rowGroup);
      return {
        ...state,
        revision: message.revision,
        rowGroup: message.rowGroup,
        selected,
        hoveredKey: selected.key === state.selected.key
          ? state.hoveredKey
          : undefined,
        loading: undefined,
      };
    }
    case "page":
      return {
        ...state,
        revision: message.revision,
        page: message.page,
        dataResultEpoch: state.dataEpoch,
        focusedColumn: message.page.column,
        loading: undefined,
      };
    case "rows":
      return {
        ...state,
        revision: message.revision,
        rows: message.rows,
        dataResultEpoch: state.dataEpoch,
        dataProjection: state.dataProjectionEdited
          ? state.dataProjection
          : message.rows.columns.map((column) => column.id),
        loading: undefined,
      };
    case "filter":
      return {
        ...state,
        revision: message.revision,
        filter: message.filter,
        loading: undefined,
      };
    case "scanProgress":
      if (state.query.operation !== "running") {
        return state;
      }
      return {
        ...state,
        revision: message.revision,
        loading: undefined,
        query: {
          ...state.query,
          progress: {
            snapshot: message.progress,
            elapsedMs: message.elapsedMs,
          },
        },
      };
    case "scan":
      if (state.query.operation !== "running") {
        return state;
      }
      return {
        ...state,
        revision: message.revision,
        loading: undefined,
        query: {
          ...state.query,
          operation: "idle",
          progress: {
            snapshot: {
              ...message.scan.progress,
              phase: "complete",
              currentRowGroup: null,
              retainedCandidates: message.scan.page.returned,
            },
            elapsedMs: message.elapsedMs,
          },
          result: message.scan,
          error: undefined,
        },
      };
    case "scanCancelled":
      if (state.query.operation !== "running") {
        return state.loading === "filter"
          ? { ...state, revision: message.revision, loading: undefined }
          : state;
      }
      return {
        ...state,
        revision: message.revision,
        loading: undefined,
        query: {
          ...state.query,
          operation: "cancelled",
          progress: undefined,
          error: undefined,
        },
      };
    case "empty":
      return {
        ...state,
        revision: message.revision,
        loading: undefined,
      };
    case "error":
      if (state.query.operation === "running") {
        return {
          ...state,
          revision: message.revision,
          loading: undefined,
          sourceReloading: false,
          query: {
            ...state.query,
            operation: "error",
            progress: undefined,
            error: message.error,
          },
        };
      }
      return {
        ...state,
        revision: message.revision,
        loading: undefined,
        sourceReloading: false,
        error: message.error,
      };
  }
}

export function appReducer(state: AppState, action: AppAction): AppState {
  switch (action.type) {
    case "host":
      return reduceHost(state, action.message);
    case "mode":
      return {
        ...state,
        mode: action.mode,
        inspectorOpen: action.mode === "analyze" ? state.inspectorOpen : false,
        railOpen: action.mode === "analyze" ? state.railOpen : false,
      };
    case "orientation":
      return {
        ...state,
        orientation: action.orientation,
        inspectorOpen: false,
        preferenceOverrides: {
          ...state.preferenceOverrides,
          orientation: true,
        },
      };
    case "timestamp":
      return {
        ...state,
        timestampDisplay: action.display,
        preferenceOverrides: {
          ...state.preferenceOverrides,
          timestampDisplay: true,
        },
      };
    case "page-size":
      return {
        ...state,
        pageSize: action.pageSize,
        preferenceOverrides: {
          ...state.preferenceOverrides,
          pageSize: true,
        },
      };
    case "select": {
      const column =
        action.entity.kind === "schema" ||
        action.entity.kind === "chunk" ||
        action.entity.kind === "pixel"
          ? action.entity.column
          : state.focusedColumn;
      return {
        ...state,
        selected: action.entity,
        focusedColumn: column,
        inspectorOpen: action.revealInspector
          ? true
          : state.inspectorOpen,
      };
    }
    case "hover":
      return action.key === undefined
        ? { ...state, hoveredKey: undefined }
        : { ...state, hoveredKey: action.key };
    case "toggle-projection": {
      const hasColumn = state.dataProjection.includes(action.column);
      return {
        ...state,
        inspectorOpen: false,
        dataProjectionEdited: true,
        dataProjection: hasColumn
          ? state.dataProjection.filter((column) => column !== action.column)
          : [...state.dataProjection, action.column],
      };
    }
    case "data-projection":
      return {
        ...state,
        inspectorOpen: false,
        dataProjectionEdited: true,
        dataProjection: [...new Set(action.projection)],
      };
    case "data-auto-start":
      return state.dataAutoLoadAttempted
        ? state
        : { ...state, dataAutoLoadAttempted: true };
    case "move-projection": {
      const index = state.dataProjection.indexOf(action.column);
      const target = index + action.direction;
      if (
        index < 0 ||
        target < 0 ||
        target >= state.dataProjection.length
      ) {
        return state;
      }
      const projection = [...state.dataProjection];
      const adjacent = projection[target];
      if (adjacent === undefined) {
        return state;
      }
      projection[target] = action.column;
      projection[index] = adjacent;
      return {
        ...state,
        dataProjection: projection,
        dataProjectionEdited: true,
        inspectorOpen: false,
      };
    }
    case "rail":
      return { ...state, railOpen: action.open };
    case "inspector":
      return { ...state, inspectorOpen: action.open };
    case "query-draft":
      return {
        ...state,
        query: {
          ...state.query,
          draft: action.draft,
          dirty: true,
        },
      };
    case "query-start":
      return {
        ...state,
        error: undefined,
        query: {
          ...state.query,
          submitted: action.continuation
            ? state.query.submitted
            : action.plan,
          dirty: false,
          autoRunAttempted: true,
          operation: "running",
          progress: undefined,
          error: undefined,
        },
      };
    case "query-auto-start":
      return {
        ...state,
        error: undefined,
        query: {
          ...state.query,
          draft: action.plan,
          submitted: action.plan,
          dirty: false,
          autoRunAttempted: true,
          operation: "running",
          progress: undefined,
          error: undefined,
        },
      };
    case "query-disclosure":
      return {
        ...state,
        query: {
          ...state.query,
          disclosure: action.disclosure,
        },
      };
  }
}
