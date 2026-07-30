import {
  flexRender,
  getCoreRowModel,
  useReactTable,
} from "@tanstack/react-table";
import type {
  ColumnDef,
} from "@tanstack/react-table";
import type {
  ColumnStatistic,
  FilterOperator,
  MetadataResult,
  PageResult,
  PageValue,
  ProjectedColumn,
  ProjectedRow,
  RowGroupColumn,
  SchemaType,
} from "@pixels-inspector/protocol-client";
import {
  useCallback,
  useEffect,
  useMemo,
  useReducer,
} from "react";
import type {
  ButtonHTMLAttributes,
  CSSProperties,
  Dispatch,
  KeyboardEvent,
  ReactNode,
} from "react";

import type {
  VsCodeBridge,
} from "./app/bridge.js";
import {
  PAGE_SIZES,
  appReducer,
  initialState,
  rootSchemaTypes,
  selectChunk,
  selectPixel,
  selectRow,
  selectRowGroup,
  selectSchema,
} from "./app/model.js";
import type {
  AppAction,
  AppState,
  EntitySelection,
  PageSize,
  WorkspaceMode,
} from "./app/model.js";
import {
  Icon,
} from "./components/Icon.js";
import type {
  IconName,
} from "./components/Icon.js";
import {
  compressionName,
  copyPageValues,
  encodingName,
  formatBytes,
  formatDisplayValue,
  formatPageValue,
} from "./value-format.js";
import {
  deriveRowGroupBands,
  pixelTickPosition,
} from "./visualization/geometry.js";

interface AppProps {
  readonly bridge: VsCodeBridge;
  readonly subscribe: (dispatch: Dispatch<AppAction>) => () => void;
}

interface RequestSelection {
  readonly rowGroup: number;
  readonly column: number;
  readonly rowOffset: number;
  readonly rowCount: number;
}

interface RequestRows {
  readonly rowGroup: number;
  readonly columns: readonly number[];
  readonly rowOffset: number;
  readonly rowCount: number;
}

function kindName(state: AppState, kind: number): string {
  return state.capabilities?.types[kind]?.name ?? `KIND_${String(kind)}`;
}

function typeLabel(state: AppState, type: SchemaType): string {
  const details = [
    type.maximumLength === undefined
      ? undefined
      : String(type.maximumLength),
    type.precision === undefined
      ? undefined
      : `${String(type.precision)},${String(type.scale ?? 0)}`,
    type.dimension === undefined
      ? undefined
      : String(type.dimension),
  ].filter((part): part is string => part !== undefined);
  const kind = kindName(state, type.kind);
  return details.length > 0 ? `${kind}(${details.join(",")})` : kind;
}

function PropertyList({
  entries,
}: {
  readonly entries: readonly (readonly [string, ReactNode])[];
}): ReactNode {
  return (
    <dl className="properties">
      {entries.map(([label, value]) => (
        <div className="property" key={label}>
          <dt>{label}</dt>
          <dd>{value}</dd>
        </div>
      ))}
    </dl>
  );
}

function ActionButton({
  children,
  icon,
  className = "",
  ...props
}: {
  readonly children: ReactNode;
  readonly icon?: IconName;
  readonly className?: string;
} & Omit<ButtonHTMLAttributes<HTMLButtonElement>, "className">): ReactNode {
  return (
    <button
      type="button"
      className={`action-button ${className}`}
      {...props}
    >
      {icon === undefined ? null : <Icon name={icon} />}
      <span>{children}</span>
    </button>
  );
}

function EntityButton({
  entity,
  state,
  dispatch,
  children,
  className = "",
  onSelect,
}: {
  readonly entity: EntitySelection;
  readonly state: AppState;
  readonly dispatch: Dispatch<AppAction>;
  readonly children: ReactNode;
  readonly className?: string;
  readonly onSelect?: () => void;
}): ReactNode {
  const active =
    state.selected.key === entity.key || state.hoveredKey === entity.key;
  return (
    <button
      type="button"
      className={`entity ${active ? "is-active" : ""} ${className}`}
      aria-pressed={state.selected.key === entity.key}
      onClick={() => {
        dispatch({ type: "select", entity });
        onSelect?.();
      }}
      onPointerEnter={() => {
        dispatch({ type: "hover", key: entity.key });
      }}
      onPointerLeave={() => {
        dispatch({ type: "hover" });
      }}
      onFocus={() => {
        dispatch({ type: "hover", key: entity.key });
      }}
      onBlur={() => {
        dispatch({ type: "hover" });
      }}
    >
      {children}
    </button>
  );
}

function ModeSwitch({
  mode,
  dispatch,
}: {
  readonly mode: WorkspaceMode;
  readonly dispatch: Dispatch<AppAction>;
}): ReactNode {
  const modes = [
    ["analyze", "Analyze", "analyze"],
    ["data", "Data", "data"],
    ["query", "Query", "query"],
  ] as const;
  return (
    <nav className="mode-switch" aria-label="Workspace mode">
      {modes.map(([value, label, icon]) => (
        <button
          type="button"
          key={value}
          className={mode === value ? "is-current" : ""}
          aria-current={mode === value ? "page" : undefined}
          onClick={() => {
            dispatch({ type: "mode", mode: value });
          }}
        >
          <Icon name={icon} />
          <span>{label}</span>
        </button>
      ))}
    </nav>
  );
}

function InstrumentHeader({
  state,
  bridge,
  dispatch,
}: {
  readonly state: AppState;
  readonly bridge: VsCodeBridge;
  readonly dispatch: Dispatch<AppAction>;
}): ReactNode {
  const filename =
    state.source?.uri.split(/[\\/]/u).at(-1) ?? "Pixels Inspector";
  return (
    <header className="instrument-header">
      <div className="identity">
        <Icon name="file" />
        <div>
          <h1>{filename}</h1>
          <p>
            {state.metadata === undefined
              ? "Portable Pixels Core"
              : `${String(state.metadata.rows)} rows · ${String(state.metadata.schemaCount)} columns · ${String(state.metadata.rowGroupCount)} row groups`}
          </p>
        </div>
      </div>
      <ModeSwitch mode={state.mode} dispatch={dispatch} />
      <div className="header-actions">
        <ActionButton
          icon="menu"
          className="mobile-only"
          aria-label="Open context rail"
          onClick={() => {
            dispatch({ type: "rail", open: true });
          }}
        >
          Context
        </ActionButton>
        <ActionButton
          icon="inspector"
          className="mobile-only"
          aria-label="Open inspector"
          onClick={() => {
            dispatch({ type: "inspector", open: true });
          }}
        >
          Inspector
        </ActionButton>
        <ActionButton
          icon="refresh"
          onClick={() => {
            bridge.postMessage({ kind: "refresh" });
          }}
        >
          Refresh
        </ActionButton>
      </div>
    </header>
  );
}

function Breadcrumb({
  state,
  dispatch,
}: {
  readonly state: AppState;
  readonly dispatch: Dispatch<AppAction>;
}): ReactNode {
  const selected = state.selected;
  const parts: {
    readonly label: string;
    readonly entity: EntitySelection;
  }[] = [{ label: "File", entity: { kind: "file", key: "file" } }];
  if (
    selected.kind === "row-group" ||
    selected.kind === "chunk" ||
    selected.kind === "pixel" ||
    selected.kind === "row"
  ) {
    parts.push({
      label: `Row group ${String(selected.rowGroup)}`,
      entity: selectRowGroup(selected.rowGroup),
    });
  }
  if (selected.kind === "chunk" || selected.kind === "pixel") {
    const name = state.metadata?.schema[selected.column]?.name;
    parts.push({
      label: name === undefined ? "Column chunk" : `${name} chunk`,
      entity: selectChunk(selected.rowGroup, selected.column),
    });
  }
  if (selected.kind === "pixel") {
    parts.push({
      label: `Pixel segment ${String(selected.pixel)}`,
      entity: selected,
    });
  } else if (selected.kind === "schema") {
    parts.push({ label: `Schema · ${String(selected.column)}`, entity: selected });
  } else if (selected.kind === "row") {
    parts.push({ label: `Row ${selected.localRow}`, entity: selected });
  }
  return (
    <nav className="breadcrumb" aria-label="Storage hierarchy">
      {parts.map((part, index) => (
        <span key={part.entity.key}>
          {index > 0 ? <span className="separator">/</span> : null}
          <button
            type="button"
            aria-current={index === parts.length - 1 ? "location" : undefined}
            onClick={() => {
              dispatch({ type: "select", entity: part.entity });
            }}
          >
            {part.label}
          </button>
        </span>
      ))}
    </nav>
  );
}

function schemaRows(metadata: MetadataResult): readonly {
  readonly type: SchemaType;
  readonly depth: number;
}[] {
  const byId = new Map(metadata.schema.map((type) => [type.id, type]));
  const children = new Set(metadata.schema.flatMap((type) => [...type.subtypes]));
  const roots = metadata.schema.filter((type) => !children.has(type.id));
  const rows: { type: SchemaType; depth: number }[] = [];
  const visited = new Set<number>();
  const visit = (type: SchemaType, depth: number): void => {
    if (visited.has(type.id)) {
      return;
    }
    visited.add(type.id);
    rows.push({ type, depth });
    for (const childId of type.subtypes) {
      const child = byId.get(childId);
      if (child !== undefined) {
        visit(child, depth + 1);
      }
    }
  };
  roots.forEach((type) => {
    visit(type, 0);
  });
  metadata.schema.forEach((type) => {
    visit(type, 0);
  });
  return rows;
}

function ContextRail({
  state,
  dispatch,
  request,
}: {
  readonly state: AppState;
  readonly dispatch: Dispatch<AppAction>;
  readonly request: (selection: RequestSelection) => void;
}): ReactNode {
  const metadata = state.metadata;
  return (
    <>
      {state.railOpen ? (
        <button
          type="button"
          className="drawer-scrim"
          aria-label="Close context rail"
          onClick={() => {
            dispatch({ type: "rail", open: false });
          }}
        />
      ) : null}
      <aside
        className={`context-rail ${state.railOpen ? "is-open" : ""}`}
        aria-label="File context"
      >
        <div className="panel-heading">
          <h2>Context</h2>
          <ActionButton
            icon="close"
            className="icon-only mobile-only"
            aria-label="Close context rail"
            onClick={() => {
              dispatch({ type: "rail", open: false });
            }}
          >
            Close
          </ActionButton>
        </div>
        {metadata === undefined ? (
          <EmptyState>Schema is not available yet.</EmptyState>
        ) : (
          <>
            <section className="rail-section">
              <h3>
                <Icon name="schema" /> Schema
              </h3>
              <div className="schema-tree" aria-label="Schema">
                {schemaRows(metadata).map(({ type, depth }) => (
                  <EntityButton
                    key={type.id}
                    entity={selectSchema(type.id)}
                    state={state}
                    dispatch={dispatch}
                    className="schema-entry"
                  >
                    <span
                      className="schema-indent"
                      style={{ "--schema-depth": depth } as CSSProperties}
                    />
                    <span className="schema-entry-name">{type.name}</span>
                    <span className="schema-entry-type">
                      {typeLabel(state, type)}
                    </span>
                  </EntityButton>
                ))}
              </div>
            </section>
            <section className="rail-section">
              <h3>
                <Icon name="rowGroup" /> Row groups
              </h3>
              <div className="row-group-list">
                {metadata.rowGroups.map((group) => (
                  <EntityButton
                    key={group.index}
                    entity={selectRowGroup(group.index)}
                    state={state}
                    dispatch={dispatch}
                    onSelect={() => {
                      if (group.rows > 0 && metadata.schema.length > 0) {
                        request({
                          rowGroup: group.index,
                          column: state.focusedColumn,
                          rowOffset: 0,
                          rowCount: Math.min(group.rows, state.pageSize),
                        });
                      }
                    }}
                  >
                    <span>RG {String(group.index)}</span>
                    <span className="numeric muted">
                      {String(group.rows)} rows
                    </span>
                  </EntityButton>
                ))}
              </div>
            </section>
            <section className="rail-section projection-section">
              <h3>Active projection</h3>
              <ol>
                {state.projection.map((column, index) => {
                  const type = metadata.schema[column];
                  if (type === undefined) {
                    return null;
                  }
                  return (
                    <li key={column}>
                      <button
                        type="button"
                        onClick={() => {
                          dispatch({
                            type: "select",
                            entity: selectSchema(column),
                          });
                        }}
                      >
                        {type.name}
                      </button>
                      <span>
                        <button
                          type="button"
                          aria-label={`Move ${type.name} up`}
                          disabled={index === 0}
                          onClick={() => {
                            dispatch({
                              type: "move-projection",
                              column,
                              direction: -1,
                            });
                          }}
                        >
                          <Icon name="up" />
                        </button>
                        <button
                          type="button"
                          aria-label={`Move ${type.name} down`}
                          disabled={index === state.projection.length - 1}
                          onClick={() => {
                            dispatch({
                              type: "move-projection",
                              column,
                              direction: 1,
                            });
                          }}
                        >
                          <Icon name="down" />
                        </button>
                      </span>
                    </li>
                  );
                })}
              </ol>
            </section>
          </>
        )}
      </aside>
    </>
  );
}

function EmptyState({
  children,
}: {
  readonly children: ReactNode;
}): ReactNode {
  return <div className="empty-state">{children}</div>;
}

function StatusBanner({
  state,
}: {
  readonly state: AppState;
}): ReactNode {
  if (state.error !== undefined) {
    return (
      <div className="status-banner error" role="alert">
        <Icon name="warning" />
        <div>
          <strong>{state.error.code}</strong>
          <span>{state.error.message}</span>
        </div>
      </div>
    );
  }
  if (state.loading !== undefined) {
    return (
      <div className="status-banner loading" role="status">
        <span className="activity-indicator" aria-hidden="true" />
        <span>Loading {state.loading}…</span>
      </div>
    );
  }
  return null;
}

function FileSummary({
  state,
}: {
  readonly state: AppState;
}): ReactNode {
  const metadata = state.metadata;
  const source = state.source;
  if (metadata === undefined || source === undefined) {
    return null;
  }
  const compression = compressionName(metadata.postscript.compression);
  return (
    <section className="summary-strip" aria-label="File summary">
      <PropertyList
        entries={[
          ["Source", source.uri],
          ["Source revision", source.revision],
          ["File size", `${formatBytes(source.size)} · ${source.size} bytes`],
          ["Format", `${metadata.magic} v${String(metadata.version)}`],
          ["Pixel stride", `${String(metadata.pixelStride)} rows`],
          [
            "Compression metadata",
            <span key="compression">
              {compression}{" "}
              <span className="annotation">inactive in Pixels V1</span>
            </span>,
          ],
          [
            "Writer timezone",
            metadata.postscript.writerTimezone || "Not recorded",
          ],
        ]}
      />
    </section>
  );
}

function FileMap({
  state,
  dispatch,
  request,
}: {
  readonly state: AppState;
  readonly dispatch: Dispatch<AppAction>;
  readonly request: (selection: RequestSelection) => void;
}): ReactNode {
  const metadata = state.metadata;
  if (metadata === undefined || metadata.rowGroups.length === 0) {
    return <EmptyState>No row groups are present in this file.</EmptyState>;
  }
  const bands = deriveRowGroupBands(metadata.rowGroups);
  const select = (index: number): void => {
    const group = metadata.rowGroups[index];
    if (group === undefined) {
      return;
    }
    dispatch({ type: "select", entity: selectRowGroup(group.index) });
    if (group.rows > 0 && metadata.schema.length > 0) {
      request({
        rowGroup: group.index,
        column: state.focusedColumn,
        rowOffset: 0,
        rowCount: Math.min(group.rows, state.pageSize),
      });
    }
  };
  const onKey = (event: KeyboardEvent<SVGGElement>, index: number): void => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      select(index);
    }
  };
  return (
    <section className="analysis-section file-map-section">
      <div className="section-heading">
        <div>
          <h2>File storage map</h2>
          <p>
            Row-group width represents data bytes. Footer positions are listed
            as exact offsets below.
          </p>
        </div>
        <span className="source-badge">Source-backed</span>
      </div>
      <svg
        className="file-map"
        viewBox="0 0 1000 132"
        role="img"
        aria-labelledby="file-map-title file-map-description"
      >
        <title id="file-map-title">Row groups by data size</title>
        <desc id="file-map-description">
          A proportional map of row-group data lengths. Each row group is
          keyboard selectable; exact values follow in a table.
        </desc>
        <line className="map-axis" x1="20" y1="102" x2="980" y2="102" />
        {bands.map((band) => {
          const group = metadata.rowGroups[band.index];
          if (group === undefined) {
            return null;
          }
          const x = 20 + band.start * 960;
          const width = Math.max(2, band.size * 960 - 2);
          const entity = selectRowGroup(group.index);
          const active =
            state.selected.key === entity.key || state.hoveredKey === entity.key;
          return (
            <g
              key={group.index}
              role="button"
              tabIndex={0}
              aria-label={`Row group ${String(group.index)}, ${String(group.rows)} rows, ${String(group.dataLength)} data bytes`}
              aria-pressed={state.selected.key === entity.key}
              className={active ? "is-active" : ""}
              onClick={() => {
                select(group.index);
              }}
              onKeyDown={(event) => {
                onKey(event, group.index);
              }}
              onPointerEnter={() => {
                dispatch({ type: "hover", key: entity.key });
              }}
              onPointerLeave={() => {
                dispatch({ type: "hover" });
              }}
              onFocus={() => {
                dispatch({ type: "hover", key: entity.key });
              }}
              onBlur={() => {
                dispatch({ type: "hover" });
              }}
            >
              <rect x={x} y="32" width={width} height="58" rx="1" />
              {width >= 50 ? (
                <text x={x + 9} y="56">
                  RG {String(group.index)}
                </text>
              ) : null}
              {width >= 90 ? (
                <text className="map-value" x={x + 9} y="76">
                  {String(group.rows)} rows
                </text>
              ) : null}
              <line
                className="footer-marker"
                x1={x + width}
                y1="94"
                x2={x + width}
                y2="110"
              />
            </g>
          );
        })}
      </svg>
      <details className="exact-data">
        <summary>Exact row-group offsets and lengths</summary>
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Row group</th>
                <th>Rows</th>
                <th>Data bytes</th>
                <th>Footer offset</th>
                <th>Footer bytes</th>
              </tr>
            </thead>
            <tbody>
              {metadata.rowGroups.map((group) => (
                <tr key={group.index}>
                  <td>RG {String(group.index)}</td>
                  <td className="numeric">{String(group.rows)}</td>
                  <td className="numeric">{String(group.dataLength)}</td>
                  <td className="numeric">{group.footerOffset}</td>
                  <td className="numeric">{String(group.footerLength)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </section>
  );
}

function RowGroupMatrix({
  state,
  dispatch,
}: {
  readonly state: AppState;
  readonly dispatch: Dispatch<AppAction>;
}): ReactNode {
  const metadata = state.metadata;
  const rowGroup = state.rowGroup;
  if (metadata === undefined || rowGroup === undefined) {
    return (
      <section className="analysis-section">
        <h2>Column chunks</h2>
        <EmptyState>Select a row group to inspect its column chunks.</EmptyState>
      </section>
    );
  }
  return (
    <section className="analysis-section">
      <div className="section-heading">
        <div>
          <h2>Row group {String(rowGroup.rowGroup)} · column chunks</h2>
          <p>
            Chunk lengths are exact. Encoding and null layout remain visible
            without treating encoding as payload compression.
          </p>
        </div>
      </div>
      <div className="chunk-matrix" role="list" aria-label="Column chunks">
        {rowGroup.columns.map((column) => {
          const type = metadata.schema[column.column];
          const entity = selectChunk(rowGroup.rowGroup, column.column);
          return (
            <EntityButton
              key={column.column}
              entity={entity}
              state={state}
              dispatch={dispatch}
              className="chunk-cell"
            >
              <span className="chunk-name">
                {type?.name ?? `Column ${String(column.column)}`}
              </span>
              <span className="chunk-kind">
                {type === undefined ? "Unknown" : typeLabel(state, type)}
              </span>
              <span className="chunk-measure numeric">
                {String(column.chunk.length)} B
              </span>
              <span className="chunk-encoding">
                {encodingName(
                  column.encoding.kind,
                  state.capabilities?.encodings,
                )}
              </span>
              <span className="chunk-pixels">
                {String(column.chunk.pixels.length)} pixel segments
              </span>
            </EntityButton>
          );
        })}
      </div>
    </section>
  );
}

function ChunkDetail({
  state,
  dispatch,
}: {
  readonly state: AppState;
  readonly dispatch: Dispatch<AppAction>;
}): ReactNode {
  const metadata = state.metadata;
  const rowGroup = state.rowGroup;
  const selectedColumn =
    state.selected.kind === "chunk" || state.selected.kind === "pixel"
      ? state.selected.column
      : state.focusedColumn;
  const column = rowGroup?.columns.find(
    (candidate) => candidate.column === selectedColumn,
  );
  if (
    metadata === undefined ||
    rowGroup === undefined ||
    column === undefined
  ) {
    return null;
  }
  const groupRows = metadata.rowGroups[rowGroup.rowGroup]?.rows ?? 0;
  const type = metadata.schema[column.column];
  return (
    <section className="analysis-section pixel-detail">
      <div className="section-heading">
        <div>
          <h2>
            {type?.name ?? `Column ${String(column.column)}`} · pixel segments
          </h2>
          <p>
            Ticks show logical row positions only. Pixel byte widths are not
            available and are intentionally not inferred.
          </p>
        </div>
      </div>
      <svg
        viewBox="0 0 1000 116"
        className="pixel-map"
        role="img"
        aria-labelledby="pixel-map-title pixel-map-description"
      >
        <title id="pixel-map-title">
          Pixel positions for {type?.name ?? "selected column"}
        </title>
        <desc id="pixel-map-description">
          Selectable ticks positioned by the first logical row in each pixel
          segment. This chart does not encode per-pixel byte length.
        </desc>
        <line className="pixel-axis" x1="30" y1="68" x2="970" y2="68" />
        <text x="30" y="96">row 0</text>
        <text textAnchor="end" x="970" y="96">
          row {String(groupRows)}
        </text>
        {column.chunk.pixels.map((pixel) => {
          const x = 30 + pixelTickPosition(pixel.position, groupRows) * 940;
          const entity = selectPixel(
            rowGroup.rowGroup,
            column.column,
            pixel.index,
          );
          const active =
            state.selected.key === entity.key || state.hoveredKey === entity.key;
          const activate = (): void => {
            dispatch({ type: "select", entity });
          };
          return (
            <g
              key={pixel.index}
              role="button"
              tabIndex={0}
              aria-label={`Pixel segment ${String(pixel.index)}, logical row position ${String(pixel.position)}`}
              aria-pressed={state.selected.key === entity.key}
              className={active ? "is-active" : ""}
              onClick={activate}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  activate();
                }
              }}
              onPointerEnter={() => {
                dispatch({ type: "hover", key: entity.key });
              }}
              onPointerLeave={() => {
                dispatch({ type: "hover" });
              }}
              onFocus={() => {
                dispatch({ type: "hover", key: entity.key });
              }}
              onBlur={() => {
                dispatch({ type: "hover" });
              }}
            >
              <line x1={x} y1="35" x2={x} y2="76" />
              <circle cx={x} cy="35" r="5" />
              <text textAnchor="middle" x={x} y="24">
                {String(pixel.index)}
              </text>
            </g>
          );
        })}
      </svg>
      <div className="pixel-list" aria-label="Exact pixel positions">
        {column.chunk.pixels.map((pixel) => (
          <EntityButton
            key={pixel.index}
            entity={selectPixel(
              rowGroup.rowGroup,
              column.column,
              pixel.index,
            )}
            state={state}
            dispatch={dispatch}
          >
            <span>Pixel segment {String(pixel.index)}</span>
            <span className="numeric">position {String(pixel.position)}</span>
          </EntityButton>
        ))}
      </div>
    </section>
  );
}

function AnalyzeWorkspace({
  state,
  dispatch,
  request,
}: {
  readonly state: AppState;
  readonly dispatch: Dispatch<AppAction>;
  readonly request: (selection: RequestSelection) => void;
}): ReactNode {
  return (
    <div className="analyze-workspace">
      <FileSummary state={state} />
      <FileMap state={state} dispatch={dispatch} request={request} />
      <RowGroupMatrix state={state} dispatch={dispatch} />
      <ChunkDetail state={state} dispatch={dispatch} />
    </div>
  );
}

interface TableRow {
  readonly identity: string;
  readonly rowGroup: number;
  readonly localRow: number;
  readonly value: PageValue;
}

function DataGrid({
  state,
  page,
  dispatch,
}: {
  readonly state: AppState;
  readonly page: PageResult;
  readonly dispatch: Dispatch<AppAction>;
}): ReactNode {
  const metadata = state.metadata;
  const type = metadata?.schema[page.column];
  const rows = useMemo(
    () =>
      page.values.map((value, index): TableRow => {
        const localRow = page.offset + index;
        return {
          identity: `row:${String(page.rowGroup)}:${String(localRow)}`,
          rowGroup: page.rowGroup,
          localRow,
          value,
        };
      }),
    [page],
  );
  const columns = useMemo<ColumnDef<TableRow>[]>(
    () => [
      {
        id: "row",
        header: "Row",
        cell: ({ row }) => (
          <span className="numeric">
            RG {String(row.original.rowGroup)} · {String(row.original.localRow)}
          </span>
        ),
      },
      {
        id: "value",
        header: `${type?.name ?? "Value"} · ${
          type === undefined ? "Unknown" : typeLabel(state, type)
        }`,
        cell: ({ row }) => {
          const raw = formatPageValue(row.original.value);
          const display = formatDisplayValue(
            row.original.value,
            type,
            state.timestampDisplay,
          );
          return (
            <span
              className={row.original.value === null ? "null-value" : "value"}
              title={raw === display ? undefined : `Raw: ${raw}`}
            >
              {display}
            </span>
          );
        },
      },
    ],
    [state, type],
  );
  const table = useReactTable({
    data: rows,
    columns,
    getCoreRowModel: getCoreRowModel(),
    getRowId: (row) => row.identity,
  });
  return (
    <div className="data-table-wrap">
      <table
        className="data-table"
        role="grid"
        aria-label="Column data page"
      >
        <thead>
          {table.getHeaderGroups().map((headerGroup) => (
            <tr key={headerGroup.id}>
              {headerGroup.headers.map((header) => (
                <th key={header.id}>
                  {header.isPlaceholder
                    ? null
                    : flexRender(
                        header.column.columnDef.header,
                        header.getContext(),
                      )}
                </th>
              ))}
            </tr>
          ))}
        </thead>
        <tbody>
          {table.getRowModel().rows.map((row) => {
            const entity = selectRow(
              row.original.rowGroup,
              row.original.localRow,
            );
            return (
              <tr
                key={row.id}
                tabIndex={0}
                className={
                  state.selected.key === entity.key ? "is-selected" : ""
                }
                aria-selected={state.selected.key === entity.key}
                onClick={() => {
                  dispatch({ type: "select", entity });
                }}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    dispatch({ type: "select", entity });
                  }
                }}
              >
                {row.getVisibleCells().map((cell) => (
                  <td key={cell.id}>
                    {flexRender(
                      cell.column.columnDef.cell,
                      cell.getContext(),
                    )}
                  </td>
                ))}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function ProjectedGrid({
  state,
  columns,
  rows,
  dispatch,
}: {
  readonly state: AppState;
  readonly columns: readonly ProjectedColumn[];
  readonly rows: readonly ProjectedRow[];
  readonly dispatch: Dispatch<AppAction>;
}): ReactNode {
  const tableRows = useMemo(() => [...rows], [rows]);
  const tableColumns = useMemo<ColumnDef<ProjectedRow>[]>(() => {
    const identityColumn: ColumnDef<ProjectedRow> = {
      id: "row",
      header: "Absolute row",
      cell: ({ row }) => (
        <span className="numeric">
          {row.original.absoluteRow}
          <span className="row-context">
            RG {String(row.original.rowGroup)} · {row.original.localRow}
          </span>
        </span>
      ),
    };
    const valueColumns = columns.map(
      (column, index): ColumnDef<ProjectedRow> => {
        const schema = state.metadata?.schema[column.id];
        return {
          id: `column:${String(column.id)}`,
          header: `${column.name} · ${
            schema === undefined
              ? kindName(state, column.kind)
              : typeLabel(state, schema)
          }`,
          cell: ({ row }) => {
            const value = row.original.values[index];
            if (value === undefined) {
              return null;
            }
            const raw = formatPageValue(value);
            const display = formatDisplayValue(
              value,
              schema,
              state.timestampDisplay,
            );
            return (
              <span
                className={value === null ? "null-value" : "value"}
                title={raw === display ? undefined : `Raw: ${raw}`}
              >
                {display}
              </span>
            );
          },
        };
      },
    );
    return [identityColumn, ...valueColumns];
  }, [columns, state]);
  const table = useReactTable({
    data: tableRows,
    columns: tableColumns,
    getCoreRowModel: getCoreRowModel(),
    getRowId: (row) => `row:${String(row.rowGroup)}:${row.localRow}`,
  });
  return (
    <div className="projected-result">
      <div className="result-actions">
        <span>
          {String(rows.length)} rows · {String(columns.length)} columns
        </span>
        <ActionButton
          icon="copy"
          disabled={rows.length === 0}
          onClick={() => {
            const text = rows
              .map((row) => row.values.map(formatPageValue).join("\t"))
              .join("\n");
            void navigator.clipboard.writeText(text);
          }}
        >
          Copy page as TSV
        </ActionButton>
      </div>
      <div className="data-table-wrap">
        <table
          className="data-table projected-table"
          role="grid"
          aria-label="Projected row page"
        >
          <thead>
            {table.getHeaderGroups().map((headerGroup) => (
              <tr key={headerGroup.id}>
                {headerGroup.headers.map((header) => (
                  <th key={header.id}>
                    {header.isPlaceholder
                      ? null
                      : flexRender(
                          header.column.columnDef.header,
                          header.getContext(),
                        )}
                  </th>
                ))}
              </tr>
            ))}
          </thead>
          <tbody>
            {table.getRowModel().rows.map((row) => {
              const entity = selectRow(
                row.original.rowGroup,
                row.original.localRow,
              );
              return (
                <tr
                  key={row.id}
                  tabIndex={0}
                  className={
                    state.selected.key === entity.key ? "is-selected" : ""
                  }
                  aria-selected={state.selected.key === entity.key}
                  onClick={() => {
                    dispatch({ type: "select", entity });
                  }}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      dispatch({ type: "select", entity });
                    }
                  }}
                >
                  {row.getVisibleCells().map((cell) => (
                    <td key={cell.id}>
                      {flexRender(
                        cell.column.columnDef.cell,
                        cell.getContext(),
                      )}
                    </td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function ProjectionChooser({
  state,
  dispatch,
}: {
  readonly state: AppState;
  readonly dispatch: Dispatch<AppAction>;
}): ReactNode {
  const metadata = state.metadata;
  if (metadata === undefined) {
    return null;
  }
  return (
    <details className="projection-chooser">
      <summary>
        Projection · {String(state.projection.length)} columns
      </summary>
      <div className="projection-options">
        {rootSchemaTypes(metadata).map((type) => (
          <label key={type.id}>
            <input
              type="checkbox"
              checked={state.projection.includes(type.id)}
              onChange={() => {
                dispatch({ type: "toggle-projection", column: type.id });
              }}
            />
            <span>{type.name}</span>
            <span className="muted">{typeLabel(state, type)}</span>
          </label>
        ))}
      </div>
    </details>
  );
}

function DataToolbar({
  state,
  dispatch,
  request,
  requestRows,
}: {
  readonly state: AppState;
  readonly dispatch: Dispatch<AppAction>;
  readonly request: (selection: RequestSelection) => void;
  readonly requestRows: (selection: RequestRows) => void;
}): ReactNode {
  const metadata = state.metadata;
  const page = state.page;
  if (metadata === undefined) {
    return null;
  }
  const rowGroup =
    (state.orientation === "rows" ? state.rows?.rowGroup : page?.rowGroup) ??
    state.rowGroup?.rowGroup ??
    0;
  const column = page?.column ?? state.focusedColumn;
  const offset =
    state.orientation === "rows"
      ? Number(state.rows?.offset ?? 0)
      : (page?.offset ?? 0);
  const currentCount =
    state.orientation === "rows"
      ? (state.rows?.count ?? state.pageSize)
      : (page?.count ?? state.pageSize);
  const groupRows = metadata.rowGroups[rowGroup]?.rows ?? 0;
  const load = (
    nextOffset: number,
    nextRowGroup = rowGroup,
    nextColumn = column,
  ): void => {
    const available = metadata.rowGroups[nextRowGroup]?.rows ?? 0;
    if (available <= 0) {
      return;
    }
    const boundedOffset = Math.min(Math.max(0, nextOffset), available - 1);
    const rowCount = Math.min(
      state.pageSize,
      available - boundedOffset,
    );
    if (state.orientation === "rows") {
      requestRows({
        rowGroup: nextRowGroup,
        columns: state.projection,
        rowOffset: boundedOffset,
        rowCount,
      });
    } else {
      request({
        rowGroup: nextRowGroup,
        column: nextColumn,
        rowOffset: boundedOffset,
        rowCount,
      });
    }
  };
  return (
    <div className="data-toolbar">
      <div className="segmented" aria-label="Data orientation">
        {(["rows", "column"] as const).map((orientation) => (
          <button
            type="button"
            key={orientation}
            aria-pressed={state.orientation === orientation}
            onClick={() => {
              dispatch({ type: "orientation", orientation });
              const available = metadata.rowGroups[rowGroup]?.rows ?? 0;
              if (available > 0) {
                if (orientation === "rows") {
                  requestRows({
                    rowGroup,
                    columns: state.projection,
                    rowOffset: offset,
                    rowCount: Math.min(state.pageSize, available - offset),
                  });
                } else {
                  request({
                    rowGroup,
                    column,
                    rowOffset: offset,
                    rowCount: Math.min(state.pageSize, available - offset),
                  });
                }
              }
            }}
          >
            {orientation === "rows" ? "Rows" : "Column"}
          </button>
        ))}
      </div>
      <label>
        <span>Row group</span>
        <select
          value={rowGroup}
          onChange={(event) => {
            load(0, Number(event.currentTarget.value), column);
          }}
        >
          {metadata.rowGroups.map((group) => (
            <option value={group.index} key={group.index}>
              RG {String(group.index)}
            </option>
          ))}
        </select>
      </label>
      <label>
        <span>Focused column</span>
        <select
          value={column}
          onChange={(event) => {
            const nextColumn = Number(event.currentTarget.value);
            dispatch({
              type: "select",
              entity: selectSchema(nextColumn),
            });
            load(offset, rowGroup, nextColumn);
          }}
        >
          {metadata.schema.map((type) => (
            <option value={type.id} key={type.id}>
              {type.name} · {typeLabel(state, type)}
            </option>
          ))}
        </select>
      </label>
      <label>
        <span>Rows per page</span>
        <select
          value={state.pageSize}
          onChange={(event) => {
            const pageSize = Number(event.currentTarget.value) as PageSize;
            if (PAGE_SIZES.includes(pageSize)) {
              dispatch({ type: "page-size", pageSize });
            }
          }}
        >
          {PAGE_SIZES.map((size) => (
            <option key={size} value={size}>
              {String(size)}
            </option>
          ))}
        </select>
      </label>
      <label>
        <span>Timestamp display</span>
        <select
          value={state.timestampDisplay}
          onChange={(event) => {
            const display = event.currentTarget.value;
            if (display === "utc" || display === "raw" || display === "local") {
              dispatch({ type: "timestamp", display });
            }
          }}
        >
          <option value="utc">UTC</option>
          <option value="raw">Raw microseconds</option>
          <option value="local">Local time</option>
        </select>
      </label>
      <div className="toolbar-spacer" />
      <div className="paging-controls">
        <ActionButton
          icon="refresh"
          onClick={() => {
            load(offset);
          }}
        >
          Load page
        </ActionButton>
        <ActionButton
          icon="previous"
          disabled={offset <= 0}
          onClick={() => {
            load(Math.max(0, offset - state.pageSize));
          }}
        >
          Previous
        </ActionButton>
        <span className="numeric">
          {groupRows === 0
            ? "No rows"
            : `${String(offset + 1)}–${String(Math.min(groupRows, offset + currentCount))} of ${String(groupRows)}`}
        </span>
        <ActionButton
          icon="next"
          disabled={offset + currentCount >= groupRows}
          onClick={() => {
            load(offset + currentCount);
          }}
        >
          Next
        </ActionButton>
        <ActionButton
          icon="copy"
          disabled={page === undefined}
          onClick={() => {
            void navigator.clipboard.writeText(
              copyPageValues(page?.values ?? []),
            );
          }}
        >
          Copy raw values
        </ActionButton>
      </div>
    </div>
  );
}

function DataWorkspace({
  state,
  dispatch,
  request,
  requestRows,
}: {
  readonly state: AppState;
  readonly dispatch: Dispatch<AppAction>;
  readonly request: (selection: RequestSelection) => void;
  readonly requestRows: (selection: RequestRows) => void;
}): ReactNode {
  return (
    <div className="data-workspace">
      <DataToolbar
        state={state}
        dispatch={dispatch}
        request={request}
        requestRows={requestRows}
      />
      {state.orientation === "rows" ? (
        <>
          <ProjectionChooser state={state} dispatch={dispatch} />
          {state.rows === undefined ? (
            <div className="capability-note" role="note">
              <Icon name="info" />
              <span>
                Choose a projection and load a bounded multi-column row page.
                Pages never exceed 500 rows.
              </span>
            </div>
          ) : null}
        </>
      ) : null}
      {state.orientation === "rows" ? (
        state.rows === undefined ? (
          <EmptyState>No projected row page is loaded.</EmptyState>
        ) : (
          <ProjectedGrid
            state={state}
            columns={state.rows.columns}
            rows={state.rows.rows}
            dispatch={dispatch}
          />
        )
      ) : state.page === undefined ? (
        <EmptyState>No column page is loaded.</EmptyState>
      ) : (
        <DataGrid state={state} page={state.page} dispatch={dispatch} />
      )}
    </div>
  );
}

function operatorsFor(
  type: SchemaType | undefined,
): readonly FilterOperator[] {
  if (type === undefined || [10, 11, 12, 19].includes(type.kind)) {
    return [];
  }
  if (type.kind === 0) {
    return ["eq", "ne", "isNull", "isNotNull"];
  }
  if ([7, 16, 17].includes(type.kind)) {
    return [
      "eq",
      "ne",
      "lt",
      "le",
      "gt",
      "ge",
      "contains",
      "isNull",
      "isNotNull",
    ];
  }
  return ["eq", "ne", "lt", "le", "gt", "ge", "isNull", "isNotNull"];
}

const OPERATOR_LABELS: Readonly<Record<FilterOperator, string>> = {
  eq: "=",
  ne: "!=",
  lt: "<",
  le: "<=",
  gt: ">",
  ge: ">=",
  isNull: "is null",
  isNotNull: "is not null",
  contains: "contains",
};

function QueryWorkspace({
  state,
  dispatch,
  bridge,
}: {
  readonly state: AppState;
  readonly dispatch: Dispatch<AppAction>;
  readonly bridge: VsCodeBridge;
}): ReactNode {
  const metadata = state.metadata;
  if (metadata === undefined) {
    return <EmptyState>Metadata is required before building a query.</EmptyState>;
  }
  const type = metadata.schema[state.query.column];
  const operators = operatorsFor(type);
  const needsLiteral =
    state.query.operator !== "isNull" &&
    state.query.operator !== "isNotNull";
  const projection =
    state.projection.length > 0
      ? state.projection
      : rootSchemaTypes(metadata).slice(0, 1).map((column) => column.id);
  const canRun =
    operators.length > 0 &&
    projection.length > 0 &&
    (!needsLiteral || state.query.literal.length > 0);
  const run = (cursor?: string): void => {
    bridge.postMessage({
      kind: "runFilter",
      predicate: {
        column: state.query.column,
        operator: state.query.operator,
        literal: needsLiteral ? state.query.literal : "",
      },
      columns: projection,
      ...(cursor === undefined ? {} : { cursor }),
      limit: state.pageSize,
    });
  };
  return (
    <div className="query-workspace">
      <section className="query-builder">
        <div className="section-heading">
          <div>
            <h2>Typed file filter</h2>
            <p>
              One scalar predicate, evaluated by the portable Core. Statistics
              may only prune a row group when a non-match is proven.
            </p>
          </div>
        </div>
        <form
          onSubmit={(event) => {
            event.preventDefault();
          }}
        >
          <label>
            <span>Column</span>
            <select
              value={state.query.column}
              onChange={(event) => {
                const column = Number(event.currentTarget.value);
                const nextType = metadata.schema[column];
                dispatch({ type: "query", field: "column", value: column });
                dispatch({
                  type: "query",
                  field: "operator",
                  value: operatorsFor(nextType)[0] ?? "eq",
                });
              }}
            >
              {rootSchemaTypes(metadata).map((schemaType) => (
                <option value={schemaType.id} key={schemaType.id}>
                  {schemaType.name} · {typeLabel(state, schemaType)}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>Operator</span>
            <select
              value={state.query.operator}
              disabled={operators.length === 0}
              onChange={(event) => {
                dispatch({
                  type: "query",
                  field: "operator",
                  value: event.currentTarget.value,
                });
              }}
            >
              {operators.map((operator) => (
                <option value={operator} key={operator}>
                  {OPERATOR_LABELS[operator]}
                </option>
              ))}
            </select>
          </label>
          <label className="literal-field">
            <span>Typed value</span>
            <input
              value={state.query.literal}
              disabled={!needsLiteral || operators.length === 0}
              placeholder={
                type?.kind === 14
                  ? `decimal(${String(type.precision ?? 0)},${String(type.scale ?? 0)})`
                  : "Value"
              }
              onChange={(event) => {
                dispatch({
                  type: "query",
                  field: "literal",
                  value: event.currentTarget.value,
                });
              }}
            />
          </label>
          <ActionButton
            icon="query"
            disabled={!canRun}
            onClick={() => {
              run();
            }}
          >
            Run filter
          </ActionButton>
          {state.filter?.cursor === null ||
          state.filter?.cursor === undefined ? null : (
            <ActionButton
              icon="next"
              onClick={() => {
                const cursor = state.filter?.cursor;
                if (cursor !== null && cursor !== undefined) {
                  run(cursor);
                }
              }}
            >
              Continue
            </ActionButton>
          )}
          {state.loading === "filter" ? (
            <ActionButton
              icon="close"
              onClick={() => {
                bridge.postMessage({ kind: "cancel" });
              }}
            >
              Cancel
            </ActionButton>
          ) : null}
        </form>
        <div className="capability-note" role="note">
          <Icon name="info" />
          <span>
            Filter execution is bounded and handled by the portable Core.
            Missing or ambiguous statistics fall back to scanning.
          </span>
        </div>
      </section>
      <section className="query-results" aria-label="Query results">
        <div className="query-progress">
          <span>Scan progress</span>
          <progress
            value={
              (state.filter?.progress.scannedRowGroups ?? 0) +
              (state.filter?.progress.prunedRowGroups ?? 0)
            }
            max={Math.max(1, metadata.rowGroupCount)}
          />
          <span className="muted">
            {state.filter === undefined
              ? "Not started"
              : `${String(state.filter.progress.scannedRowGroups)} scanned · ${String(state.filter.progress.prunedRowGroups)} pruned · ${state.filter.progress.scannedRows} rows read`}
          </span>
        </div>
        {state.filter === undefined ? (
          <EmptyState>
            Run a supported typed filter to inspect matching rows.
          </EmptyState>
        ) : state.filter.rows.length === 0 ? (
          <EmptyState>
            {state.filter.completed
              ? "No rows matched this predicate."
              : "No matches in this page. Continue scanning to advance."}
          </EmptyState>
        ) : (
          <>
            <div className="result-summary" role="status">
              <span>
                {String(state.filter.matched)} matches in this page
              </span>
              <span>
                {state.filter.completed
                  ? "Scan complete"
                  : "More results available"}
                {state.filter.truncated ? " · match limit reached" : ""}
              </span>
            </div>
            <ProjectedGrid
              state={state}
              columns={state.filter.columns}
              rows={state.filter.rows}
              dispatch={dispatch}
            />
          </>
        )}
      </section>
    </div>
  );
}

function statisticEntries(
  statistic: ColumnStatistic | null | undefined,
): readonly (readonly [string, ReactNode])[] {
  if (statistic === undefined || statistic === null) {
    return [["Statistics", "Unavailable"]];
  }
  const values: (readonly [string, ReactNode])[] = [
    ["Values", statistic.numberOfValues],
    ["Contains null", statistic.containsNull ? "Yes" : "No"],
    [
      "Exact statistics",
      <code key="exact-statistics">{JSON.stringify(statistic)}</code>,
    ],
  ];
  const range =
    statistic.integer ??
    statistic.timestamp ??
    statistic.date ??
    statistic.time ??
    statistic.string ??
    statistic.double;
  if (range?.minimum !== undefined) {
    values.push(["Minimum", String(range.minimum)]);
  }
  if (range?.maximum !== undefined) {
    values.push(["Maximum", String(range.maximum)]);
  }
  return values;
}

function selectedColumn(
  state: AppState,
): {
  readonly column: number;
  readonly layout: RowGroupColumn | undefined;
} | undefined {
  const selection = state.selected;
  const column =
    selection.kind === "schema" ||
    selection.kind === "chunk" ||
    selection.kind === "pixel"
      ? selection.column
      : undefined;
  if (column === undefined) {
    return undefined;
  }
  return {
    column,
    layout: state.rowGroup?.columns.find(
      (candidate) => candidate.column === column,
    ),
  };
}

function InspectorPanel({
  state,
  dispatch,
}: {
  readonly state: AppState;
  readonly dispatch: Dispatch<AppAction>;
}): ReactNode {
  const metadata = state.metadata;
  const selected = state.selected;
  const columnSelection = selectedColumn(state);
  let title = "File";
  let entries: readonly (readonly [string, ReactNode])[] = [];
  if (metadata !== undefined) {
    if (selected.kind === "file") {
      entries = [
        ["Rows", String(metadata.rows)],
        ["Columns", String(metadata.schemaCount)],
        ["Row groups", String(metadata.rowGroupCount)],
        ["Content length", `${metadata.postscript.contentLength} bytes`],
        ["Chunk alignment", String(metadata.postscript.columnChunkAlignment)],
        ["Partitioned", metadata.postscript.partitioned ? "Yes" : "No"],
        ["Hidden column", metadata.postscript.hasHiddenColumn ? "Yes" : "No"],
        ["ABI", String(state.capabilities?.abi ?? metadata.abi)],
        ["Page contract", state.capabilities?.page ?? "Unavailable"],
        ["Rows contract", state.capabilities?.rows ?? "Unavailable"],
        ["Filter contract", state.capabilities?.filter ?? "Unavailable"],
        ["Layout contract", state.capabilities?.rowGroup ?? "Unavailable"],
        ["Nested contract", state.capabilities?.nested ?? "Unavailable"],
      ];
    } else if (
      selected.kind === "row-group" ||
      selected.kind === "row"
    ) {
      const group = metadata.rowGroups[selected.rowGroup];
      title =
        selected.kind === "row"
          ? `Row ${selected.localRow}`
          : `Row group ${String(selected.rowGroup)}`;
      entries = [
        ["Row group", String(selected.rowGroup)],
        ["Rows", String(group?.rows ?? 0)],
        ["Data length", `${String(group?.dataLength ?? 0)} bytes`],
        ["Footer offset", group?.footerOffset ?? "Unavailable"],
        ["Footer length", `${String(group?.footerLength ?? 0)} bytes`],
        ...(group?.partition === undefined
          ? []
          : [
              ["Partition hash", String(group.partition.hash)] as const,
              [
                "Partition columns",
                group.partition.columns.join(", "),
              ] as const,
            ]),
      ];
    } else if (columnSelection !== undefined) {
      const type = metadata.schema[columnSelection.column];
      title =
        selected.kind === "pixel"
          ? `Pixel segment ${String(selected.pixel)}`
          : type?.name ?? `Column ${String(columnSelection.column)}`;
      const statistic =
        selected.kind === "pixel"
          ? columnSelection.layout?.chunk.pixels.find(
              (pixel) => pixel.index === selected.pixel,
            )?.statistics
          : selected.kind === "chunk"
            ? metadata.rowGroupStatistics[selected.rowGroup]?.[
                columnSelection.column
              ]
            : metadata.fileStatistics[columnSelection.column];
      entries = [
        ["Column", type?.name ?? String(columnSelection.column)],
        ["Column ID", String(columnSelection.column)],
        ["Logical type", type === undefined ? "Unknown" : typeLabel(state, type)],
        [
          "Subtype IDs",
          type === undefined || type.subtypes.length === 0
            ? "None"
            : type.subtypes.join(", "),
        ],
        ...statisticEntries(statistic),
      ];
      const layout = columnSelection.layout;
      if (layout !== undefined) {
        entries = [
          ...entries,
          [
            "Encoding",
            encodingName(
              layout.encoding.kind,
              state.capabilities?.encodings,
            ),
          ],
          [
            "Dictionary size",
            layout.encoding.dictionarySize === undefined
              ? "Not applicable"
              : String(layout.encoding.dictionarySize),
          ],
          [
            "Cascade encoding",
            layout.encoding.cascadeKind === undefined
              ? "Not applicable"
              : encodingName(
                  layout.encoding.cascadeKind,
                  state.capabilities?.encodings,
                ),
          ],
          ["Chunk offset", layout.chunk.offset],
          ["Chunk length", `${String(layout.chunk.length)} bytes`],
          ["Byte order", layout.chunk.littleEndian ? "Little endian" : "Big endian"],
          ["Null offset", String(layout.chunk.nullOffset)],
          ["Null padding", layout.chunk.nullsPadding ? "Padded" : "Compacted"],
          ["Null alignment", String(layout.chunk.nullAlignment)],
          ["Pixel segments", String(layout.chunk.pixels.length)],
        ];
      }
      if (selected.kind === "pixel") {
        const pixel = layout?.chunk.pixels.find(
          (candidate) => candidate.index === selected.pixel,
        );
        entries = [
          ["Logical position", String(pixel?.position ?? 0)],
          ...entries,
        ];
      }
    }
  }
  return (
    <>
      {state.inspectorOpen ? (
        <button
          type="button"
          className="drawer-scrim inspector-scrim"
          aria-label="Close inspector"
          onClick={() => {
            dispatch({ type: "inspector", open: false });
          }}
        />
      ) : null}
      <aside
        className={`inspector-panel ${state.inspectorOpen ? "is-open" : ""}`}
        aria-label="Selection inspector"
      >
        <div className="panel-heading">
          <div>
            <span className="panel-context">Inspector</span>
            <h2>{title}</h2>
          </div>
          <ActionButton
            icon="close"
            className="icon-only mobile-only"
            aria-label="Close inspector"
            onClick={() => {
              dispatch({ type: "inspector", open: false });
            }}
          >
            Close
          </ActionButton>
        </div>
        <PropertyList entries={entries} />
        {metadata === undefined ? null : (
          <section className="inspector-note">
            <h3>Compression metadata</h3>
            <p>
              {compressionName(metadata.postscript.compression)} · block{" "}
              {String(metadata.postscript.compressionBlockSize)}
            </p>
            <p className="muted">
              Preserved PostScript metadata. Pixels V1 marks this field
              inactive; payload decompression is not claimed.
            </p>
            <p className="muted">
              Declared values:{" "}
              {state.capabilities?.compression.metadata.join(", ") ??
                "NONE, ZLIB, SNAPPY, LZO, LZ4, ZSTD"}
            </p>
          </section>
        )}
      </aside>
    </>
  );
}

export function App({
  bridge,
  subscribe,
}: AppProps): ReactNode {
  const [state, dispatch] = useReducer(appReducer, initialState);
  useEffect(() => subscribe(dispatch), [subscribe]);
  const request = useCallback(
    (selection: RequestSelection): void => {
      bridge.postMessage({
        kind: "select",
        rowGroup: selection.rowGroup,
        column: selection.column,
        rowOffset: String(selection.rowOffset),
        rowCount: selection.rowCount,
      });
    },
    [bridge],
  );
  const requestRows = useCallback(
    (selection: RequestRows): void => {
      bridge.postMessage({
        kind: "selectRows",
        rowGroup: selection.rowGroup,
        columns: selection.columns,
        rowOffset: String(selection.rowOffset),
        rowCount: selection.rowCount,
      });
    },
    [bridge],
  );
  return (
    <div className={`app mode-${state.mode}`}>
      <InstrumentHeader state={state} bridge={bridge} dispatch={dispatch} />
      <Breadcrumb state={state} dispatch={dispatch} />
      <StatusBanner state={state} />
      <div className="workspace-shell">
        <ContextRail
          state={state}
          dispatch={dispatch}
          request={request}
        />
        <main className="primary-workspace">
          {state.mode === "analyze" ? (
            <AnalyzeWorkspace
              state={state}
              dispatch={dispatch}
              request={request}
            />
          ) : state.mode === "data" ? (
            <DataWorkspace
              state={state}
              dispatch={dispatch}
              request={request}
              requestRows={requestRows}
            />
          ) : (
            <QueryWorkspace
              state={state}
              dispatch={dispatch}
              bridge={bridge}
            />
          )}
        </main>
        <InspectorPanel state={state} dispatch={dispatch} />
      </div>
    </div>
  );
}
