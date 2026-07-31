import {
  flexRender,
  getCoreRowModel,
  useReactTable,
} from "@tanstack/react-table";
import type {
  ColumnDef,
} from "@tanstack/react-table";
import type {
  PageResult,
  PageValue,
  ProjectedColumn,
  ProjectedRow,
} from "@pixels-inspector/protocol-client";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type {
  Dispatch,
  ReactNode,
} from "react";

import {
  PAGE_SIZES,
  rootSchemaTypes,
  selectRow,
  selectSchema,
} from "../../app/model.js";
import type {
  AppAction,
  AppState,
  DataOrientation,
  PageSize,
} from "../../app/model.js";
import {
  ColumnsControl,
} from "../../components/ColumnsControl.js";
import {
  copyPageValues,
  formatDisplayValue,
  formatPageValue,
} from "../../value-format.js";
import {
  ActionButton,
  EmptyState,
  kindName,
  typeLabel,
} from "../shared/WorkspaceChrome.js";
import type {
  RequestRows,
  RequestSelection,
} from "../shared/WorkspaceChrome.js";

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
  const selectedRowIndex = rows.findIndex(
    (row) =>
      state.selected.kind === "row" &&
      state.selected.rowGroup === row.rowGroup &&
      state.selected.localRow === String(row.localRow),
  );
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
          {table.getRowModel().rows.map((row, rowIndex, renderedRows) => {
            const entity = selectRow(
              row.original.rowGroup,
              row.original.localRow,
            );
            return (
              <tr
                key={row.id}
                tabIndex={
                  selectedRowIndex >= 0
                    ? rowIndex === selectedRowIndex ? 0 : -1
                    : rowIndex === 0 ? 0 : -1
                }
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
                    return;
                  }
                  let target = rowIndex;
                  if (event.key === "ArrowUp") {
                    target -= 1;
                  } else if (event.key === "ArrowDown") {
                    target += 1;
                  } else if (event.key === "Home") {
                    target = 0;
                  } else if (event.key === "End") {
                    target = renderedRows.length - 1;
                  } else {
                    return;
                  }
                  if (target < 0 || target >= renderedRows.length) {
                    return;
                  }
                  event.preventDefault();
                  const targetRow = renderedRows[target];
                  if (targetRow === undefined) {
                    return;
                  }
                  dispatch({
                    type: "select",
                    entity: selectRow(
                      targetRow.original.rowGroup,
                      targetRow.original.localRow,
                    ),
                  });
                  const sibling = event.currentTarget.parentElement
                    ?.children.item(target);
                  if (sibling instanceof HTMLElement) {
                    sibling.focus();
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

export function ProjectedGrid({
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
  const [copyStatus, setCopyStatus] = useState<"idle" | "copied">("idle");
  const copyReset = useRef<number | undefined>(undefined);
  useEffect(
    () => () => {
      if (copyReset.current !== undefined) {
        globalThis.clearTimeout(copyReset.current);
      }
    },
    [],
  );
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
  const selectedRowIndex = rows.findIndex(
    (row) =>
      state.selected.kind === "row" &&
      state.selected.rowGroup === row.rowGroup &&
      state.selected.localRow === row.localRow,
  );
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
            void navigator.clipboard.writeText(text).then(() => {
              setCopyStatus("copied");
              if (copyReset.current !== undefined) {
                globalThis.clearTimeout(copyReset.current);
              }
              copyReset.current = globalThis.setTimeout(() => {
                setCopyStatus("idle");
              }, 1200);
            });
          }}
        >
          {copyStatus === "copied" ? "Copied" : "Copy page as TSV"}
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
            {table.getRowModel().rows.map((row, rowIndex, renderedRows) => {
              const entity = selectRow(
                row.original.rowGroup,
                row.original.localRow,
              );
              return (
                <tr
                  key={row.id}
                  tabIndex={
                    selectedRowIndex >= 0
                      ? rowIndex === selectedRowIndex ? 0 : -1
                      : rowIndex === 0 ? 0 : -1
                  }
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
                      return;
                    }
                    let target = rowIndex;
                    if (event.key === "ArrowUp") {
                      target -= 1;
                    } else if (event.key === "ArrowDown") {
                      target += 1;
                    } else if (event.key === "Home") {
                      target = 0;
                    } else if (event.key === "End") {
                      target = renderedRows.length - 1;
                    } else {
                      return;
                    }
                    if (target < 0 || target >= renderedRows.length) {
                      return;
                    }
                    event.preventDefault();
                    const targetRow = renderedRows[target];
                    if (targetRow === undefined) {
                      return;
                    }
                    dispatch({
                      type: "select",
                      entity: selectRow(
                        targetRow.original.rowGroup,
                        targetRow.original.localRow,
                      ),
                    });
                    const sibling = event.currentTarget.parentElement
                      ?.children.item(target);
                    if (sibling instanceof HTMLElement) {
                      sibling.focus();
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

function projectionKey(columns: readonly number[]): string {
  return columns.join(",");
}

function rowsProjectionKey(columns: readonly ProjectedColumn[]): string {
  return projectionKey(columns.map((column) => column.id));
}

function alignProjectedRows(
  columns: readonly ProjectedColumn[],
  rows: readonly ProjectedRow[],
  projection: readonly number[],
): {
  readonly columns: readonly ProjectedColumn[];
  readonly rows: readonly ProjectedRow[];
} | undefined {
  const indices = projection.map((column) =>
    columns.findIndex((candidate) => candidate.id === column),
  );
  if (indices.some((index) => index < 0)) {
    return undefined;
  }
  const alignedColumns: ProjectedColumn[] = [];
  for (const index of indices) {
    const column = columns[index];
    if (column === undefined) {
      return undefined;
    }
    alignedColumns.push(column);
  }
  const alignedRows: ProjectedRow[] = [];
  for (const row of rows) {
    const values: PageValue[] = [];
    for (const index of indices) {
      const value = row.values[index];
      if (value === undefined) {
        return undefined;
      }
      values.push(value);
    }
    alignedRows.push({ ...row, values });
  }
  return { columns: alignedColumns, rows: alignedRows };
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
  const orientationButtons = useRef<
    Record<DataOrientation, HTMLButtonElement | null>
  >({ rows: null, column: null });
  const metadata = state.metadata;
  const page = state.page;
  if (metadata === undefined) {
    return null;
  }
  const rowGroup =
    (state.orientation === "rows" ? state.rows?.rowGroup : page?.rowGroup) ??
    state.rowGroup?.rowGroup ??
    0;
  const column =
    metadata.schema[state.focusedColumn] === undefined
      ? (state.dataProjection[0] ?? 0)
      : state.focusedColumn;
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
    nextPageSize = state.pageSize,
  ): void => {
    const available = metadata.rowGroups[nextRowGroup]?.rows ?? 0;
    if (available <= 0) {
      return;
    }
    const boundedOffset = Math.min(Math.max(0, nextOffset), available - 1);
    const rowCount = Math.min(
      nextPageSize,
      available - boundedOffset,
    );
    if (state.orientation === "rows") {
      if (state.dataProjection.length === 0) {
        return;
      }
      requestRows({
        rowGroup: nextRowGroup,
        columns: state.dataProjection,
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
  const timestampVisible =
    state.orientation === "rows"
      ? state.dataProjection.some(
          (projected) => metadata.schema[projected]?.kind === 9,
        )
      : metadata.schema[column]?.kind === 9;
  const selectOrientation = (orientation: DataOrientation): void => {
    dispatch({ type: "orientation", orientation });
    const available = metadata.rowGroups[rowGroup]?.rows ?? 0;
    if (available <= 0) {
      return;
    }
    const rowCount = Math.min(state.pageSize, available - offset);
    if (orientation === "rows") {
      if (state.dataProjection.length === 0) {
        return;
      }
      requestRows({
        rowGroup,
        columns: state.dataProjection,
        rowOffset: offset,
        rowCount,
      });
    } else {
      request({
        rowGroup,
        column,
        rowOffset: offset,
        rowCount,
      });
    }
  };
  const orientations = ["rows", "column"] as const;
  return (
    <div className="data-toolbar">
      <div
        className="segmented"
        role="radiogroup"
        aria-label="Data orientation"
      >
        {orientations.map((orientation) => (
          <button
            type="button"
            role="radio"
            key={orientation}
            ref={(element) => {
              orientationButtons.current[orientation] = element;
            }}
            aria-checked={state.orientation === orientation}
            tabIndex={state.orientation === orientation ? 0 : -1}
            onClick={() => {
              selectOrientation(orientation);
            }}
            onKeyDown={(event) => {
              let nextOrientation: DataOrientation | undefined;
              if (event.key === "ArrowLeft" || event.key === "Home") {
                nextOrientation = "rows";
              } else if (
                event.key === "ArrowRight" ||
                event.key === "End"
              ) {
                nextOrientation = "column";
              }
              if (nextOrientation !== undefined) {
                event.preventDefault();
                selectOrientation(nextOrientation);
                orientationButtons.current[nextOrientation]?.focus();
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
      {state.orientation === "column" ? (
        <label>
          <span>Column</span>
          <select
            value={column}
            onChange={(event) => {
              const nextColumn = Number(event.currentTarget.value);
              dispatch({
                type: "select",
                entity: selectSchema(nextColumn),
              });
              load(0, rowGroup, nextColumn);
            }}
          >
            {metadata.schema.map((type) => (
              <option value={type.id} key={type.id}>
                {type.name} · {typeLabel(state, type)}
              </option>
            ))}
          </select>
        </label>
      ) : null}
      <label>
        <span>Rows per page</span>
        <select
          value={state.pageSize}
          onChange={(event) => {
            const pageSize = Number(event.currentTarget.value) as PageSize;
            if (PAGE_SIZES.includes(pageSize)) {
              dispatch({ type: "page-size", pageSize });
              load(0, rowGroup, column, pageSize);
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
      {timestampVisible ? (
        <label className="timestamp-control">
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
      ) : null}
      <div className="toolbar-spacer" />
      <div className="paging-controls">
        <ActionButton
          icon="previous"
          disabled={
            offset <= 0 ||
            (state.orientation === "rows" &&
              state.dataProjection.length === 0)
          }
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
          disabled={
            offset + currentCount >= groupRows ||
            (state.orientation === "rows" &&
              state.dataProjection.length === 0)
          }
          onClick={() => {
            load(offset + currentCount);
          }}
        >
          Next
        </ActionButton>
        {state.orientation === "column" ? (
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
        ) : null}
      </div>
    </div>
  );
}

export function DataWorkspace({
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
  const currentProjectionKey = projectionKey(state.dataProjection);
  const previousProjectionKey = useRef(currentProjectionKey);
  const [pendingProjectionKey, setPendingProjectionKey] = useState<
    string | undefined
  >();
  const projectionChanged =
    currentProjectionKey !== previousProjectionKey.current;
  const projectionNeedsRead =
    state.rows === undefined ||
    state.dataProjection.some(
      (column) =>
        !state.rows?.columns.some((loaded) => loaded.id === column),
    );
  const projectionUpdating =
    (projectionChanged && projectionNeedsRead) ||
    pendingProjectionKey === currentProjectionKey;
  const currentRowsProjectionKey =
    state.rows === undefined ? undefined : rowsProjectionKey(state.rows.columns);

  useEffect(() => {
    if (currentProjectionKey === previousProjectionKey.current) {
      return;
    }
    previousProjectionKey.current = currentProjectionKey;
    if (
      state.orientation !== "rows" ||
      state.metadata === undefined ||
      state.dataProjection.length === 0 ||
      !projectionNeedsRead
    ) {
      setPendingProjectionKey(undefined);
      return;
    }
    setPendingProjectionKey(currentProjectionKey);
    const rowGroup =
      state.rows?.rowGroup ?? state.rowGroup?.rowGroup ?? 0;
    const available = state.metadata.rowGroups[rowGroup]?.rows ?? 0;
    if (available <= 0) {
      return;
    }
    const timeout = globalThis.setTimeout(() => {
      const rowOffset = Number(state.rows?.offset ?? 0);
      const rowCount =
        state.rows?.rowGroup === rowGroup
          ? state.rows.count
          : Math.min(state.pageSize, available);
      requestRows({
        rowGroup,
        columns: state.dataProjection,
        rowOffset,
        rowCount,
      });
    }, 90);
    return () => {
      globalThis.clearTimeout(timeout);
    };
  }, [
    currentProjectionKey,
    projectionNeedsRead,
    requestRows,
    state.metadata,
    state.orientation,
    state.pageSize,
    state.dataProjection,
    state.rowGroup?.rowGroup,
    state.rows?.count,
    state.rows?.offset,
    state.rows?.rowGroup,
  ]);

  useEffect(() => {
    if (
      pendingProjectionKey === currentProjectionKey &&
      currentRowsProjectionKey === currentProjectionKey
    ) {
      setPendingProjectionKey(undefined);
    }
  }, [
    currentProjectionKey,
    currentRowsProjectionKey,
    pendingProjectionKey,
  ]);

  const alignedRows =
    state.rows === undefined
      ? undefined
      : alignProjectedRows(
          state.rows.columns,
          state.rows.rows,
          state.dataProjection.filter((column) =>
            state.rows?.columns.some((loaded) => loaded.id === column),
          ),
        );
  const columns = state.metadata === undefined
    ? []
    : rootSchemaTypes(state.metadata).map((type) => ({
        id: type.id,
        name: type.name,
        detail: typeLabel(state, type),
      }));
  const visibleRowGroup = state.metadata?.rowGroups.find(
    (group) =>
      group.index ===
      (state.rows?.rowGroup ?? state.page?.rowGroup ?? state.rowGroup?.rowGroup ??
        state.metadata?.rowGroups[0]?.index),
  );
  return (
    <div className="data-workspace">
      <DataToolbar
        state={state}
        dispatch={dispatch}
        request={request}
        requestRows={requestRows}
      />
      {state.metadata !== undefined && visibleRowGroup === undefined ? (
        <EmptyState>This file has no Row Groups to browse.</EmptyState>
      ) : visibleRowGroup?.rows === 0 ? (
        <EmptyState>This Row Group contains no rows.</EmptyState>
      ) : state.orientation === "rows" ? (
        <ColumnsControl
          columns={columns}
          value={state.dataProjection}
          onChange={(projection) => {
            dispatch({ type: "data-projection", projection });
          }}
        />
      ) : null}
      {state.orientation === "rows" ? (
        state.dataProjection.length === 0 ? (
          <EmptyState>
            Select at least one column in Columns to preview rows. No request
            is sent for an empty projection.
          </EmptyState>
        ) : alignedRows === undefined || alignedRows.columns.length === 0 ? (
          <EmptyState>No projected row page is loaded.</EmptyState>
        ) : (
          <>
            {projectionUpdating ? (
              <div className="table-update-status" role="status" aria-live="polite">
                Updating columns…
              </div>
            ) : null}
            <ProjectedGrid
              state={state}
              columns={alignedRows.columns}
              rows={alignedRows.rows}
              dispatch={dispatch}
            />
          </>
        )
      ) : state.page === undefined ? (
        <EmptyState>No column page is loaded.</EmptyState>
      ) : (
        <DataGrid state={state} page={state.page} dispatch={dispatch} />
      )}
    </div>
  );
}
