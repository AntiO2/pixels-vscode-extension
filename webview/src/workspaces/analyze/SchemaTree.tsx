import type {
  MetadataResult,
  SchemaType,
} from "@pixels-inspector/protocol-client";
import {
  useMemo,
  useState,
} from "react";
import type {
  CSSProperties,
  Dispatch,
  ReactNode,
} from "react";

import {
  selectSchema,
} from "../../app/model.js";
import type {
  AppAction,
  AppState,
} from "../../app/model.js";
import {
  EntityButton,
  typeLabel,
} from "../shared/WorkspaceChrome.js";

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

export function SchemaTree({
  metadata,
  state,
  dispatch,
  onSelect,
}: {
  readonly metadata: MetadataResult;
  readonly state: AppState;
  readonly dispatch: Dispatch<AppAction>;
  readonly onSelect: () => void;
}): ReactNode {
  const [query, setQuery] = useState("");
  const visibleRows = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase();
    const rows = schemaRows(metadata);
    return normalized.length === 0
      ? rows
      : rows.filter(
          ({ type }) =>
            type.name.toLocaleLowerCase().includes(normalized) ||
            typeLabel(state, type).toLocaleLowerCase().includes(normalized),
        );
  }, [metadata, query, state]);

  return (
    <>
      <label className="schema-search">
        <span className="visually-hidden">Filter schema</span>
        <input
          type="search"
          value={query}
          placeholder="Filter schema"
          onChange={(event) => {
            setQuery(event.currentTarget.value);
          }}
        />
      </label>
      <div className="schema-tree" aria-label="Schema">
        {visibleRows.length === 0 ? (
          <p className="schema-empty">No matching columns</p>
        ) : (
          visibleRows.map(({ type, depth }) => (
            <EntityButton
              key={type.id}
              entity={selectSchema(type.id)}
              state={state}
              dispatch={dispatch}
              className="schema-entry"
              onSelect={onSelect}
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
          ))
        )}
      </div>
    </>
  );
}
