import type {
  Dispatch,
  ReactNode,
} from "react";

import type {
  AppAction,
  AppState,
} from "../../app/model.js";
import {
  ProjectedGrid,
} from "../data/DataWorkspace.js";
import {
  ActionButton,
  EmptyState,
} from "../shared/WorkspaceChrome.js";
import {
  continuationStatus,
} from "./query-plan.js";

function formatElapsed(elapsedMs: number): string {
  const totalTenths = Math.floor(elapsedMs / 100);
  const minutes = Math.floor(totalTenths / 600);
  const seconds = Math.floor((totalTenths % 600) / 10);
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}.${String(totalTenths % 10)}`;
}

export function QueryProgress({
  state,
}: {
  readonly state: AppState;
}): ReactNode {
  const progress = state.query.progress;
  if (state.query.operation !== "running" && progress === undefined) {
    if (state.query.operation === "cancelled") {
      return (
        <div className="query-progress-status" role="status" aria-live="polite">
          Scan cancelled. The last successful result is preserved.
        </div>
      );
    }
    return null;
  }
  const snapshot = progress?.snapshot;
  const ordered = (state.query.submitted?.orderBy.length ?? 0) > 0;
  const active = state.query.operation === "running";
  const current =
    snapshot === undefined
      ? 0
      : snapshot.scannedRowGroups + snapshot.prunedRowGroups;
  const total = snapshot?.rowGroupsTotal ?? 0;
  const scannedPercent =
    total === 0 || snapshot === undefined
      ? 0
      : (snapshot.scannedRowGroups / total) * 100;
  const prunedPercent =
    total === 0 || snapshot === undefined
      ? 0
      : (snapshot.prunedRowGroups / total) * 100;
  return (
    <div className="query-progress-status" role="status" aria-live="polite">
      <div className="query-progress-line">
        <strong>
          {snapshot?.phase === "projecting"
            ? active
              ? "Projecting selected rows"
              : "Projected selected rows"
            : ordered
              ? active
                ? "Scanning full file to order results"
                : "Scanned full file to order results"
              : active
                ? "Scanning in natural file order"
                : "Scanned in natural file order"}
        </strong>
        <span>{formatElapsed(progress?.elapsedMs ?? 0)}</span>
      </div>
      <progress
        className="visually-hidden"
        aria-label="Scan Row Group progress"
        value={total > 0 ? current : undefined}
        max={Math.max(1, total)}
      />
      <div
        className="query-progress-track"
        role="img"
        aria-label={
          snapshot === undefined
            ? "Scan progress is preparing"
            : `${String(snapshot.scannedRowGroups)} Row Groups scanned, ${String(snapshot.prunedRowGroups)} pruned, ${String(Math.max(0, total - current))} remaining`
        }
      >
        <span
          className="is-scanned"
          style={{ width: `${String(scannedPercent)}%` }}
        />
        <span
          className="is-pruned"
          style={{ width: `${String(prunedPercent)}%` }}
        />
      </div>
      <span className="query-progress-counters">
        {snapshot === undefined
          ? "Preparing scan…"
          : `${String(current)} of ${String(total)} Row Groups · ${snapshot.scannedRows} rows read · ${String(snapshot.prunedRowGroups)} groups pruned · ${snapshot.matchedRows} matches`}
      </span>
    </div>
  );
}

export function QueryResults({
  state,
  dispatch,
  canContinue,
  onContinue,
}: {
  readonly state: AppState;
  readonly dispatch: Dispatch<AppAction>;
  readonly canContinue: boolean;
  readonly onContinue: () => void;
}): ReactNode {
  const result = state.query.result;
  return (
    <section className="query-results" aria-label="Query results">
      {result === undefined ? (
        <EmptyState>
          Run the visible plan to inspect a bounded result page.
        </EmptyState>
      ) : (
        <>
          <div className="query-result-status" role="status">
            <div>
              <strong>{String(result.page.returned)} rows returned</strong>
              <span>
                {result.scan.completion === "complete"
                  ? "Scan complete"
                  : "Page limit reached"}
                {" · "}
                {continuationStatus(result.page)}
              </span>
            </div>
            {canContinue ? (
              <ActionButton icon="next" onClick={onContinue}>
                Continue
              </ActionButton>
            ) : null}
          </div>
          {result.scan.ordered && result.page.continuationAvailable ? (
            <p className="ordered-continuation-note" role="note">
              Continuing this ordered result can rescan the file while keeping
              memory bounded.
            </p>
          ) : null}
          {result.rows.length === 0 ? (
            <EmptyState>
              {result.scan.completion === "complete"
                ? "No rows matched the submitted plan."
                : "This bounded page returned no rows."}
            </EmptyState>
          ) : (
            <ProjectedGrid
              state={state}
              columns={result.columns}
              rows={result.rows}
              dispatch={dispatch}
            />
          )}
        </>
      )}
    </section>
  );
}
