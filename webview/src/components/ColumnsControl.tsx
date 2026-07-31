import {
  useMemo,
  useState,
} from "react";
import type {
  ChangeEvent,
  KeyboardEvent,
  ReactNode,
} from "react";

import {
  Icon,
} from "./Icon.js";

export interface ColumnChoice {
  readonly id: number;
  readonly name: string;
  readonly detail: string;
}

export interface ColumnsControlProps {
  readonly columns: readonly ColumnChoice[];
  readonly value: readonly number[];
  readonly onChange: (columns: readonly number[]) => void;
  readonly label?: string;
  readonly presentation?: "disclosure" | "embedded";
}

function moveColumn(
  value: readonly number[],
  column: number,
  direction: -1 | 1,
): readonly number[] {
  const index = value.indexOf(column);
  const target = index + direction;
  if (index < 0 || target < 0 || target >= value.length) {
    return value;
  }
  const next = [...value];
  const adjacent = next[target];
  if (adjacent === undefined) {
    return value;
  }
  next[target] = column;
  next[index] = adjacent;
  return next;
}

export function ColumnsControl({
  columns,
  value,
  onChange,
  label = "Columns",
  presentation = "disclosure",
}: ColumnsControlProps): ReactNode {
  const [query, setQuery] = useState("");
  const [announcement, setAnnouncement] = useState("");
  const byId = useMemo(
    () => new Map(columns.map((column) => [column.id, column])),
    [columns],
  );
  const selected = value
    .map((column) => byId.get(column))
    .filter((column): column is ColumnChoice => column !== undefined);
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const available = columns.filter(
    (column) =>
      !value.includes(column.id) &&
      (normalizedQuery.length === 0 ||
        column.name.toLocaleLowerCase().includes(normalizedQuery) ||
        column.detail.toLocaleLowerCase().includes(normalizedQuery)),
  );

  const updatePosition = (column: ColumnChoice, direction: -1 | 1): void => {
    const next = moveColumn(value, column.id, direction);
    if (next === value) {
      return;
    }
    onChange(next);
    const position = next.indexOf(column.id) + 1;
    setAnnouncement(
      `${column.name} moved to position ${String(position)} of ${String(next.length)}.`,
    );
  };

  const renderItem = (
    column: ColumnChoice,
    isSelected: boolean,
  ): ReactNode => {
    const index = value.indexOf(column.id);
    const onCheckboxChange = (event: ChangeEvent<HTMLInputElement>): void => {
      onChange(
        event.currentTarget.checked
          ? [...value, column.id]
          : value.filter((candidate) => candidate !== column.id),
      );
    };
    const onItemKeyDown = (event: KeyboardEvent<HTMLLabelElement>): void => {
      if (!isSelected || !event.altKey) {
        return;
      }
      if (event.key === "ArrowUp" || event.key === "ArrowDown") {
        event.preventDefault();
        updatePosition(column, event.key === "ArrowUp" ? -1 : 1);
      }
    };
    return (
      <div
        className={`projection-item ${isSelected ? "is-selected" : ""}`}
        role="listitem"
        key={column.id}
      >
        <label onKeyDown={onItemKeyDown}>
          <input
            type="checkbox"
            checked={isSelected}
            onChange={onCheckboxChange}
          />
          <span>{column.name}</span>
          <span className="muted">{column.detail}</span>
        </label>
        {isSelected ? (
          <span className="projection-order">
            <span
              className="numeric"
              aria-label={`Position ${String(index + 1)}`}
            >
              {String(index + 1)}
            </span>
            <button
              type="button"
              title={`Move ${column.name} up`}
              aria-label={`Move ${column.name} up`}
              disabled={index === 0}
              onClick={() => {
                updatePosition(column, -1);
              }}
            >
              <Icon name="up" />
            </button>
            <button
              type="button"
              title={`Move ${column.name} down`}
              aria-label={`Move ${column.name} down`}
              disabled={index === value.length - 1}
              onClick={() => {
                updatePosition(column, 1);
              }}
            >
              <Icon name="down" />
            </button>
          </span>
        ) : null}
      </div>
    );
  };

  const editor = (
    <>
      <div className="columns-editor-toolbar">
        {columns.length > 12 ? (
          <label>
            <span>Find columns</span>
            <input
              type="search"
              value={query}
              onChange={(event) => {
                setQuery(event.currentTarget.value);
              }}
            />
          </label>
        ) : null}
        <span className="columns-editor-actions">
          <button
            type="button"
            onClick={() => {
              onChange(columns.map((column) => column.id));
            }}
          >
            Select all
          </button>
          <button
            type="button"
            onClick={() => {
              onChange([]);
            }}
          >
            Clear
          </button>
          <button
            type="button"
            onClick={() => {
              const selectedSet = new Set(value);
              onChange(
                columns
                  .map((column) => column.id)
                  .filter((column) => selectedSet.has(column)),
              );
            }}
          >
            Schema order
          </button>
        </span>
      </div>
      <div className="projection-list" role="list" aria-label={label}>
        {selected.map((column) => renderItem(column, true))}
        {available.map((column) => renderItem(column, false))}
      </div>
      <span className="visually-hidden" aria-live="polite">
        {announcement}
      </span>
    </>
  );

  if (presentation === "embedded") {
    return (
      <div
        className="columns-control projection-editor is-embedded"
        role="group"
        aria-label={label}
      >
        {editor}
      </div>
    );
  }

  return (
    <details className="columns-control projection-editor">
      <summary>
        {label} · {String(value.length)} selected
        {selected.length === 0
          ? ""
          : ` · ${selected
              .slice(0, 3)
              .map((column) => column.name)
              .join(", ")}${selected.length > 3 ? ", …" : ""}`}
      </summary>
      {editor}
    </details>
  );
}
