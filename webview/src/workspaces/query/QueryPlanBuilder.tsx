import type {
  MetadataResult,
  ScanExpressionV2,
  ScanPlanV2,
  SchemaType,
} from "@pixels-inspector/protocol-client";
import type {
  Dispatch,
  ReactNode,
} from "react";

import type {
  AppAction,
  AppState,
  QueryDisclosure,
} from "../../app/model.js";
import {
  ColumnsControl,
} from "../../components/ColumnsControl.js";
import {
  Icon,
} from "../../components/Icon.js";
import {
  ActionButton,
  typeLabel,
} from "../shared/WorkspaceChrome.js";
import {
  newPredicate,
} from "./expression-model.js";
import {
  OrderEditor,
  OrderingInfo,
} from "./OrderEditor.js";
import {
  PredicateEditor,
} from "./PredicateEditor.js";
import {
  QueryProgress,
} from "./QueryStatus.js";
import {
  expressionSummary,
  projectionForColumns,
} from "./query-plan.js";
import type {
  QueryValidation,
} from "./query-plan.js";

function QueryDisclosureRow({
  name,
  summary,
  section,
  open,
  dispatch,
  aside,
  children,
}: {
  readonly name: string;
  readonly summary: string;
  readonly section: QueryDisclosure;
  readonly open: boolean;
  readonly dispatch: Dispatch<AppAction>;
  readonly aside?: ReactNode;
  readonly children: ReactNode;
}): ReactNode {
  const panelId = `query-${section}-panel`;
  return (
    <section className={`query-plan-section ${open ? "is-open" : ""}`}>
      <div className="query-plan-row">
        <button
          type="button"
          className="query-disclosure-button"
          aria-expanded={open}
          aria-controls={panelId}
          onClick={() => {
            dispatch({
              type: "query-disclosure",
              disclosure: open ? undefined : section,
            });
          }}
        >
          <span className="query-plan-name">{name}</span>
          <span className="query-plan-summary">{summary}</span>
          <Icon name={open ? "up" : "down"} />
        </button>
        {aside}
      </div>
      <div
        id={panelId}
        className="query-plan-editor"
        aria-hidden={!open}
        inert={!open ? true : undefined}
      >
        <div className="query-plan-editor-content">
          {children}
        </div>
      </div>
    </section>
  );
}

function ProjectionSection({
  state,
  rootTypes,
  draft,
  validation,
  updateDraft,
  dispatch,
}: QuerySectionProps): ReactNode {
  const projectionColumns =
    draft.projection.kind === "columns"
      ? draft.projection.columns
      : rootTypes.map((type) => type.id);
  return (
    <QueryDisclosureRow
      name="Output columns"
      summary={
        draft.projection.kind === "all"
          ? `All columns (${String(rootTypes.length)})`
          : `${String(draft.projection.columns.length)} selected`
      }
      section="projection"
      open={state.query.disclosure === "projection"}
      dispatch={dispatch}
    >
      <ColumnsControl
        label="Query output columns"
        presentation="embedded"
        columns={rootTypes.map((type) => ({
          id: type.id,
          name: type.name,
          detail: typeLabel(state, type),
        }))}
        value={projectionColumns}
        onChange={(columns) => {
          updateDraft({
            ...draft,
            projection: projectionForColumns(
              rootTypes.map((type) => type.id),
              columns,
            ),
          });
        }}
      />
      {validation.fields["projection"] === undefined ? null : (
        <p className="field-error" role="alert">
          {validation.fields["projection"]}
        </p>
      )}
    </QueryDisclosureRow>
  );
}

interface QuerySectionProps {
  readonly state: AppState;
  readonly dispatch: Dispatch<AppAction>;
  readonly metadata: MetadataResult;
  readonly rootTypes: readonly SchemaType[];
  readonly draft: ScanPlanV2;
  readonly validation: QueryValidation;
  readonly updateDraft: (draft: ScanPlanV2) => void;
}

function withoutPredicate(draft: ScanPlanV2): ScanPlanV2 {
  return {
    projection: draft.projection,
    orderBy: draft.orderBy,
    offset: draft.offset,
    limit: draft.limit,
  };
}

function WhereSection(props: QuerySectionProps): ReactNode {
  const {
    state,
    dispatch,
    metadata,
    rootTypes,
    draft,
    validation,
    updateDraft,
  } = props;
  const predicate = draft.predicate;
  const updatePredicate = (
    next: ScanExpressionV2 | undefined,
  ): void => {
    const base = withoutPredicate(draft);
    updateDraft(next === undefined ? base : { ...base, predicate: next });
  };
  return (
    <QueryDisclosureRow
      name="Where"
      summary={expressionSummary(predicate)}
      section="where"
      open={state.query.disclosure === "where"}
      dispatch={dispatch}
    >
      {predicate === undefined ? (
        <div className="query-empty-editor">
          <p>All rows match. Add a typed condition to filter the scan.</p>
          <button
            type="button"
            disabled={newPredicate(rootTypes) === undefined}
            onClick={() => {
              const next = newPredicate(rootTypes);
              if (next !== undefined) {
                updateDraft({ ...draft, predicate: next });
              }
            }}
          >
            Add condition
          </button>
        </div>
      ) : (
        <>
          <PredicateEditor
            expression={predicate}
            rootTypes={rootTypes}
            metadata={metadata}
            state={state}
            errors={validation.fields}
            onChange={updatePredicate}
          />
        </>
      )}
    </QueryDisclosureRow>
  );
}

function OrderSection(props: QuerySectionProps): ReactNode {
  const {
    state,
    dispatch,
    metadata,
    rootTypes,
    draft,
    validation,
    updateDraft,
  } = props;
  return (
    <QueryDisclosureRow
      name="Order by"
      summary={
        draft.orderBy.length === 0
          ? "Natural file order"
          : `${String(draft.orderBy.length)} keys`
      }
      section="order"
      open={state.query.disclosure === "order"}
      dispatch={dispatch}
      aside={draft.orderBy.length > 0 ? <OrderingInfo /> : undefined}
    >
      <OrderEditor
        keys={draft.orderBy}
        rootTypes={rootTypes}
        metadata={metadata}
        state={state}
        errors={validation.fields}
        onChange={(orderBy) => {
          updateDraft({ ...draft, orderBy });
        }}
      />
    </QueryDisclosureRow>
  );
}

function RangeSection(props: QuerySectionProps): ReactNode {
  const { state, dispatch, draft, validation, updateDraft } = props;
  return (
    <QueryDisclosureRow
      name="Range"
      summary={`Offset ${draft.offset} · Limit ${String(draft.limit)}`}
      section="range"
      open={state.query.disclosure === "range"}
      dispatch={dispatch}
    >
      <div className="range-editor">
        <label>
          <span>Offset</span>
          <input
            value={draft.offset}
            inputMode="numeric"
            aria-invalid={
              validation.fields["offset"] === undefined ? undefined : true
            }
            onChange={(event) => {
              updateDraft({ ...draft, offset: event.currentTarget.value });
            }}
          />
          {validation.fields["offset"] === undefined ? null : (
            <span className="field-error">{validation.fields["offset"]}</span>
          )}
        </label>
        <label>
          <span>Limit</span>
          <input
            type="number"
            min={1}
            max={500}
            value={draft.limit}
            aria-invalid={
              validation.fields["limit"] === undefined ? undefined : true
            }
            onChange={(event) => {
              updateDraft({
                ...draft,
                limit: Number(event.currentTarget.value),
              });
            }}
          />
          {validation.fields["limit"] === undefined ? null : (
            <span className="field-error">{validation.fields["limit"]}</span>
          )}
        </label>
      </div>
    </QueryDisclosureRow>
  );
}

export function QueryPlanBuilder({
  state,
  dispatch,
  metadata,
  rootTypes,
  draft,
  validation,
  updateDraft,
  onRun,
  onCancel,
}: QuerySectionProps & {
  readonly onRun: () => void;
  readonly onCancel: () => void;
}): ReactNode {
  const sectionProps: QuerySectionProps = {
    state,
    dispatch,
    metadata,
    rootTypes,
    draft,
    validation,
    updateDraft,
  };
  const isDefaultPlan =
    draft.projection.kind === "all" &&
    draft.predicate === undefined &&
    draft.orderBy.length === 0 &&
    draft.offset === "0" &&
    draft.limit === 20;
  return (
    <section className="query-builder" aria-labelledby="query-builder-title">
      <div className="section-heading">
        <div>
          <h2 id="query-builder-title">Scan file</h2>
          <p>Build a bounded typed scan. Draft edits do not read the file.</p>
        </div>
        <span className="query-plan-semantic">
          {isDefaultPlan ? "SELECT * LIMIT 20" : "Typed Scan v2 draft"}
        </span>
      </div>
      <div className="query-plan">
        <ProjectionSection {...sectionProps} />
        <WhereSection {...sectionProps} />
        <OrderSection {...sectionProps} />
        <RangeSection {...sectionProps} />
      </div>
      {validation.fields["plan"] === undefined ? null : (
        <p className="query-plan-error" role="alert">
          {validation.fields["plan"]}
        </p>
      )}
      {state.query.error === undefined ? null : (
        <div className="query-operation-error" role="alert">
          <strong>{state.query.error.code}</strong>
          <span>{state.query.error.message}</span>
        </div>
      )}
      <div className="query-action-row">
        <span className="query-draft-status" role="status">
          {state.query.dirty
            ? "Draft changed · continuation invalidated"
            : state.query.submitted === undefined
              ? "Ready · all columns, all rows, natural order, offset 0, limit 20"
              : "Plan matches the last submitted scan"}
        </span>
        {state.query.operation === "running" ? (
          <ActionButton
            icon="close"
            className="query-cancel-action"
            onClick={onCancel}
          >
            Cancel
          </ActionButton>
        ) : (
          <ActionButton
            icon="query"
            className="query-primary-action"
            disabled={!validation.valid}
            onClick={onRun}
          >
            Run scan
          </ActionButton>
        )}
      </div>
      <QueryProgress state={state} />
    </section>
  );
}
