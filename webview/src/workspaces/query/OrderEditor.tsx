import type {
  MetadataResult,
  ScanOrderKeyV2,
  SchemaType,
} from "@pixels-inspector/protocol-client";
import {
  useState,
} from "react";
import type {
  ReactNode,
} from "react";

import type {
  AppState,
} from "../../app/model.js";
import {
  Icon,
} from "../../components/Icon.js";
import {
  TruncatedText,
} from "../../components/TruncatedText.js";
import {
  typeLabel,
} from "../shared/WorkspaceChrome.js";
import {
  isComparableType,
  schemaTypeById,
} from "./query-plan.js";

export function OrderingInfo(): ReactNode {
  const [open, setOpen] = useState(false);
  return (
    <span className="order-info">
      <button
        type="button"
        className="info-button"
        aria-label="How ordered scans work"
        aria-expanded={open}
        aria-controls="ordered-scan-info"
        title="How ordered scans work"
        onClick={() => {
          setOpen((current) => !current);
        }}
      >
        <Icon name="info" />
      </button>
      {open ? (
        <span id="ordered-scan-info" className="info-popover" role="note">
          Global ordering may inspect candidates across the full file. The Core
          retains only a bounded Top-K window and may safely prune Row Groups
          from statistics. Continuing an ordered result can rescan the file.
        </span>
      ) : null}
    </span>
  );
}

export function OrderEditor({
  keys,
  rootTypes,
  metadata,
  state,
  errors,
  onChange,
}: {
  readonly keys: readonly ScanOrderKeyV2[];
  readonly rootTypes: readonly SchemaType[];
  readonly metadata: MetadataResult;
  readonly state: AppState;
  readonly errors: Readonly<Record<string, string>>;
  readonly onChange: (keys: readonly ScanOrderKeyV2[]) => void;
}): ReactNode {
  const available = rootTypes.filter(
    (type) =>
      isComparableType(type) && !keys.some((key) => key.column === type.id),
  );
  return (
    <div className="order-editor">
      {keys.length === 0 ? (
        <p className="muted">Natural file order. Absolute row order is stable.</p>
      ) : (
        <ol className="order-list">
          {keys.map((key, index) => (
            <li key={key.column}>
              <span className="numeric" aria-label={`Priority ${String(index + 1)}`}>
                {String(index + 1)}
              </span>
              <TruncatedText
                value={(() => {
                  const type = schemaTypeById(metadata, key.column);
                  return type === undefined
                    ? "Unknown column"
                    : `${type.name} · ${typeLabel(state, type)}`;
                })()}
                className="query-column-select"
                renderControl={(describedBy) => (
                  <select
                    aria-label={`Order key ${String(index + 1)} column`}
                    aria-describedby={describedBy}
                    value={key.column}
                    onChange={(event) => {
                      const next = [...keys];
                      next[index] = {
                        ...key,
                        column: Number(event.currentTarget.value),
                      };
                      onChange(next);
                    }}
                  >
                    {[schemaTypeById(metadata, key.column), ...available]
                      .filter((type): type is SchemaType => type !== undefined)
                      .map((type) => (
                        <option value={type.id} key={type.id}>
                          {type.name} · {typeLabel(state, type)}
                        </option>
                      ))}
                  </select>
                )}
              />
              <select
                aria-label={`Order key ${String(index + 1)} direction`}
                value={key.direction}
                onChange={(event) => {
                  const direction = event.currentTarget.value;
                  if (direction === "asc" || direction === "desc") {
                    const next = [...keys];
                    next[index] = { ...key, direction };
                    onChange(next);
                  }
                }}
              >
                <option value="asc">Ascending</option>
                <option value="desc">Descending</option>
              </select>
              <select
                aria-label={`Order key ${String(index + 1)} null placement`}
                value={key.nulls}
                onChange={(event) => {
                  const nulls = event.currentTarget.value;
                  if (nulls === "first" || nulls === "last") {
                    const next = [...keys];
                    next[index] = { ...key, nulls };
                    onChange(next);
                  }
                }}
              >
                <option value="first">NULLS FIRST</option>
                <option value="last">NULLS LAST</option>
              </select>
              <span className="order-actions">
                <button
                  type="button"
                  title="Move order key up"
                  aria-label={`Move order key ${String(index + 1)} up`}
                  disabled={index === 0}
                  onClick={() => {
                    const next = [...keys];
                    const previous = next[index - 1];
                    if (previous !== undefined) {
                      next[index - 1] = key;
                      next[index] = previous;
                      onChange(next);
                    }
                  }}
                >
                  <Icon name="up" />
                </button>
                <button
                  type="button"
                  title="Move order key down"
                  aria-label={`Move order key ${String(index + 1)} down`}
                  disabled={index === keys.length - 1}
                  onClick={() => {
                    const next = [...keys];
                    const following = next[index + 1];
                    if (following !== undefined) {
                      next[index + 1] = key;
                      next[index] = following;
                      onChange(next);
                    }
                  }}
                >
                  <Icon name="down" />
                </button>
                <button
                  type="button"
                  title="Remove order key"
                  aria-label={`Remove order key ${String(index + 1)}`}
                  onClick={() => {
                    onChange(keys.filter((_, candidate) => candidate !== index));
                  }}
                >
                  <Icon name="close" />
                </button>
              </span>
              {errors[`order.${String(index)}`] === undefined ? null : (
                <p className="field-error" role="alert">
                  {errors[`order.${String(index)}`]}
                </p>
              )}
            </li>
          ))}
        </ol>
      )}
      <button
        type="button"
        disabled={keys.length >= 8 || available.length === 0}
        onClick={() => {
          const column = available[0];
          if (column !== undefined) {
            onChange([
              ...keys,
              { column: column.id, direction: "asc", nulls: "last" },
            ]);
          }
        }}
      >
        Add order key
      </button>
      <p className="muted">
        Absolute row is the implicit final tie-break and is not editable.
      </p>
    </div>
  );
}
