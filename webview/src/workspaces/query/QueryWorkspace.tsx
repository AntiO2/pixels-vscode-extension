import type {
  FilterOperator,
  ScanPlanV2,
} from "@pixels-inspector/protocol-client";
import {
  useMemo,
} from "react";
import type {
  Dispatch,
  ReactNode,
} from "react";

import type {
  VsCodeBridge,
} from "../../app/bridge.js";
import {
  rootSchemaTypes,
} from "../../app/model.js";
import type {
  AppAction,
  AppState,
} from "../../app/model.js";
import {
  ColumnsControl,
} from "../../components/ColumnsControl.js";
import {
  ProjectedGrid,
} from "../data/DataWorkspace.js";
import {
  ActionButton,
  EmptyState,
  typeLabel,
} from "../shared/WorkspaceChrome.js";
import {
  QueryPlanBuilder,
} from "./QueryPlanBuilder.js";
import {
  QueryResults,
} from "./QueryStatus.js";
import {
  OPERATOR_LABELS,
  operatorsForType,
  projectionForColumns,
  validateQueryPlan,
} from "./query-plan.js";

function editablePlan(next: ScanPlanV2): ScanPlanV2 {
  return {
    projection: next.projection,
    ...(next.predicate === undefined ? {} : { predicate: next.predicate }),
    orderBy: next.orderBy,
    offset: next.offset,
    limit: next.limit,
  };
}

function LegacyFilterWorkspace({
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
    return <EmptyState>Metadata is required before building a filter.</EmptyState>;
  }
  const rootTypes = rootSchemaTypes(metadata);
  const draft = state.query.draft;
  const firstType = rootTypes[0];
  if (firstType === undefined) {
    return <EmptyState>This file has no filterable root columns.</EmptyState>;
  }
  const predicate = draft.predicate?.kind === "predicate"
    ? draft.predicate
    : {
        kind: "predicate" as const,
        column: firstType.id,
        operator: "eq" as const,
        literal: "",
      };
  const predicateType = rootTypes.find((type) => type.id === predicate.column) ??
    firstType;
  const operators = operatorsForType(predicateType);
  const operator = operators.includes(predicate.operator)
    ? predicate.operator
    : (operators[0] ?? "eq");
  const needsLiteral = operator !== "isNull" && operator !== "isNotNull";
  const projection = draft.projection.kind === "columns"
    ? draft.projection.columns
    : rootTypes.map((type) => type.id);
  const updatePredicate = (
    column: number,
    nextOperator: FilterOperator,
    literal: string,
  ): void => {
    dispatch({
      type: "query-draft",
      draft: {
        ...draft,
        predicate: {
          kind: "predicate",
          column,
          operator: nextOperator,
          literal,
        },
      },
    });
  };
  const run = (cursor?: string): void => {
    bridge.postMessage({
      kind: "runFilter",
      predicate: {
        column: predicateType.id,
        operator,
        literal: needsLiteral ? predicate.literal : "",
      },
      columns: projection,
      ...(cursor === undefined ? {} : { cursor }),
      limit: Math.min(state.pageSize, 500),
    });
  };
  const canRun =
    operators.length > 0 &&
    projection.length > 0 &&
    (!needsLiteral || predicate.literal.length > 0);
  const result = state.filter;
  return (
    <div className="query-workspace query-workspace--legacy">
      <section className="query-builder">
        <div className="section-heading">
          <div>
            <h2>Typed file filter</h2>
            <p>
              This Core supports one bounded scalar predicate. Safe statistics
              may prune only row groups that cannot match.
            </p>
          </div>
        </div>
        <div className="query-legacy-controls">
          <label>
            <span>Column</span>
            <select
              value={predicateType.id}
              onChange={(event) => {
                const column = Number(event.currentTarget.value);
                const type = rootTypes.find((candidate) => candidate.id === column);
                updatePredicate(
                  column,
                  type === undefined ? "eq" : (operatorsForType(type)[0] ?? "eq"),
                  "",
                );
              }}
            >
              {rootTypes.map((type) => (
                <option value={type.id} key={type.id}>
                  {type.name} · {typeLabel(state, type)}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>Operator</span>
            <select
              value={operator}
              disabled={operators.length === 0}
              onChange={(event) => {
                updatePredicate(
                  predicateType.id,
                  event.currentTarget.value as FilterOperator,
                  predicate.literal,
                );
              }}
            >
              {operators.map((candidate) => (
                <option value={candidate} key={candidate}>
                  {OPERATOR_LABELS[candidate]}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>Typed value</span>
            <input
              value={predicate.literal}
              disabled={!needsLiteral || operators.length === 0}
              onChange={(event) => {
                updatePredicate(
                  predicateType.id,
                  operator,
                  event.currentTarget.value,
                );
              }}
            />
          </label>
        </div>
        <ColumnsControl
          label="Filter output columns"
          columns={rootTypes.map((type) => ({
            id: type.id,
            name: type.name,
            detail: typeLabel(state, type),
          }))}
          value={projection}
          onChange={(columns) => {
            dispatch({
              type: "query-draft",
              draft: {
                ...draft,
                projection: projectionForColumns(
                  rootTypes.map((type) => type.id),
                  columns,
                ),
              },
            });
          }}
        />
        <div className="query-actions">
          {state.loading === "filter" ? (
            <ActionButton
              icon="close"
              onClick={() => {
                bridge.postMessage({ kind: "cancel" });
              }}
            >
              Cancel
            </ActionButton>
          ) : (
            <ActionButton icon="query" disabled={!canRun} onClick={() => run()}>
              Run filter
            </ActionButton>
          )}
        </div>
      </section>
      <section className="query-results" aria-label="Query results">
        <div className="query-progress">
          <span>Filter progress</span>
          <progress
            value={
              (result?.progress.scannedRowGroups ?? 0) +
              (result?.progress.prunedRowGroups ?? 0)
            }
            max={Math.max(1, metadata.rowGroupCount)}
          />
          <span className="muted">
            {result === undefined
              ? "Not started"
              : `${String(result.progress.scannedRowGroups)} scanned · ${String(result.progress.prunedRowGroups)} pruned · ${result.progress.scannedRows} rows read`}
          </span>
        </div>
        {result === undefined ? (
          <EmptyState>Run a typed filter to inspect matching rows.</EmptyState>
        ) : result.rows.length === 0 ? (
          <EmptyState>
            {result.completed
              ? "No rows matched this predicate."
              : "No matches in this page. Continue to advance."}
          </EmptyState>
        ) : (
          <>
            <div className="result-summary" role="status">
              <span>{String(result.matched)} matches in this page</span>
              <span>{result.completed ? "Filter complete" : "More results available"}</span>
            </div>
            <ProjectedGrid
              state={state}
              columns={result.columns}
              rows={result.rows}
              dispatch={dispatch}
            />
          </>
        )}
        {result?.cursor === null || result?.cursor === undefined ? null : (
          <ActionButton icon="next" onClick={() => run(result.cursor ?? undefined)}>
            Continue
          </ActionButton>
        )}
      </section>
    </div>
  );
}

export function QueryWorkspace({
  state,
  dispatch,
  bridge,
}: {
  readonly state: AppState;
  readonly dispatch: Dispatch<AppAction>;
  readonly bridge: VsCodeBridge;
}): ReactNode {
  const metadata = state.metadata;
  if (
    state.capabilities?.scan !== "scan-v2" &&
    state.capabilities?.filter === "filter-v1"
  ) {
    return (
      <LegacyFilterWorkspace state={state} dispatch={dispatch} bridge={bridge} />
    );
  }
  const draft = state.query.draft;
  const validation = useMemo(
    () =>
      metadata === undefined
        ? undefined
        : validateQueryPlan(draft, metadata),
    [draft, metadata],
  );
  if (metadata === undefined || validation === undefined) {
    return <EmptyState>Metadata is required before building a scan.</EmptyState>;
  }
  if (state.capabilities?.scan !== "scan-v2") {
    return <EmptyState>This Core does not provide a Query capability.</EmptyState>;
  }
  const rootTypes = rootSchemaTypes(metadata);
  const updateDraft = (next: ScanPlanV2): void => {
    dispatch({ type: "query-draft", draft: editablePlan(next) });
  };
  const start = (plan: ScanPlanV2, continuation: boolean): void => {
    dispatch({ type: "query-start", plan, continuation });
    bridge.postMessage({ kind: "runScan", plan });
  };
  const result = state.query.result;
  const submitted = state.query.submitted;
  const canContinue =
    !state.query.dirty &&
    state.query.operation !== "running" &&
    result?.page.continuationAvailable === true &&
    result.page.cursor !== null &&
    submitted !== undefined;
  const continueScan = (): void => {
    const cursor = result?.page.cursor;
    if (
      !canContinue ||
      cursor === null ||
      cursor === undefined
    ) {
      return;
    }
    start({ ...submitted, offset: "0", cursor }, true);
  };
  return (
    <div className="query-workspace">
      <QueryPlanBuilder
        state={state}
        dispatch={dispatch}
        metadata={metadata}
        rootTypes={rootTypes}
        draft={draft}
        validation={validation}
        updateDraft={updateDraft}
        onRun={() => {
          if (validation.valid) {
            start(draft, false);
          }
        }}
        onCancel={() => {
          bridge.postMessage({ kind: "cancel" });
        }}
      />
      <QueryResults
        state={state}
        dispatch={dispatch}
        canContinue={canContinue}
        onContinue={continueScan}
      />
    </div>
  );
}
