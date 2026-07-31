import type {
  ColumnStatistic,
  RowGroupColumn,
} from "@pixels-inspector/protocol-client";
import type {
  Dispatch,
  KeyboardEvent,
  RefObject,
  ReactNode,
} from "react";
import {
  useEffect,
  useRef,
  useState,
} from "react";

import {
  selectChunk,
  selectPixel,
  selectRowGroup,
} from "../../app/model.js";
import type {
  AppAction,
  AppState,
} from "../../app/model.js";
import {
  Icon,
} from "../../components/Icon.js";
import {
  ResponsivePanel,
} from "../../components/ResponsivePanel.js";
import {
  compressionName,
  encodingName,
  formatBytes,
} from "../../value-format.js";
import {
  deriveRowGroupBands,
  pixelLabelStride,
  pixelTickPosition,
} from "../../visualization/geometry.js";
import {
  ActionButton,
  EmptyState,
  EntityButton,
  PropertyList,
  typeLabel,
} from "../shared/WorkspaceChrome.js";
import type {
  RequestSelection,
} from "../shared/WorkspaceChrome.js";
import {
  SchemaTree,
} from "./SchemaTree.js";

export function ContextRail({
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
    <ResponsivePanel
      open={state.railOpen}
      side="context"
      label="File context"
      className="context-rail"
      onClose={() => {
        dispatch({ type: "rail", open: false });
      }}
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
              <SchemaTree
                metadata={metadata}
                state={state}
                dispatch={dispatch}
                onSelect={() => {
                  dispatch({ type: "rail", open: false });
                }}
              />
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
                      dispatch({ type: "rail", open: false });
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
          </>
        )}
    </ResponsivePanel>
  );
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
        exactValues
        entries={[
          ["Source", source.uri],
          ["Source revision", source.revision],
          ["File size", `${formatBytes(source.size)} · ${source.size} bytes`],
          ["Format", `${metadata.magic} v${String(metadata.version)}`],
          ["Pixel stride", `${String(metadata.pixelStride)} rows`],
          [
            "Compression metadata",
            `${compression} · inactive in Pixels V1`,
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

function useStableSvgWidth(
  minimum: number,
): readonly [RefObject<SVGSVGElement | null>, number] {
  const ref = useRef<SVGSVGElement>(null);
  const [width, setWidth] = useState(minimum);
  useEffect(() => {
    const element = ref.current;
    if (element === null) {
      return;
    }
    const update = (next: number): void => {
      setWidth(Math.max(minimum, Math.round(next)));
    };
    update(element.getBoundingClientRect().width);
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry !== undefined) {
        update(entry.contentRect.width);
      }
    });
    observer.observe(element);
    return () => {
      observer.disconnect();
    };
  }, [minimum]);
  return [ref, width];
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
  const [mapRef, mapWidth] = useStableSvgWidth(280);
  if (metadata === undefined || metadata.rowGroups.length === 0) {
    return <EmptyState>No row groups are present in this file.</EmptyState>;
  }
  const bands = deriveRowGroupBands(metadata.rowGroups);
  const mapSpan = mapWidth - 40;
  const linkedRowGroup =
    state.selected.kind === "row-group" ||
    state.selected.kind === "chunk" ||
    state.selected.kind === "pixel" ||
    state.selected.kind === "row"
      ? state.selected.rowGroup
      : undefined;
  const select = (index: number): void => {
    const group = metadata.rowGroups.find((candidate) => candidate.index === index);
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
        ref={mapRef}
        className="file-map"
        viewBox={`0 0 ${String(mapWidth)} 132`}
        role="img"
        aria-labelledby="file-map-title file-map-description"
      >
        <title id="file-map-title">Row groups by data size</title>
        <desc id="file-map-description">
          A proportional map of row-group data lengths. Each row group is
          keyboard selectable; exact values follow in a table.
        </desc>
        <line className="map-axis" x1="20" y1="102" x2={mapWidth - 20} y2="102" />
        {bands.map((band, listIndex) => {
          const group = metadata.rowGroups[band.index];
          if (group === undefined) {
            return null;
          }
          const x = 20 + band.start * mapSpan;
          const width = Math.max(2, band.size * mapSpan - 2);
          const entity = selectRowGroup(group.index);
          const active =
            linkedRowGroup === group.index || state.hoveredKey === entity.key;
          return (
            <g
              key={group.index}
              role="button"
              tabIndex={
                linkedRowGroup === group.index ||
                (linkedRowGroup === undefined && listIndex === 0)
                  ? 0
                  : -1
              }
              aria-label={`Row group ${String(group.index)}, ${String(group.rows)} rows, ${String(group.dataLength)} data bytes`}
              aria-pressed={linkedRowGroup === group.index}
              className={active ? "is-active" : ""}
              onClick={() => {
                select(group.index);
              }}
              onKeyDown={(event) => {
                if (event.key === "ArrowRight" || event.key === "ArrowLeft") {
                  event.preventDefault();
                  const delta = event.key === "ArrowRight" ? 1 : -1;
                  const next = (listIndex + delta + bands.length) % bands.length;
                  const nextGroup = metadata.rowGroups[next];
                  if (nextGroup === undefined) {
                    return;
                  }
                  select(nextGroup.index);
                  event.currentTarget.parentElement
                    ?.querySelectorAll<SVGGElement>("g[role='button']")
                    .item(next)
                    .focus();
                } else {
                  onKey(event, group.index);
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
  const totalChunkBytes = rowGroup.columns.reduce(
    (total, column) => total + column.chunk.length,
    0,
  );
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
        <span className="source-badge numeric">
          {String(totalChunkBytes)} B total
        </span>
      </div>
      <div className="chunk-matrix" role="list" aria-label="Column chunks">
        {rowGroup.columns.map((column) => {
          const type = metadata.schema[column.column];
          const entity = selectChunk(rowGroup.rowGroup, column.column);
          const share =
            totalChunkBytes === 0
              ? 0
              : (column.chunk.length / totalChunkBytes) * 100;
          return (
            <EntityButton
              key={column.column}
              entity={entity}
              state={state}
              dispatch={dispatch}
              className={`chunk-cell ${
                state.focusedColumn === column.column
                  ? "is-focused-column"
                  : ""
              }`}
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
              <span className="chunk-share" aria-hidden="true">
                <span style={{ width: `${String(share)}%` }} />
              </span>
              <span className="chunk-share-label">
                {share.toFixed(1)}% of Row Group chunk bytes
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
  const [mapRef, mapWidth] = useStableSvgWidth(280);
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
  const type = metadata.schema[column.column];
  const mapSpan = mapWidth - 60;
  const labelStride = pixelLabelStride(column.chunk.pixels.length, mapSpan);
  const linkedPixel =
    state.selected.kind === "pixel" &&
    state.selected.rowGroup === rowGroup.rowGroup &&
    state.selected.column === column.column
      ? state.selected.pixel
      : undefined;
  return (
    <section className="analysis-section pixel-detail">
      <div className="section-heading">
        <div>
          <h2>
            {type?.name ?? `Column ${String(column.column)}`} · pixel segments
          </h2>
          <p>
            Ticks show exact starts within the Column Chunk. Segment widths are
            not available and are intentionally not inferred.
          </p>
        </div>
      </div>
      <svg
        ref={mapRef}
        viewBox={`0 0 ${String(mapWidth)} 116`}
        className="pixel-map"
        role="img"
        aria-labelledby="pixel-map-title pixel-map-description"
      >
        <title id="pixel-map-title">
          Pixel positions for {type?.name ?? "selected column"}
        </title>
        <desc id="pixel-map-description">
          Selectable ticks positioned by each pixel segment's exact byte start
          within the Column Chunk. This chart does not infer segment widths.
        </desc>
        <line className="pixel-axis" x1="30" y1="68" x2={mapWidth - 30} y2="68" />
        <text x="30" y="96">byte 0</text>
        <text textAnchor="end" x={mapWidth - 30} y="96">
          byte {String(column.chunk.length)}
        </text>
        {column.chunk.pixels.map((pixel, listIndex) => {
          const x = 30 + pixelTickPosition(
            pixel.position,
            column.chunk.length,
          ) * mapSpan;
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
              tabIndex={
                linkedPixel === pixel.index ||
                (linkedPixel === undefined && listIndex === 0)
                  ? 0
                  : -1
              }
              aria-label={`Pixel segment ${String(pixel.index)}, chunk byte offset ${String(pixel.position)}`}
              aria-pressed={state.selected.key === entity.key}
              className={active ? "is-active" : ""}
              onClick={activate}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  activate();
                } else if (
                  event.key === "ArrowRight" ||
                  event.key === "ArrowLeft"
                ) {
                  event.preventDefault();
                  const delta = event.key === "ArrowRight" ? 1 : -1;
                  const pixels = column.chunk.pixels;
                  const next = (listIndex + delta + pixels.length) % pixels.length;
                  const nextPixel = pixels[next];
                  if (nextPixel !== undefined) {
                    dispatch({
                      type: "select",
                      entity: selectPixel(
                        rowGroup.rowGroup,
                        column.column,
                        nextPixel.index,
                      ),
                    });
                    event.currentTarget.parentElement
                      ?.querySelectorAll<SVGGElement>("g[role='button']")
                      .item(next)
                      .focus();
                  }
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
              {listIndex % labelStride === 0 ||
              listIndex === column.chunk.pixels.length - 1 ? (
                <text textAnchor="middle" x={x} y="24">
                  {String(pixel.index)}
                </text>
              ) : null}
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
            <span className="numeric">
              chunk offset {String(pixel.position)}
            </span>
          </EntityButton>
        ))}
      </div>
    </section>
  );
}

export function AnalyzeWorkspace({
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

export function InspectorPanel({
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
          ["Chunk byte offset", String(pixel?.position ?? 0)],
          ...entries,
        ];
      }
    }
  }
  const essentialEntries = entries.slice(0, 6);
  const detailEntries = entries.slice(6);
  return (
    <ResponsivePanel
      open={state.inspectorOpen}
      side="inspector"
      label="Selection inspector"
      className="inspector-panel"
      onClose={() => {
        dispatch({ type: "inspector", open: false });
      }}
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
        <section aria-labelledby="inspector-essentials">
          <h3 id="inspector-essentials">Essentials</h3>
          <PropertyList entries={essentialEntries} />
        </section>
        {detailEntries.length === 0 ? null : (
          <details className="inspector-details">
            <summary>More details</summary>
            <PropertyList entries={detailEntries} />
          </details>
        )}
    </ResponsivePanel>
  );
}
