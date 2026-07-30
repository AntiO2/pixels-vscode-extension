import type {
  CoreCapabilities,
  FilterOperator,
  FilterResult,
  MetadataResult,
  PageResult,
  RowGroupResult,
  RowsResult,
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

export interface QueryDraft {
  readonly column: number;
  readonly operator: FilterOperator;
  readonly literal: string;
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
  readonly projection: readonly number[];
  readonly focusedColumn: number;
  readonly selected: EntitySelection;
  readonly hoveredKey: EntitySelection["key"] | undefined;
  readonly loading: string | undefined;
  readonly error: AppError | undefined;
  readonly railOpen: boolean;
  readonly inspectorOpen: boolean;
  readonly query: QueryDraft;
  readonly preferenceOverrides: {
    readonly pageSize: boolean;
    readonly orientation: boolean;
    readonly timestampDisplay: boolean;
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
  | { readonly type: "select"; readonly entity: EntitySelection }
  | { readonly type: "hover"; readonly key?: EntitySelection["key"] }
  | { readonly type: "toggle-projection"; readonly column: number }
  | {
      readonly type: "move-projection";
      readonly column: number;
      readonly direction: -1 | 1;
    }
  | { readonly type: "rail"; readonly open: boolean }
  | { readonly type: "inspector"; readonly open: boolean }
  | {
      readonly type: "query";
      readonly field: keyof QueryDraft;
      readonly value: string | number;
    };

export const PAGE_SIZES: readonly PageSize[] = [25, 50, 100, 200, 500];

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
  projection: [],
  focusedColumn: 0,
  selected: { kind: "file", key: "file" },
  hoveredKey: undefined,
  loading: undefined,
  error: undefined,
  railOpen: false,
  inspectorOpen: false,
  query: { column: 0, operator: "eq", literal: "" },
  preferenceOverrides: {
    pageSize: false,
    orientation: false,
    timestampDisplay: false,
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
        error: undefined,
      };
    case "metadata": {
      const projection = state.projection.filter(
        (column) => message.metadata.schema[column] !== undefined,
      );
      return {
        ...state,
        revision: message.revision,
        source: message.source,
        capabilities: message.capabilities,
        metadata: message.metadata,
        rowGroup: undefined,
        page: undefined,
        rows: undefined,
        filter: undefined,
        projection:
          projection.length > 0
            ? projection
            : selectInitialColumns(message.metadata),
        focusedColumn:
          message.metadata.schema[state.focusedColumn] === undefined
            ? 0
            : state.focusedColumn,
        query: {
          ...state.query,
          column:
            message.metadata.schema[state.query.column] === undefined
              ? 0
              : state.query.column,
        },
        selected: { kind: "file", key: "file" },
        loading: undefined,
        error: undefined,
      };
    }
    case "rowGroup":
      return {
        ...state,
        revision: message.revision,
        rowGroup: message.rowGroup,
        loading: undefined,
      };
    case "page":
      return {
        ...state,
        revision: message.revision,
        page: message.page,
        focusedColumn: message.page.column,
        loading: undefined,
      };
    case "rows":
      return {
        ...state,
        revision: message.revision,
        rows: message.rows,
        loading: undefined,
      };
    case "filter":
      return {
        ...state,
        revision: message.revision,
        filter: message.filter,
        loading: undefined,
      };
    case "empty":
      return {
        ...state,
        revision: message.revision,
        loading: undefined,
      };
    case "error":
      return {
        ...state,
        revision: message.revision,
        loading: undefined,
        error: message.error,
      };
  }
}

export function appReducer(state: AppState, action: AppAction): AppState {
  switch (action.type) {
    case "host":
      return reduceHost(state, action.message);
    case "mode":
      return { ...state, mode: action.mode };
    case "orientation":
      return {
        ...state,
        orientation: action.orientation,
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
        inspectorOpen: true,
      };
    }
    case "hover":
      return action.key === undefined
        ? { ...state, hoveredKey: undefined }
        : { ...state, hoveredKey: action.key };
    case "toggle-projection": {
      const hasColumn = state.projection.includes(action.column);
      if (hasColumn && state.projection.length === 1) {
        return state;
      }
      return {
        ...state,
        projection: hasColumn
          ? state.projection.filter((column) => column !== action.column)
          : [...state.projection, action.column],
      };
    }
    case "move-projection": {
      const index = state.projection.indexOf(action.column);
      const target = index + action.direction;
      if (index < 0 || target < 0 || target >= state.projection.length) {
        return state;
      }
      const projection = [...state.projection];
      const adjacent = projection[target];
      if (adjacent === undefined) {
        return state;
      }
      projection[target] = action.column;
      projection[index] = adjacent;
      return { ...state, projection };
    }
    case "rail":
      return { ...state, railOpen: action.open };
    case "inspector":
      return { ...state, inspectorOpen: action.open };
    case "query":
      switch (action.field) {
        case "column":
          return typeof action.value === "number"
            ? {
                ...state,
                query: { ...state.query, column: action.value },
              }
            : state;
        case "literal":
          return typeof action.value === "string"
            ? {
                ...state,
                query: { ...state.query, literal: action.value },
              }
            : state;
        case "operator":
          switch (action.value) {
            case "eq":
            case "ne":
            case "lt":
            case "le":
            case "gt":
            case "ge":
            case "isNull":
            case "isNotNull":
            case "contains":
              return {
                ...state,
                query: { ...state.query, operator: action.value },
              };
            default:
              return state;
          }
      }
  }
}
