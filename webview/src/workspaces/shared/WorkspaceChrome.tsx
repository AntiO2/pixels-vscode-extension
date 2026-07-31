import type {
  SchemaType,
} from "@pixels-inspector/protocol-client";
import type {
  ButtonHTMLAttributes,
  Dispatch,
  ReactNode,
} from "react";
import {
  useLayoutEffect,
  useRef,
} from "react";

import type {
  VsCodeBridge,
} from "../../app/bridge.js";
import {
  selectChunk,
  selectRowGroup,
} from "../../app/model.js";
import type {
  AppAction,
  AppState,
  EntitySelection,
} from "../../app/model.js";
import {
  Icon,
} from "../../components/Icon.js";
import {
  ExactValue,
} from "../../components/ExactValue.js";
import type {
  IconName,
} from "../../components/Icon.js";
import {
  WorkspaceTabs,
} from "../../components/WorkspaceTabs.js";

export interface RequestSelection {
  readonly rowGroup: number;
  readonly column: number;
  readonly rowOffset: number;
  readonly rowCount: number;
}

export interface RequestRows {
  readonly rowGroup: number;
  readonly columns: readonly number[];
  readonly rowOffset: number;
  readonly rowCount: number;
}

export function kindName(state: AppState, kind: number): string {
  return state.capabilities?.types[kind]?.name ?? `KIND_${String(kind)}`;
}

export function typeLabel(state: AppState, type: SchemaType): string {
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

export function PropertyList({
  entries,
  exactValues = false,
}: {
  readonly entries: readonly (readonly [string, ReactNode])[];
  readonly exactValues?: boolean;
}): ReactNode {
  return (
    <dl className="properties">
      {entries.map(([label, value]) => (
        <div className="property" key={label}>
          <dt>{label}</dt>
          <dd>
            {exactValues &&
            (typeof value === "string" || typeof value === "number") ? (
              <ExactValue label={label} value={String(value)} />
            ) : (
              value
            )}
          </dd>
        </div>
      ))}
    </dl>
  );
}

export function ActionButton({
  children,
  icon,
  className = "",
  title,
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
      title={title ?? (icon === undefined || typeof children !== "string" ? undefined : children)}
      {...props}
    >
      {icon === undefined ? null : <Icon name={icon} />}
      <span>{children}</span>
    </button>
  );
}

export function EmptyState({
  children,
}: {
  readonly children: ReactNode;
}): ReactNode {
  return <div className="empty-state">{children}</div>;
}

export function EntityButton({
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
        dispatch({ type: "select", entity, revealInspector: true });
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

export function InstrumentHeader({
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
  const shape = state.metadata === undefined
    ? "Portable Pixels Core"
    : `${String(state.metadata.rows)} rows · ${String(state.metadata.schemaCount)} columns · ${String(state.metadata.rowGroupCount)} row groups`;
  return (
    <header className="instrument-header">
      <div className="identity">
        <Icon name="file" />
        <div>
          <h1>
            <ExactValue
              label="file identity"
              value={`${filename}\n${shape}`}
            >
              {filename}
            </ExactValue>
          </h1>
          <p>{shape}</p>
        </div>
      </div>
      <WorkspaceTabs mode={state.mode} dispatch={dispatch} />
      <div className="header-actions">
        {state.mode === "analyze" ? (
          <>
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
          </>
        ) : null}
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

export function WorkspaceChrome({
  state,
  bridge,
  dispatch,
}: {
  readonly state: AppState;
  readonly bridge: VsCodeBridge;
  readonly dispatch: Dispatch<AppAction>;
}): ReactNode {
  const chromeRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const chrome = chromeRef.current;
    if (chrome === null) {
      return;
    }
    const app = chrome.parentElement;
    if (app === null) {
      return;
    }
    const updateHeight = (): void => {
      app.style.setProperty(
        "--px-workspace-chrome-height",
        `${String(chrome.getBoundingClientRect().height)}px`,
      );
    };
    updateHeight();
    const observer = new ResizeObserver(updateHeight);
    observer.observe(chrome);
    return () => {
      observer.disconnect();
      app.style.removeProperty("--px-workspace-chrome-height");
    };
  }, []);

  return (
    <div ref={chromeRef} className="workspace-chrome">
      <InstrumentHeader state={state} bridge={bridge} dispatch={dispatch} />
      <ModeContext state={state} dispatch={dispatch} />
    </div>
  );
}

export function ModeContext({
  state,
  dispatch,
}: {
  readonly state: AppState;
  readonly dispatch: Dispatch<AppAction>;
}): ReactNode {
  if (state.mode === "query") {
    return null;
  }
  if (state.mode === "data") {
    const rowGroup =
      (state.orientation === "rows"
        ? state.rows?.rowGroup
        : state.page?.rowGroup) ??
      state.rowGroup?.rowGroup ??
      0;
    const offset =
      state.orientation === "rows"
        ? Number(state.rows?.offset ?? 0)
        : (state.page?.offset ?? 0);
    const count =
      state.orientation === "rows"
        ? (state.rows?.count ?? state.pageSize)
        : (state.page?.count ?? state.pageSize);
    return (
      <nav className="breadcrumb" aria-label="Data location">
        <span>RG {String(rowGroup)}</span>
        <span className="separator">/</span>
        <span aria-current="location">
          rows {String(offset)}–{String(Math.max(offset, offset + count - 1))}
        </span>
      </nav>
    );
  }
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
