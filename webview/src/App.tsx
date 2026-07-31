import {
  useCallback,
  useEffect,
  useReducer,
  useRef,
} from "react";
import type {
  Dispatch,
  ReactNode,
} from "react";

import type {
  VsCodeBridge,
} from "./app/bridge.js";
import {
  appReducer,
  automaticDataLoad,
  automaticQueryPlan,
  initialState,
} from "./app/model.js";
import type {
  AppAction,
} from "./app/model.js";
import {
  ErrorStatus,
  LoadingStatus,
} from "./components/OperationStatus.js";
import {
  WorkspaceChrome,
} from "./workspaces/shared/WorkspaceChrome.js";
import type {
  RequestRows,
  RequestSelection,
} from "./workspaces/shared/WorkspaceChrome.js";
import {
  AnalyzeWorkspace,
  ContextRail,
  InspectorPanel,
} from "./workspaces/analyze/AnalyzeWorkspace.js";
import {
  DataWorkspace,
} from "./workspaces/data/DataWorkspace.js";
import {
  QueryWorkspace,
} from "./workspaces/query/QueryWorkspace.js";

interface AppProps {
  readonly bridge: VsCodeBridge;
  readonly subscribe: (dispatch: Dispatch<AppAction>) => () => void;
}

export function App({
  bridge,
  subscribe,
}: AppProps): ReactNode {
  const [state, dispatch] = useReducer(appReducer, initialState);
  const autoLoadDataRevisions = useRef(new Set<string>());
  const autoRunRevisions = useRef(new Set<string>());
  useEffect(() => subscribe(dispatch), [subscribe]);
  useEffect(() => {
    const source = state.source;
    const load = automaticDataLoad(state);
    const attemptKey = source === undefined
      ? ""
      : `${String(state.revision)}:${source.uri}:${source.revision}`;
    if (
      source === undefined ||
      load === undefined ||
      autoLoadDataRevisions.current.has(attemptKey)
    ) {
      return;
    }
    autoLoadDataRevisions.current.add(attemptKey);
    dispatch({ type: "data-auto-start" });
    if (load.kind === "rows") {
      bridge.postMessage({
        kind: "selectRows",
        rowGroup: load.rowGroup,
        columns: load.columns,
        rowOffset: String(load.rowOffset),
        rowCount: load.rowCount,
      });
    } else if (load.kind === "column") {
      bridge.postMessage({
        kind: "select",
        rowGroup: load.rowGroup,
        column: load.column,
        rowOffset: String(load.rowOffset),
        rowCount: load.rowCount,
      });
    }
  }, [bridge, state]);
  useEffect(() => {
    const sourceRevision = state.source?.revision;
    const plan = automaticQueryPlan(state);
    const attemptKey = `${String(state.revision)}:${sourceRevision ?? ""}`;
    if (
      sourceRevision === undefined ||
      plan === undefined ||
      autoRunRevisions.current.has(attemptKey)
    ) {
      return;
    }
    autoRunRevisions.current.add(attemptKey);
    dispatch({ type: "query-auto-start", plan });
    bridge.postMessage({ kind: "runScan", plan });
  }, [bridge, state.capabilities, state.mode, state.query, state.source]);
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
  const retry = useCallback((): void => {
    const metadata = state.metadata;
    if (state.mode !== "data" || metadata === undefined) {
      bridge.postMessage({ kind: "refresh" });
      return;
    }
    const rowGroup =
      (state.orientation === "rows"
        ? state.rows?.rowGroup
        : state.page?.rowGroup) ??
      state.rowGroup?.rowGroup ??
      0;
    const available = metadata.rowGroups[rowGroup]?.rows ?? 0;
    if (available <= 0) {
      return;
    }
    if (state.orientation === "rows") {
      if (state.dataProjection.length === 0) {
        return;
      }
      requestRows({
        rowGroup,
        columns: state.dataProjection,
        rowOffset: 0,
        rowCount: Math.min(state.pageSize, available),
      });
      return;
    }
    request({
      rowGroup,
      column: state.page?.column ?? state.focusedColumn,
      rowOffset: state.page?.offset ?? 0,
      rowCount: Math.min(state.pageSize, available),
    });
  }, [bridge, request, requestRows, state]);

  return (
    <div className={`app mode-${state.mode}`}>
      <WorkspaceChrome state={state} bridge={bridge} dispatch={dispatch} />
      {state.error === undefined ? null : (
        <ErrorStatus
          code={state.error.code}
          message={state.error.message}
          recoverable={state.error.recoverable}
          onRetry={retry}
        />
      )}
      <div
        className={`workspace-shell ${
          state.mode === "analyze" ? "" : "workspace-shell--canvas"
        }`}
      >
        {state.mode === "analyze" ? (
          <ContextRail state={state} dispatch={dispatch} request={request} />
        ) : null}
        <main
          className="primary-workspace"
          role="tabpanel"
          id="workspace-panel"
          aria-labelledby={`workspace-tab-${state.mode}`}
        >
          {state.loading === undefined ? null : (
            <LoadingStatus stage={state.loading} />
          )}
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
            <QueryWorkspace state={state} dispatch={dispatch} bridge={bridge} />
          )}
        </main>
        {state.mode === "analyze" ? (
          <InspectorPanel state={state} dispatch={dispatch} />
        ) : null}
      </div>
    </div>
  );
}
